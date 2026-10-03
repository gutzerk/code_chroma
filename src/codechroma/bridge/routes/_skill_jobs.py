"""Shared plumbing for routes that drive a SkillAgent job.

Every skill-run family (diagrams, epic briefs) used to hand-write the same
`{kind}-status`/`{kind}-output` callback pair and the same cancel-then-ping body. This module is
that lifecycle written once; a route keeps only what is genuinely its own (validation, caching,
prompt building).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from codechroma.bridge.skill_agent import OnChange, OnOutput, SkillAgent

# ws.emit returns None; ConnectionManager.broadcast returns a coroutine -- both shapes are accepted.
Emit = Callable[[dict], Awaitable[None] | None]


async def _deliver(emit: Emit, message: dict) -> None:
    result = emit(message)
    if result is not None:
        await result


def job_callbacks(kind: str, emit: Emit, **extras: object) -> tuple[OnChange, OnOutput]:
    """The status/output ping pair every generate route wires its runner with."""

    async def on_status_change(_key: str, state: dict) -> None:
        await _deliver(emit, {"type": f"{kind}-status", **extras, **state})

    async def on_output(_key: str, lines: list[str]) -> None:
        await _deliver(emit, {"type": f"{kind}-output", **extras, "lines": lines})

    return on_status_change, on_output


async def stop_and_notify(
    agent: SkillAgent, key: str, kind: str, emit: Emit, **extras: object
) -> dict:
    """Cancels an in-flight run (its artifact rolls back) and pings canvases to leave the panel."""
    state = await agent.stop(key)
    await _deliver(emit, {"type": f"{kind}-status", **extras, **state})
    return state
