"""PtySession: spawns a subprocess attached to a pseudo-terminal and bridges it to asyncio."""

from __future__ import annotations

import asyncio
import codecs
import errno
import os
import signal
import struct
import subprocess
import time
from collections.abc import Callable

from codechroma.config import settings

if settings.windows:
    from winpty import PtyProcess
else:
    import fcntl
    import pty
    import termios

def read_chunk_size() -> int:
    return settings.terminal.read_chunk_size


def default_rows() -> int:
    # `pty.openpty()` starts at 0x0; a TUI before a window opens paints against no columns.
    return settings.terminal.pty_default_rows


def default_cols() -> int:
    return settings.terminal.pty_default_cols


def _make_controlling_tty() -> None:
    """Child preexec: setsid + set PTY as controlling terminal so the shell redraws on resize.
    
    On macOS only an interactive child (a login shell) self-acquires the PTY; a passive child like
    `claude` needs this explicit `TIOCSCTTY`, and doing it from the parent post-spawn is EPERM. It
    runs in the forked child before exec, so `start_new_session` cannot replace it.
    """
    if settings.windows:
        return
    
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


def _terminal_env() -> dict[str, str]:
    """The bridge's env plus the terminal identity a Finder-launched desktop app never inherits."""
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["FORCE_COLOR"] = "1"
    # The output stream is decoded as UTF-8 unconditionally; make the child agree.
    if not env.get("LC_ALL") and not env.get("LANG"):
        env["LANG"] = "en_US.UTF-8"
    return env


