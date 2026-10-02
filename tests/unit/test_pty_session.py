"""PtySession makes the slave PTY the child's controlling terminal (SIGWINCH redraw fix)."""

import asyncio
import os
import struct
import sys

import pytest

from codechroma.terminal.pty_session import PtySession, default_cols, default_rows

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="Unix PTY tests")

if sys.platform != "win32":
    import fcntl

# TIOCGSID returns the tty's owning session id; OSError when there is no controlling session.
_TIOCGSID = 0x40047463 if sys.platform == "darwin" else 0x5429


def _run_to_exit(argv: list[str]) -> str:
    """Everything the child wrote to its PTY before exiting, as the socket would have seen it."""

    async def run() -> str:
        chunks: list[str] = []
        finished = asyncio.Event()
        PtySession(argv, on_output=chunks.append, on_exit=finished.set)
        await asyncio.wait_for(finished.wait(), 10)
        return "".join(chunks)

    return asyncio.run(run())


def test_spawned_process_has_the_pty_as_controlling_terminal():
    async def run():
        session = PtySession(["sleep", "5"], on_output=lambda _: None, on_exit=lambda: None)
        await asyncio.sleep(0.3)
        child_sid = os.getsid(session._process.pid)
        try:
            packed = fcntl.ioctl(session._master_fd, _TIOCGSID, struct.pack("i", 0))
            tty_sid = struct.unpack("i", packed)[0]
        except OSError:
            tty_sid = None
        finally:
            session.close()
        return child_sid, tty_sid

    child_sid, tty_sid = asyncio.run(run())

    assert tty_sid == child_sid


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        # An unset TERM is what a Finder-launched desktop app inherits; the child must not see it.
        ("printf '%s' \"$TERM\"", "xterm-256color"),
        # 0x0 is what `pty.openpty()` gives, and it makes a TUI wrap against no columns at all.
        ("stty size", f"{default_rows()} {default_cols()}"),
    ],
)
def test_the_child_starts_on_a_configured_terminal(command, expected):
    output = _run_to_exit(["sh", "-c", command])

    assert output.strip() == expected


def test_a_multibyte_character_split_across_two_reads_survives():
    # 3 bytes each, 4000 of them: a 4096-byte read boundary is guaranteed to land mid-character.
    output = _run_to_exit(["sh", "-c", f"printf '%s' '{'─' * 4000}'"])

    assert "�" not in output
    assert output.count("─") == 4000


def test_child_that_ignores_sigterm_is_sigkilled_and_reaped():
    # A trapped SIGTERM must still escalate to SIGKILL; a marker replaces a racy fixed sleep.
    script = (
        "import signal,time;"
        "signal.signal(signal.SIGTERM, lambda *a: None);"
        "print('ready', flush=True);"
        "time.sleep(30)"
    )

    async def run():
        exited = asyncio.Event()
        ready = asyncio.Event()
        output: list[str] = []

        def on_exit():
            exited.set()

        def on_output(text):
            output.append(text)
            if "ready" in "".join(output):
                ready.set()

        argv = ["python3", "-c", script]
        session = PtySession(argv, on_output=on_output, on_exit=on_exit)
        await asyncio.wait_for(ready.wait(), 5)  # the SIGTERM handler is installed by now
        pid = session.pid
        os.kill(pid, 0)  # sanity: the child is still alive before close()
        session.close()
        await asyncio.wait_for(exited.wait(), 5)  # the reaper task fires on_exit once reaped
        code = session.returncode
        try:
            os.kill(pid, 0)
            still_alive = True
        except ProcessLookupError:
            still_alive = False
        return code, still_alive

    code, still_alive = asyncio.run(run())

    assert still_alive is False
    # SIGKILL'd: the reaped status is the signal number, 9 (or its 128+9 form).
    assert code == 9 or code == -9 or code == 137


def test_close_reaps_a_normally_exiting_childs_exit_code():
    async def run():
        session = PtySession(["true"], on_output=lambda _: None, on_exit=lambda: None)
        await asyncio.sleep(0.3)
        session.close()
        await session._reap_and_notify()  # drive the reaper to completion deterministically
        return session.returncode

    assert asyncio.run(run()) == 0


def test_write_to_a_full_pty_buffer_is_swallowed():
    m, s = os.openpty()
    session = object.__new__(PtySession)
    session._closed = False
    session._master_fd = m
    os.close(s)
    # Fill the master's outbound buffer until it can take no more, then write still returns.
    try:
        chunk = b"x" * (1 << 16)
        for _ in range(1 << 14):
            try:
                os.write(m, chunk)
            except OSError:
                break
        session.write_bytes(chunk)  # must not raise
    finally:
        os.close(m)
