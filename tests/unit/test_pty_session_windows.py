"""On Windows, PtySession answers ConPTY's startup query so output flows unattended."""

import asyncio
import sys

import pytest

from codechroma.terminal.pty_session import PtySession

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="ConPTY only")


def test_output_flows_without_a_client_answering_conpty():
    async def run() -> str:
        chunks: list[str] = []
        finished = asyncio.Event()
        PtySession(
            ["cmd.exe", "/c", "echo hello"], on_output=chunks.append, on_exit=finished.set
        )
        await asyncio.wait_for(finished.wait(), 10)
        return "".join(chunks)

    output = asyncio.run(run())

    assert "hello" in output
