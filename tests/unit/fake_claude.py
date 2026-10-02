"""A stand-in for `asyncio.create_subprocess_exec("claude", ...)` for the SkillAgent tests.

The runner reads stdout incrementally as a stream-json feed rather than calling communicate(), so a
fake process needs real StreamReaders on both pipes — shared here because both runners' suites need
the same one.
"""

import asyncio
import json


def stream_json(events) -> bytes:
    """The events as the CLI writes them: one compact JSON object per line."""
    return b"".join(json.dumps(event).encode() + b"\n" for event in events)


def reader(data: bytes) -> asyncio.StreamReader:
    """A closed StreamReader already holding `data` — the fake's stdout/stderr pipe."""
    stream = asyncio.StreamReader()
    stream.feed_data(data)
    stream.feed_eof()
    return stream


class FakeProc:
    """Exits immediately with `returncode`, or hangs until killed when `hang` is set."""

    def __init__(self, *, returncode=0, events=(), stderr=b"", hang=False, killed=None):
        self.returncode = None if hang else returncode
        self.stdout = reader(stream_json(events))
        self.stderr = reader(stderr)
        self._exit_code = returncode
        self._hang = hang
        self._killed = killed

    async def wait(self):
        if self._hang:
            await asyncio.sleep(10)
        return self.returncode

    async def communicate(self):
        """A `.communicate()`-style caller (058's worker jobs) -- same hang/exit contract."""
        if self._hang:
            await asyncio.sleep(10)
        stdout, stderr = await self.stdout.read(), await self.stderr.read()
        self.returncode = self._exit_code
        return stdout, stderr

    def kill(self):
        if self._killed is not None:
            self._killed.append(True)
        self.returncode = self._exit_code
        # A real SIGKILL ends the hang -- a pending wait()/communicate() must not keep sleeping.
        self._hang = False


def fake_claude_exec(
    *, returncode=0, events=(), stderr=b"", hang=False, killed=None, on_spawn=None
):
    """Builds the create_subprocess_exec replacement the tests monkeypatch in."""

    async def _exec(*_args, **_kwargs):
        if on_spawn is not None:
            on_spawn()
        return FakeProc(
            returncode=returncode, events=events, stderr=stderr, hang=hang, killed=killed
        )

    return _exec