class PtySession:
    """Owns one PTY-attached subprocess; forwards its output and accepts input/resize/close."""

    def __init__(
        self,
        argv: list[str],
        on_output: Callable[[str], None],
        on_exit: Callable[[], None],
        cwd: str | None = None,
        rows: int | None = None,
        cols: int | None = None,
        env: dict[str, str] | None = None,
    ):
        rows = rows if rows is not None else default_rows()
        cols = cols if cols is not None else default_cols()
        self._on_output = on_output
        self._on_exit = on_exit
        self._closed = False
        self.last_size: tuple[int, int] | None = None
        # A multi-byte character can straddle two reads; an incremental decoder carries the tail.
        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")
        child_env = _terminal_env()
        if env:
            child_env.update(env)
        if settings.windows:
            # ConPTY owns the Windows terminal handles and reads output from a worker thread.
            self._process = PtyProcess.spawn(
                argv, cwd=cwd, env=child_env, dimensions=(rows, cols)
            )
            self._master_fd = self._process.fileno()
            self.last_size = (rows, cols)
        else:
            self._master_fd, slave_fd = pty.openpty()
            # Size the PTY before the child exists, so it never observes a 0x0 terminal.
            self.resize(rows, cols)
            self._process = subprocess.Popen(
                argv,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=cwd,
                env=child_env,
                preexec_fn=_make_controlling_tty,
                close_fds=True,
            )
            os.close(slave_fd)
        self._exit_code: int | None = None
        if settings.windows:
            self._read_task = asyncio.create_task(self._read_windows())
        else:
            asyncio.get_running_loop().add_reader(self._master_fd, self._on_readable)

    @property
    def master_fd(self) -> int:
        """The PTY master, so a screen tap can ask which process group is in the foreground."""
        return self._master_fd

    @property
    def pid(self) -> int | None:
        """The child's pid, so a caller can record it or kill the group without a running loop."""
        return self._process.pid

    @property
    def returncode(self) -> int | None:
        """The child's exit status once it has been reaped; None while it is still running."""
        if self._exit_code is not None:
            return self._exit_code
        self._try_reap()
        return self._exit_code

    def _try_reap(self) -> None:
        # Let asyncio's child watcher be the one reaper; a raw os.waitpid would race its thread and
        # intermittently starve under load. poll() then reports the watcher's recorded status.
        if settings.windows:
            if self._process.isalive():
                return
            code = self._process.exitstatus
        else:
            code = self._process.poll()
        if code is not None:
            # poll() negates a signal-killed exit; unwrap it to the plain status callers see.
            self._exit_code = -code if code < 0 else code

    async def _read_windows(self) -> None:
        while not self._closed:
            try:
                text = await asyncio.to_thread(self._process.read, read_chunk_size())
            except (EOFError, OSError):
                break
            if text:
                self._on_output(text)
            if not self._process.isalive():
                break
        if not self._closed:
            self.close()

    def _on_readable(self) -> None:
        try:
            data = os.read(self._master_fd, read_chunk_size())
        except OSError:
            data = b""
        if not data:
            self.close()
            return
        text = self._decoder.decode(data)
        if text:
            self._on_output(text)

    def write(self, data: str) -> None:
        if self._closed:
            return
        self._write_to_pty(data.encode("utf-8"))

    def write_bytes(self, data: bytes) -> None:
        """Raw input that must not be re-encoded — xterm's binary channel (mouse reports)."""
        if self._closed:
            return
        self._write_to_pty(data)

    def _write_to_pty(self, data: bytes) -> None:
        """Write to the PTY, swallowing EAGAIN (full buffer) and EIO (gone child)."""
        try:
            if settings.windows:
                self._process.write(data.decode("utf-8", errors="replace"))
            else:
                os.write(self._master_fd, data)
        except BlockingIOError:
            pass
        except EOFError:
            pass
        except OSError as exc:
            # EAGAIN can surface as OSError on some platforms; EIO means the child is gone.
            if exc.errno not in (errno.EAGAIN, errno.EIO):
                raise

    def resize(self, rows: int, cols: int) -> None:
        if self._closed:
            return

        self.last_size = (rows, cols)

        if settings.windows:
            self._process.setwinsize(rows, cols)
            return

        fcntl.ioctl(
            self._master_fd,
            termios.TIOCSWINSZ,
            struct.pack("HHHH", rows, cols, 0, 0),
        )

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        # Whatever the decoder was holding is a truncated character; emit it as U+FFFD, not silence.
        trailing = self._decoder.decode(b"", True)
        if trailing:
            self._on_output(trailing)
        loop = asyncio.get_running_loop()
        if not settings.windows:
            loop.remove_reader(self._master_fd)
        self._kill_process_group()
        if not settings.windows:
            os.close(self._master_fd)
        # Reap from a task: only real loop yields let asyncio's child watcher deliver the reap.
        loop.create_task(self._reap_and_notify())

    async def _reap_and_notify(self) -> None:
        """Waits (yielding to the loop) for the child to be reaped, then fires the exit callback."""
        await self._wait_for_exit(settings.terminal.kill_wait_seconds)
        self._on_exit()

    async def _wait_for_exit(self, timeout: float) -> None:
        """Yields to the loop until the child is reaped, or reaps it before giving up."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self._try_reap()
            if self.returncode is not None:
                return
            await asyncio.sleep(0.01)
        self._try_reap()

    def _kill_process_group(self) -> None:
        # A child already reaped is skipped; SIGTERM first, then SIGKILL if it ignores TERM.
        if self.returncode is not None:
            return
        if settings.windows:
            self._process.terminate(force=True)
            return
        pid = self._process.pid
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        if not self._blocking_wait(settings.terminal.close_grace_seconds):
            try:
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            except ProcessLookupError:
                pass

    def terminate_process(self) -> None:
        """Terminates the child without requiring an active asyncio loop."""
        if self.returncode is not None:
            return
        if settings.windows:
            self._process.terminate(force=True)
            return
        try:
            os.killpg(os.getpgid(self._process.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass

    def _blocking_wait(self, timeout: float) -> bool:
        """Sync sleep-loop so close() still escalates even when no loop is running."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.returncode is not None:
                return True
            time.sleep(0.01)
        return False
