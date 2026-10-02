"""Records call/return/raise/unwind events for in-repo frames via sys.monitoring or settrace."""

from __future__ import annotations

import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from types import CodeType, FrameType, ModuleType
from typing import TYPE_CHECKING, cast

from codechroma.trace.mapper import FrameMapper
from codechroma.trace.models import TraceError, TraceStep

if TYPE_CHECKING:
    from _typeshed import TraceFunction

_MAX_ARGS_LEN = 200
_MAX_MSG_LEN = 200
_TOOL_ID = getattr(getattr(sys, "monitoring", None), "PROFILER_ID", 2)
_MISSING = object()
# Control-flow exceptions that signal normal iteration/teardown, not a runtime error.
_BENIGN_EXCEPTIONS = (StopIteration, StopAsyncIteration, GeneratorExit)


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


@dataclass(slots=True)
class _StackFrame:
    node_id: str
    start_ms: float
    caller_node_id: str | None


class Tracer:
    """Captures an ordered list of TraceSteps for a run, mapping each frame to a graph node."""

    def __init__(
        self,
        mapper: FrameMapper,
        capture_args: bool = False,
        use_monitoring: bool = True,
        on_step: Callable[[TraceStep], None] | None = None,
    ):
        self._mapper = mapper
        self._capture_args = capture_args
        # Only settrace exposes frame locals, so capturing args forces that backend.
        self._use_monitoring = (
            use_monitoring and hasattr(sys, "monitoring") and not capture_args
        )
        self._on_step = on_step
        self.steps: list[TraceStep] = []
        self.status: str = "ok"
        self._stack: list[_StackFrame] = []
        self._seq = 0
        self._start_perf = 0.0
        self._current_error: TraceError | None = None
        # Held by reference, not id(), so a GC'd exception's reused id can't misidentify a new one.
        self._current_exc: BaseException | None = None
        self._settrace_exc_frame_id: int | None = None
        self._code_cache: dict[int, str | None] = {}
        self._tool_id = _TOOL_ID

    def _now_ms(self) -> float:
        return (time.perf_counter() - self._start_perf) * 1000.0

    def _emit(
        self,
        node_id: str | None,
        event: str,
        depth: int,
        ts_ms: float,
        caller_node_id: str | None = None,
        dur_ms: float | None = None,
        args: str | None = None,
        error: TraceError | None = None,
    ) -> None:
        step = TraceStep(
            seq=self._seq,
            node_id=node_id,
            event=event,  # type: ignore[arg-type]
            depth=depth,
            caller_node_id=caller_node_id,
            ts_ms=ts_ms,
            dur_ms=dur_ms,
            args=args,
            error=error,
        )
        self._seq += 1
        self.steps.append(step)
        if self._on_step is not None:
            self._on_step(step)

    def _caller(self) -> str | None:
        return self._stack[-1].node_id if self._stack else None

    def _on_call(self, node_id: str, args: str | None) -> None:
        now = self._now_ms()
        caller = self._caller()
        self._emit(node_id, "call", len(self._stack), now, caller_node_id=caller, args=args)
        self._stack.append(_StackFrame(node_id=node_id, start_ms=now, caller_node_id=caller))

    def _on_return(self, node_id: str) -> None:
        frame = self._pop(node_id)
        if frame is None:
            return
        now = self._now_ms()
        self._emit(node_id, "return", len(self._stack), now, dur_ms=now - frame.start_ms)

    def _on_unwind(self, node_id: str, exc: BaseException | None = None) -> None:
        frame = self._pop(node_id)
        if frame is None:
            return
        now = self._now_ms()
        # A frame exiting on a control-flow exception (e.g. exhausted generator) is a normal close.
        if exc is not None and isinstance(exc, _BENIGN_EXCEPTIONS):
            self._emit(node_id, "return", len(self._stack), now, dur_ms=now - frame.start_ms)
            return
        self._emit(
            node_id,
            "unwind",
            len(self._stack),
            now,
            dur_ms=now - frame.start_ms,
            error=self._current_error,
        )

    def _pop(self, node_id: str) -> _StackFrame | None:
        if self._stack and self._stack[-1].node_id == node_id:
            return self._stack.pop()
        for index in range(len(self._stack) - 1, -1, -1):
            if self._stack[index].node_id == node_id:
                return self._stack.pop(index)
        return None

    def _on_raise(self, node_id: str, exc: BaseException) -> None:
        # Control-flow exceptions (generator exhaustion, teardown) aren't runtime errors.
        if isinstance(exc, _BENIGN_EXCEPTIONS):
            return
        # Run status is decided by record_trace (did an exception escape the top call), not here.
        if exc is not self._current_exc:
            self._current_exc = exc
            self._current_error = TraceError(
                type=type(exc).__name__,
                message=_truncate(str(exc), _MAX_MSG_LEN),
                handled=False,
            )
            self._emit(
                node_id,
                "raise",
                len(self._stack) - 1 if self._stack else 0,
                self._now_ms(),
                error=self._current_error,
            )

    def _on_handled(self) -> None:
        if self._current_error is not None:
            self._current_error.handled = True
        self._current_exc = None

    # --- sys.monitoring backend ---

    def start(self) -> None:
        self._start_perf = time.perf_counter()
        if self._use_monitoring:
            self._start_monitoring()
        else:
            sys.settrace(self._settrace)

    def stop(self) -> list[TraceStep]:
        if self._use_monitoring:
            self._stop_monitoring()
        else:
            sys.settrace(None)
        return self.steps

    def _acquire_tool_id(self, mon: ModuleType) -> int | None:
        # Prefer the configured id, then any free monitoring slot; None if a profiler owns them all.
        for tool_id in (_TOOL_ID, *range(6)):
            try:
                if mon.get_tool(tool_id) is not None:
                    continue
                mon.use_tool_id(tool_id, "codechroma-tracer")
                return tool_id
            except ValueError:
                continue
        return None

    def _start_monitoring(self) -> None:
        mon = sys.monitoring
        tool_id = self._acquire_tool_id(mon)
        if tool_id is None:
            self._use_monitoring = False
            return
        self._tool_id = tool_id
        events = mon.events
        mon.register_callback(tool_id, events.PY_START, self._mon_start)
        mon.register_callback(tool_id, events.PY_RETURN, self._mon_return)
        mon.register_callback(tool_id, events.RAISE, self._mon_raise)
        mon.register_callback(tool_id, events.PY_UNWIND, self._mon_unwind)
        mon.register_callback(tool_id, events.EXCEPTION_HANDLED, self._mon_handled)
        mon.set_events(
            tool_id,
            events.PY_START
            | events.PY_RETURN
            | events.RAISE
            | events.PY_UNWIND
            | events.EXCEPTION_HANDLED,
        )

    def _stop_monitoring(self) -> None:
        mon = sys.monitoring
        mon.set_events(self._tool_id, 0)
        for event in (
            mon.events.PY_START,
            mon.events.PY_RETURN,
            mon.events.RAISE,
            mon.events.PY_UNWIND,
            mon.events.EXCEPTION_HANDLED,
        ):
            mon.register_callback(self._tool_id, event, None)
        mon.free_tool_id(self._tool_id)

    def _resolve_code(self, code: CodeType) -> str | None:
        key = id(code)
        cached = self._code_cache.get(key, _MISSING)
        if cached is not _MISSING:
            return cast("str | None", cached)
        node_id = self._mapper.resolve(code.co_filename, code.co_qualname, code.co_firstlineno)
        self._code_cache[key] = node_id
        return node_id

    def _mon_start(self, code: CodeType, _offset: int) -> object:
        node_id = self._resolve_code(code)
        if node_id is None:
            return sys.monitoring.DISABLE
        self._on_call(node_id, None)
        return None

    def _mon_return(self, code: CodeType, _offset: int, _retval: object) -> object:
        node_id = self._resolve_code(code)
        if node_id is not None:
            self._on_return(node_id)
        return None

    def _mon_raise(self, code: CodeType, _offset: int, exc: BaseException) -> object:
        node_id = self._resolve_code(code)
        if node_id is not None:
            self._on_raise(node_id, exc)
        return None

    def _mon_unwind(self, code: CodeType, _offset: int, exc: BaseException) -> object:
        node_id = self._resolve_code(code)
        if node_id is not None:
            self._on_unwind(node_id, exc)
        return None

    def _mon_handled(self, _code: CodeType, _offset: int, _exc: BaseException) -> object:
        self._on_handled()
        return None

    # --- sys.settrace fallback backend ---

    def _settrace(self, frame: FrameType, event: str, arg: object) -> TraceFunction | None:
        code = frame.f_code
        node_id = self._mapper.resolve(code.co_filename, code.co_qualname, frame.f_lineno)
        if node_id is None:
            return None
        if event == "call":
            args = self._repr_locals(frame) if self._capture_args else None
            self._on_call(node_id, args)
        elif event == "return":
            self._on_return(node_id)
        elif event == "exception" and isinstance(arg, tuple) and len(arg) == 3:
            self._on_raise(node_id, arg[1])
            self._settrace_exc_frame_id = id(frame)
        elif event == "line" and self._settrace_exc_frame_id == id(frame):
            # Execution resumed where the exception last propagated through, so it was caught here.
            self._on_handled()
            self._settrace_exc_frame_id = None
        return self._settrace

    def _repr_locals(self, frame: FrameType) -> str | None:
        try:
            items = ", ".join(f"{k}={_truncate(repr(v), 40)}" for k, v in frame.f_locals.items())
        except Exception:
            return None
        return _truncate(items, _MAX_ARGS_LEN) or None
