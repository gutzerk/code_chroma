"""Data model for a recorded execution trace: ordered steps that map onto CodeChroma nodes."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

TraceEvent = Literal["call", "return", "raise", "unwind"]
TraceStatus = Literal["ok", "failed"]


@dataclass(slots=True)
class TraceError:
    """An exception observed while tracing, tagged with whether it was caught upstack."""

    type: str
    message: str
    handled: bool = False

    def to_dict(self) -> dict:
        return {"type": self.type, "message": self.message, "handled": self.handled}

    @classmethod
    def from_dict(cls, data: dict) -> TraceError:
        return cls(
            type=str(data.get("type", "")),
            message=str(data.get("message", "")),
            handled=bool(data.get("handled", False)),
        )


@dataclass(slots=True)
class TraceStep:
    """One captured runtime event (call/return/raise/unwind) anchored to a graph node."""

    seq: int
    node_id: str | None
    event: TraceEvent
    depth: int
    caller_node_id: str | None = None
    ts_ms: float = 0.0
    dur_ms: float | None = None
    args: str | None = None
    error: TraceError | None = None

    def to_dict(self) -> dict:
        return {
            "seq": self.seq,
            "node_id": self.node_id,
            "event": self.event,
            "depth": self.depth,
            "caller_node_id": self.caller_node_id,
            "ts_ms": self.ts_ms,
            "dur_ms": self.dur_ms,
            "args": self.args,
            "error": self.error.to_dict() if self.error is not None else None,
        }

    @classmethod
    def from_dict(cls, data: dict) -> TraceStep:
        error = data.get("error")
        return cls(
            seq=int(data.get("seq", 0)),
            node_id=data.get("node_id"),
            event=data.get("event", "call"),
            depth=int(data.get("depth", 0)),
            caller_node_id=data.get("caller_node_id"),
            ts_ms=float(data.get("ts_ms", 0.0)),
            dur_ms=data.get("dur_ms"),
            args=data.get("args"),
            error=TraceError.from_dict(error) if isinstance(error, dict) else None,
        )


@dataclass(slots=True)
class Trace:
    """A full recorded run: ordered steps plus entry/status metadata for the canvas to replay."""

    id: str
    entry: str
    created_at: str
    status: TraceStatus = "ok"
    steps: list[TraceStep] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "entry": self.entry,
            "created_at": self.created_at,
            "status": self.status,
            "steps": [step.to_dict() for step in self.steps],
        }

    @classmethod
    def from_dict(cls, data: dict) -> Trace:
        steps = data.get("steps")
        return cls(
            id=str(data.get("id", "")),
            entry=str(data.get("entry", "")),
            created_at=str(data.get("created_at", "")),
            status=data.get("status", "ok"),
            steps=[TraceStep.from_dict(s) for s in steps] if isinstance(steps, list) else [],
        )

    def summary(self) -> dict:
        return {
            "id": self.id,
            "entry": self.entry,
            "created_at": self.created_at,
            "status": self.status,
            "step_count": len(self.steps),
        }
