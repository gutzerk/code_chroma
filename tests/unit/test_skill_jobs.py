"""Unit tests for routes/_skill_jobs.py: the shared status/output callbacks and cancel body."""

import asyncio

from codechroma.bridge.routes._skill_jobs import job_callbacks, stop_and_notify


class FakeAgent:
    def __init__(self):
        self.stopped: list[str] = []

    async def stop(self, key: str) -> dict:
        self.stopped.append(key)
        return {"state": "idle", "error": None}


def test_job_callbacks_emit_status_and_output_with_extras():
    emitted: list[dict] = []
    on_status_change, on_output = job_callbacks("custom", emitted.append, type_id="flow")

    async def _drive():
        await on_status_change("main:flow", {"state": "generating", "error": None})
        await on_output("main:flow", ["line 1"])

    asyncio.run(_drive())

    assert emitted == [
        {"type": "custom-status", "type_id": "flow", "state": "generating", "error": None},
        {"type": "custom-output", "type_id": "flow", "lines": ["line 1"]},
    ]


def test_job_callbacks_await_an_async_emitter():
    emitted: list[dict] = []

    async def broadcast(message: dict) -> None:
        emitted.append(message)

    on_status_change, _on_output = job_callbacks("diagram-type", broadcast, draft_id="d1")

    asyncio.run(on_status_change("draft:d1", {"state": "idle", "error": None}))

    assert emitted == [
        {"type": "diagram-type-status", "draft_id": "d1", "state": "idle", "error": None}
    ]


def test_stop_and_notify_stops_the_job_and_pings_the_canvas():
    agent = FakeAgent()
    emitted: list[dict] = []

    state = asyncio.run(
        stop_and_notify(agent, "main:flow", "custom", emitted.append, type_id="flow")
    )

    assert agent.stopped == ["main:flow"]
    assert state == {"state": "idle", "error": None}
    assert emitted == [
        {"type": "custom-status", "type_id": "flow", "state": "idle", "error": None}
    ]
