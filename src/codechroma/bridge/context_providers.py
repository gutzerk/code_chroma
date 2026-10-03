"""Named `ContextProvider`s -- each diagram type's own `generation_data` payload, by name.

Wraps today's `patterns_context.py`/`impact_context.py` bodies behind one `Protocol` so the
unified `GET /repos/{id}/{kind}/context` route (`routes/diagrams.py`) can dispatch by the type's
own `DiagramTypeDefinition.context` name instead of an `if kind == ...` branch. `c1` and `custom`
have no algorithmic content payload today (`context: None`) -- their envelope's `generation_data`
stays `null`; only `coverage`/`staleness` (shared add-ons, gated by `addons`) apply to them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from codechroma.bridge.epics_resolver import epics_index
from codechroma.bridge.impact_context import build_impact_context
from codechroma.bridge.patterns_context import build_patterns_context

if TYPE_CHECKING:
    from codechroma.bridge.workspaces import Workspace

__all__ = ["ContextProvider", "CONTEXT_PROVIDERS", "register_context_provider"]

# How many message entries a recorded trace may contribute to the sequence scaffold before it's
# truncated -- a trace can be thousands of steps, but a readable sequence diagram is a few dozen.
_SEQUENCE_TRACE_MSGS = 60


class ContextProvider(Protocol):
    def fetch(self, ws: Workspace, *, source: str = "diff", feature: str | None = None) -> dict: ...


class _PatternsContextProvider:
    """Verbatim what `GET /repos/{id}/patterns-context` returns today -- ignores source/feature."""

    def fetch(self, ws: Workspace, *, source: str = "diff", feature: str | None = None) -> dict:
        ws.sync()
        return build_patterns_context(ws.engine, ws.engine.snapshot())


class _ImpactContextProvider:
    """Verbatim what `GET /repos/{id}/impact-context` returns today (diff sponsor, hop 1)."""

    def fetch(self, ws: Workspace, *, source: str = "diff", feature: str | None = None) -> dict:
        return build_impact_context(ws, source, feature)


class _EpicsContextProvider:
    """The requirements portfolio -- `epics_index()`'s summaries -- for the skill to draw from."""

    def fetch(self, ws: Workspace, *, source: str = "diff", feature: str | None = None) -> dict:
        return epics_index(ws.root)


class _SequenceContextProvider:
    """The recorded-execution scaffold a sequence diagram is drawn from -- the call-chain of which
    systems/classes call which, in time order, from a real `trace/*.json` run if one exists.

    Unlike patterns (which derives a class shape from the live graph), a sequence needs an actual
    *ordering* of calls — the trace module (`codechroma/trace/`, `GET /repos/{id}/traces`) is the
    only thing that records one. The provider surfaces each trace's ordered steps as a participant +
    message skeleton, collapsed to the distinct symbols the frame mapper anchored (each `node_id` →
    one participant, each distinct caller→callee hop → one message). Deeper per-message detail
    (labels, return arrows) is the drawing skill's job — see type-sequence.md.
    """

    def fetch(self, ws: Workspace, *, source: str = "diff", feature: str | None = None) -> dict:
        traces = ws.list_traces()
        selected = traces[0] if traces else None
        scaffold = {"traces": traces}
        if selected is not None:
            trace = ws.load_trace(selected["id"])
            scaffold["trace"] = trace
            scaffold["participants"], scaffold["messages"] = _sequence_scaffold(trace)
        return scaffold


def _sequence_scaffold(trace: dict) -> tuple[list[dict], list[dict]]:
    """Reduces a loaded trace's ordered steps into distinct participant/message lists.

    Walks the `steps[]` once: register each anchored `node_id` as a participant on first sight, and
    each caller→callee hop between distinct symbols as one message (a *direct* call, not every
    nested step — so the skeleton stays readable). `return` events are dropped; the AI re-adds
    return arrows where the story needs them. Bounded by `_SEQUENCE_TRACE_MSGS`.
    """
    steps = trace.get("steps") or []
    participants: list[dict] = []
    id_index: dict[str, int] = {}
    messages: list[dict] = []

    def _participant(node_id: str) -> int:
        got = id_index.get(node_id)
        if got is not None:
            return got
        idx = len(participants)
        participants.append({"id": node_id, "name": node_id.split("::")[-1], "node_id": node_id})
        id_index[node_id] = idx
        return idx

    for step in steps:
        if not isinstance(step, dict) or step.get("event") != "call":
            continue
        caller = step.get("caller_node_id")
        callee = step.get("node_id")
        if not (isinstance(caller, str) and isinstance(callee, str)):
            continue
        if caller == callee:
            continue
        if len(messages) >= _SEQUENCE_TRACE_MSGS:
            break
        from_idx = _participant(caller)
        to_idx = _participant(callee)
        # Only the first direct hop between a given symbol pair -- distinct participants, distinct
        # messages. Overlapping/hot-sign callers collapse so the scaffold isn't one huge loop.
        key = (participants[from_idx]["id"], participants[to_idx]["id"],
               str(step.get("args") or ""))
        if any((m["from"], m["to"], m["args"]) == key for m in messages):
            continue
        messages.append({
            "order": len(messages) + 1,
            "from_idx": from_idx,
            "to_idx": to_idx,
            "from": participants[from_idx]["id"],
            "to": participants[to_idx]["id"],
            "args": step.get("args"),
        })
    return participants, messages


CONTEXT_PROVIDERS: dict[str, ContextProvider] = {
    "patterns": _PatternsContextProvider(),
    "impact": _ImpactContextProvider(),
    "epics": _EpicsContextProvider(),
    "sequence": _SequenceContextProvider(),
}


def register_context_provider(name: str, provider: ContextProvider) -> None:
    CONTEXT_PROVIDERS[name] = provider
