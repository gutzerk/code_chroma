"""Turns a live PTY screen into `idle` / `blocked` / `working`, driven by a declarative manifest.

Three sources, in priority order, and the first rule that fires wins:

1. **The foreground process.** Not the agent (the user went into `vim`, `less`, a nested shell) →
   `foreign`: the detector goes quiet and the last known value is held.
2. **OSC sequences.** The title and `OSC 9;4` progress — the cheapest and most stable signal.
3. **The bottom N lines of the rendered screen.**

🔴 Unknown means *hold the previous status*, never `idle`. A detector that guesses `idle` while an
agent is quietly waiting for permission is worse than one that says nothing. `stopped` and `exited`
are set by AgentManager from the process itself, never inferred from pixels.
"""

from __future__ import annotations

import logging
import re
import time
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from codechroma.bridge.resources import resource_path
from codechroma.config import settings

logger = logging.getLogger("uvicorn.error")

STATUS_IDLE = "idle"
STATUS_BLOCKED = "blocked"
STATUS_WORKING = "working"

# Checked in this order within each source, so two rules that both fire resolve deterministically.
_SECTIONS = (STATUS_BLOCKED, STATUS_WORKING, STATUS_IDLE)


def default_hysteresis_seconds() -> float:
    # A braille spinner blinking between frames must not twitch the LED.
    return settings.agent_status.hysteresis_seconds


def default_min_emit_interval() -> float:
    # At most four status messages per second per agent over the socket.
    return settings.agent_status.min_emit_interval_seconds


def default_tail_lines() -> int:
    return settings.agent_status.default_tail_lines


# Via resource_path, not __file__: a frozen bundle keeps data files under _MEIPASS.
MANIFEST_DIR = resource_path("detect")


@dataclass(frozen=True)
class _Section:
    """One status's rules: the two OSC signals and the rendered-screen patterns."""

    title_regex: tuple[re.Pattern, ...] = ()
    screen_regex: tuple[re.Pattern, ...] = ()
    osc_progress: frozenset[str] = frozenset()

    def matches_osc(self, title: str, progress: str) -> bool:
        """An empty `progress` is "never reported", so it is silence rather than a signal."""
        if progress and progress in self.osc_progress:
            return True
        return any(pattern.search(title) for pattern in self.title_regex)

    def matches_screen(self, tail: list[str]) -> bool:
        return any(pattern.search(line) for pattern in self.screen_regex for line in tail)


@dataclass(frozen=True)
class StatusRules:
    """A parsed manifest. An empty one classifies nothing, which degrades to "always hold"."""

    name: str = "unknown"
    process: tuple[str, ...] = ()
    tail_lines: int = field(default_factory=default_tail_lines)
    sections: dict[str, _Section] = field(default_factory=dict)
    transient: _Section = _Section()

    def section(self, status: str) -> _Section:
        return self.sections.get(status, _Section())


def load_manifest(path: Path) -> StatusRules:
    """Parses a detection manifest; a missing or malformed one yields rules that never classify."""
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("agent status: unusable manifest at %s — the detector will hold", path)
        return StatusRules()
    try:
        return StatusRules(
            name=str(raw.get("name", path.stem)),
            process=tuple(str(entry) for entry in raw.get("process", []) or []),
            tail_lines=_positive_int(raw.get("tail_lines"), default_tail_lines()),
            sections={status: _section(raw.get(status)) for status in _SECTIONS},
            transient=_section(raw.get("transient")),
        )
    except (TypeError, ValueError, re.error):
        logger.warning("agent status: malformed manifest at %s — the detector will hold", path)
        return StatusRules()


def load_manifest_for(kind: str) -> StatusRules:
    """The shipped manifest for an agent kind; an unknown kind gets rules that never classify."""
    return load_manifest(MANIFEST_DIR / f"{kind}.toml")


def _section(raw: object) -> _Section:
    if not isinstance(raw, dict):
        return _Section()
    return _Section(
        title_regex=_compile(raw.get("title_regex")),
        screen_regex=_compile(raw.get("screen_regex")),
        osc_progress=frozenset(str(entry) for entry in raw.get("osc_progress", []) or []),
    )


def _compile(patterns: object) -> tuple[re.Pattern, ...]:
    if not isinstance(patterns, list):
        return ()
    compiled = []
    for pattern in patterns:
        try:
            compiled.append(re.compile(str(pattern)))
        except re.error:
            logger.warning("agent status: skipping unparseable pattern %r", pattern)
    return tuple(compiled)


def _positive_int(value: object, fallback: int) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return fallback


class StatusDetector:
    """Holds one agent's status across observations, applying hysteresis and a send debounce."""

    def __init__(
        self,
        rules: StatusRules,
        initial: str = STATUS_IDLE,
        hysteresis_seconds: float | None = None,
        min_emit_interval: float | None = None,
    ) -> None:
        self.rules = rules
        self.status = initial
        self._hysteresis = (
            hysteresis_seconds if hysteresis_seconds is not None else default_hysteresis_seconds()
        )
        self._min_emit_interval = (
            min_emit_interval if min_emit_interval is not None else default_min_emit_interval()
        )
        self._pending: tuple[str, float] | None = None
        self._last_emit = float("-inf")

    def observe(
        self,
        tail: list[str],
        title: str = "",
        progress: str = "",
        process: str | None = None,
        now: float | None = None,
    ) -> str | None:
        """The new status once it held for the hysteresis window, else None (nothing changed)."""
        moment = time.monotonic() if now is None else now
        try:
            candidate = self.classify(tail, title, progress, process)
        except Exception:
            # A detector exception must never reach the socket, let alone block terminal input.
            logger.exception("agent status: classification failed — holding %s", self.status)
            candidate = None
        if candidate is None or candidate == self.status:
            self._pending = None
            return None
        if self._pending is None or self._pending[0] != candidate:
            self._pending = (candidate, moment)
            return None
        if moment - self._pending[1] < self._hysteresis:
            return None
        if moment - self._last_emit < self._min_emit_interval:
            return None
        self.status = candidate
        self._pending = None
        self._last_emit = moment
        return candidate

    def classify(
        self, tail: list[str], title: str, progress: str, process: str | None
    ) -> str | None:
        """The status this observation implies, or None meaning "hold whatever is current"."""
        if self.rules.process and process is not None and process not in self.rules.process:
            return None
        if self.rules.transient.matches_screen(tail):
            return None
        for status in _SECTIONS:
            if self.rules.section(status).matches_osc(title, progress):
                return status
        for status in _SECTIONS:
            if self.rules.section(status).matches_screen(tail):
                return status
        return None

    def force(self, status: str) -> None:
        """Sets the status from outside the rules — AgentManager owns stopped/exited/running."""
        self.status = status
        self._pending = None
