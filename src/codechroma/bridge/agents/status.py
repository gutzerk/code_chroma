"""Turns a live PTY screen into `idle` / `blocked` / `working` with a herdr-style rule manifest.

Each `detect/<kind>.toml` holds `[[rules]]`: a `state`, a `priority`, a `region` of the input
(`osc_title`, `osc_progress`, `bottom_non_empty_lines(N)`, `prompt_box_body`, ...) and nested
`contains` / `regex` / `line_regex` / `all` / `any` / `not` gates. The highest-priority rule whose
gate matches its region wins (file order breaks ties). The port follows herdr's
`src/detect/manifest.rs`; the C# twin is `dotnet/CodeChroma.Bridge/Agents/StatusDetector.cs`.

🔴 Unknown means *hold the previous status*: an `unknown` / `skip_state_update` rule, a foreign
foreground process and a malformed manifest all hold. No match holds too unless the manifest opts
into herdr's idle fallback with `no_match = "idle"`. `stopped` and `exited` come from the process.
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
STATE_UNKNOWN = "unknown"

_STATES = frozenset({STATUS_IDLE, STATUS_BLOCKED, STATUS_WORKING, STATE_UNKNOWN})
_GATE_KEYS = frozenset({"all", "any", "not", "contains", "regex", "line_regex"})
_RULE_KEYS = _GATE_KEYS | {
    "id",
    "state",
    "priority",
    "region",
    "visible_idle",
    "visible_blocker",
    "visible_working",
    "skip_state_update",
}
_PLAIN_REGIONS = frozenset(
    {
        "whole_recent",
        "after_last_prompt_marker",
        "before_current_prompt_marker",
        "whole_recent_without_current_prompt_marker",
        "current_prompt_block_marker",
        "after_current_prompt_block_marker",
        "prompt_box_body",
        "above_prompt_box",
        "last_non_empty_above_prompt_box",
        "after_last_horizontal_rule",
        "osc_title",
        "osc_progress",
    }
)
_COUNTED_REGION = re.compile(
    r"^(bottom_lines|bottom_non_empty_lines|top_non_empty_lines)\((\d+)\)$"
)

# herdr's PendingIdleConfirmation: working -> plain idle waits for 3 more sightings or 700 ms.
IDLE_CONFIRMATIONS = 3
IDLE_CONFIRMATION_CAP_SECONDS = 0.7


def default_hysteresis_seconds() -> float:
    # A braille spinner blinking between frames must not twitch the LED.
    return settings.agent_status.hysteresis_seconds


def default_min_emit_interval() -> float:
    # At most four status messages per second per agent over the socket.
    return settings.agent_status.min_emit_interval_seconds


def default_tail_lines() -> int:
    return settings.agent_status.default_tail_lines


MANIFEST_DIR = resource_path("detect")


@dataclass(frozen=True)
class Gate:
    """One matcher node: own matchers, every `all`, one `any` (if any) and no `not` must hold."""

    contains: tuple[str, ...] = ()
    regex: tuple[re.Pattern, ...] = ()
    line_regex: tuple[re.Pattern, ...] = ()
    all: tuple[Gate, ...] = ()
    any: tuple[Gate, ...] = ()
    not_: tuple[Gate, ...] = ()

    def matches(self, text: str, lower: str) -> bool:
        if not all(needle in lower for needle in self.contains):
            return False
        if not all(pattern.search(text) for pattern in self.regex):
            return False
        if self.line_regex:
            lines = _lines(text)
            if not all(any(p.search(line) for line in lines) for p in self.line_regex):
                return False
        if not all(nested.matches(text, lower) for nested in self.all):
            return False
        if self.any and not any(nested.matches(text, lower) for nested in self.any):
            return False
        return not any(nested.matches(text, lower) for nested in self.not_)


@dataclass(frozen=True)
class Rule:
    """One `[[rules]]` entry of a manifest."""

    id: str
    state: str
    priority: int
    region: str
    gate: Gate
    visible_idle: bool = False
    visible_blocker: bool = False
    visible_working: bool = False
    skip_state_update: bool = False


@dataclass(frozen=True)
class Classification:
    """One verdict: the state (None = hold), herdr's visible-chrome flags and the winning rule."""

    state: str | None = None
    visible_idle: bool = False
    visible_blocker: bool = False
    visible_working: bool = False
    rule_id: str | None = None


_HOLD = Classification()


@dataclass(frozen=True)
class StatusRules:
    """A parsed manifest. An empty one classifies nothing, which degrades to "always hold"."""

    name: str = "unknown"
    process: tuple[str, ...] = ()
    tail_lines: int = field(default_factory=default_tail_lines)
    rules: tuple[Rule, ...] = ()
    aliases: tuple[str, ...] = ()
    no_match: str | None = None

    @property
    def classifies(self) -> bool:
        """False for an unknown kind's empty rules, which never report idle."""
        return bool(self.rules)

    def evaluate(self, tail: list[str], title: str = "", progress: str = "") -> Classification:
        """The winning rule's verdict over this screen and OSC state (no process filter)."""
        if not self.rules:
            return _HOLD
        screen = DetectScreen(tail)
        best: Rule | None = None
        for rule in self.rules:
            text = screen.region(rule.region, title, progress)
            if (best is None or rule.priority > best.priority) and rule.gate.matches(
                text, text.lower()
            ):
                best = rule
        if best is None:
            return Classification(state=self.no_match)
        if best.skip_state_update or best.state == STATE_UNKNOWN:
            return Classification(rule_id=best.id)
        return Classification(
            state=best.state,
            visible_idle=best.visible_idle and best.state == STATUS_IDLE,
            visible_blocker=best.visible_blocker and best.state == STATUS_BLOCKED,
            visible_working=best.visible_working and best.state == STATUS_WORKING,
            rule_id=best.id,
        )


def load_manifest(path: Path) -> StatusRules:
    """Parses a detection manifest; a missing or malformed one yields rules that never classify."""
    try:
        return parse_manifest(path.read_text(encoding="utf-8"), path.stem)
    except OSError:
        logger.warning("agent status: no manifest at %s — the detector will hold", path)
    except (TypeError, ValueError, KeyError, re.error) as error:
        logger.warning("agent status: malformed manifest at %s (%s) — will hold", path, error)
    return StatusRules()


def parse_manifest(text: str, fallback_name: str = "unknown") -> StatusRules:
    """Parses manifest text, raising on anything malformed (TOML, region, state, key or regex)."""
    raw = tomllib.loads(text)
    no_match = raw.get("no_match", "hold")
    if no_match not in ("hold", STATUS_IDLE):
        raise ValueError(f"no_match must be 'hold' or 'idle', not {no_match!r}")
    rules = raw.get("rules", [])
    if not isinstance(rules, list) or not rules:
        raise ValueError("a manifest needs at least one [[rules]] entry")
    return StatusRules(
        name=str(raw.get("id", raw.get("name", fallback_name))),
        process=tuple(str(entry) for entry in raw.get("process", []) or []),
        tail_lines=_positive_int(raw.get("tail_lines"), default_tail_lines()),
        rules=tuple(_rule(entry) for entry in rules),
        aliases=tuple(str(entry) for entry in raw.get("aliases", []) or []),
        no_match=STATUS_IDLE if no_match == STATUS_IDLE else None,
    )


def load_manifest_for(kind: str) -> StatusRules:
    """The shipped manifest for an agent kind or alias; an unknown kind never classifies."""
    direct = MANIFEST_DIR / f"{kind}.toml"
    if direct.is_file():
        return load_manifest(direct)
    for path in sorted(MANIFEST_DIR.glob("*.toml")):
        rules = load_manifest(path)
        if kind in rules.aliases:
            return rules
    return StatusRules()


def _rule(raw: object) -> Rule:
    if not isinstance(raw, dict):
        raise TypeError("each [[rules]] entry must be a table")
    unknown = set(raw) - _RULE_KEYS
    if unknown:
        raise ValueError(f"unknown rule keys {sorted(unknown)}")
    state = str(raw.get("state", STATE_UNKNOWN))
    if state not in _STATES:
        raise ValueError(f"unknown state {state!r}")
    region = str(raw.get("region", "whole_recent")).strip()
    if region not in _PLAIN_REGIONS and not _valid_count(region):
        raise ValueError(f"unknown region {region!r}")
    priority = raw.get("priority", 0)
    if not isinstance(priority, int) or isinstance(priority, bool):
        raise TypeError("priority must be an integer")
    return Rule(
        id=str(raw["id"]),
        state=state,
        priority=priority,
        region=region,
        gate=_gate(raw, rule=True),
        visible_idle=bool(raw.get("visible_idle", False)),
        visible_blocker=bool(raw.get("visible_blocker", False)),
        visible_working=bool(raw.get("visible_working", False)),
        skip_state_update=bool(raw.get("skip_state_update", False)),
    )


def _gate(raw: object, rule: bool = False) -> Gate:
    if not isinstance(raw, dict):
        raise TypeError("a gate must be a table")
    unknown = set(raw) - (_RULE_KEYS if rule else _GATE_KEYS)
    if unknown:
        raise ValueError(f"unknown gate keys {sorted(unknown)}")
    return Gate(
        contains=tuple(str(needle).lower() for needle in _strings(raw.get("contains"))),
        regex=tuple(re.compile(pattern) for pattern in _strings(raw.get("regex"))),
        line_regex=tuple(re.compile(pattern) for pattern in _strings(raw.get("line_regex"))),
        all=tuple(_gate(nested) for nested in _list(raw.get("all"))),
        any=tuple(_gate(nested) for nested in _list(raw.get("any"))),
        not_=tuple(_gate(nested) for nested in _list(raw.get("not"))),
    )


def _strings(value: object) -> list[str]:
    return [str(entry) for entry in _list(value)]


def _list(value: object) -> list:
    if value is None:
        return []
    if not isinstance(value, list):
        raise TypeError("expected an array")
    return value


def _valid_count(region: str) -> bool:
    match = _COUNTED_REGION.match(region)
    return bool(match) and not match.group(2).startswith("0")


def _positive_int(value: object, fallback: int) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return fallback


def _lines(text: str) -> list[str]:
    """Rust's `str::lines`: split on \\n, drop one trailing empty piece, strip a trailing \\r."""
    if not text:
        return []
    pieces = text.split("\n")
    if text.endswith("\n"):
        pieces.pop()
    return [piece.removesuffix("\r") for piece in pieces]


def _is_horizontal_rule(line: str) -> bool:
    trimmed = line.strip()
    if not trimmed:
        return False
    run = len(trimmed) - len(trimmed.lstrip("─"))
    if run == 0:
        return False
    return not trimmed[run:].lstrip() or run >= 3


def _codex_prompt_line(line: str) -> bool:
    return line == "›" or line.startswith("› ")


def _codex_block_marker_line(line: str) -> bool:
    return line.startswith(("•", "■", "✗", "✓"))


class DetectScreen:
    """The tail as one text (trailing blank rows dropped) plus herdr's region slicers over it."""

    def __init__(self, tail: list[str]) -> None:
        lines = list(tail)
        while lines and not lines[-1].strip():
            lines.pop()
        self.lines = lines
        self.content = "\n".join(lines)

    def region(self, spec: str, title: str, progress: str) -> str:
        if spec == "osc_title":
            return title
        if spec == "osc_progress":
            return progress
        if spec == "whole_recent":
            return self.content
        counted = _COUNTED_REGION.match(spec)
        if counted:
            return self._counted(counted.group(1), int(counted.group(2)))
        return getattr(self, f"_{spec}")()

    def _suffix(self, index: int) -> str:
        return "\n".join(self.lines[index:])

    def _prefix(self, index: int) -> str:
        return "".join(line + "\n" for line in self.lines[:index])

    def _counted(self, name: str, count: int) -> str:
        if name == "bottom_lines":
            return self._suffix(max(len(self.lines) - count, 0))
        non_empty = [i for i, line in enumerate(self.lines) if line.strip()]
        if not non_empty:
            return ""
        if name == "bottom_non_empty_lines":
            return self._suffix(non_empty[-count:][0])
        return self._prefix(non_empty[:count][-1] + 1)

    def _current_prompt_index(self) -> int | None:
        prompts = [i for i, line in enumerate(self.lines) if _codex_prompt_line(line)]
        if not prompts:
            return None
        index = prompts[-1]
        if any(_codex_block_marker_line(line) for line in self.lines[index + 1 :]):
            return None
        return index

    def _after_last_prompt_marker(self) -> str:
        prompts = [i for i, line in enumerate(self.lines) if _codex_prompt_line(line)]
        return self._suffix(prompts[-1] + 1) if prompts else self.content

    def _before_current_prompt_marker(self) -> str:
        index = self._current_prompt_index()
        return self.content if index is None else self._prefix(index)

    def _whole_recent_without_current_prompt_marker(self) -> str:
        return "" if self._current_prompt_index() is not None else self.content

    def _block_index(self) -> int | None:
        prompt = self._current_prompt_index()
        if prompt is None:
            return None
        blocks = [i for i in range(prompt) if _codex_block_marker_line(self.lines[i])]
        return blocks[-1] if blocks else None

    def _current_prompt_block_marker(self) -> str:
        index = self._block_index()
        return "" if index is None else self.lines[index]

    def _after_current_prompt_block_marker(self) -> str:
        index = self._block_index()
        return "" if index is None else self._suffix(index)

    def _prompt_box_top(self) -> int | None:
        rules = [i for i, line in enumerate(self.lines) if _is_horizontal_rule(line)]
        return rules[-2] if len(rules) >= 2 else None

    def _prompt_box_body(self) -> str:
        top = self._prompt_box_top()
        if top is None:
            return ""
        end = next(
            (i for i in range(top + 1, len(self.lines)) if _is_horizontal_rule(self.lines[i])),
            len(self.lines),
        )
        return "".join(line + "\n" for line in self.lines[top + 1 : end])

    def _above_prompt_box(self) -> str:
        top = self._prompt_box_top()
        return self.content if top is None else self._prefix(top)

    def _last_non_empty_above_prompt_box(self) -> str:
        above = _lines(self._above_prompt_box())
        return next((line for line in reversed(above) if line.strip()), "")

    def _after_last_horizontal_rule(self) -> str:
        rules = [i for i, line in enumerate(self.lines) if _is_horizontal_rule(line)]
        return self._suffix(rules[-1] + 1) if rules else self.content


class StatusDetector:
    """Holds one agent's status across observations: idle confirmation, hysteresis, debounce."""

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
        self._idle_started: float | None = None
        self._idle_confirmations = 0
        self._last = _HOLD

    @property
    def last_visible_blocker(self) -> bool:
        """True when the last classification saw a blocking dialog on screen (hooks defer to it)."""
        return self._last.visible_blocker

    @property
    def last_classification(self) -> Classification:
        return self._last

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
            self._last = _HOLD
            candidate = None
        if candidate is None or candidate == self.status:
            self._pending = None
            self._clear_idle_gate()
            return None
        hold_idle = self._hold_working_to_idle(candidate, moment)
        if self._pending is None or self._pending[0] != candidate:
            self._pending = (candidate, moment)
            return None
        if hold_idle or moment - self._pending[1] < self._hysteresis:
            return None
        if moment - self._last_emit < self._min_emit_interval:
            return None
        self.status = candidate
        self._pending = None
        self._last_emit = moment
        self._clear_idle_gate()
        return candidate

    def classify(
        self, tail: list[str], title: str, progress: str, process: str | None
    ) -> str | None:
        """The status this observation implies, or None meaning "hold whatever is current"."""
        if self.rules.process and process is not None and process not in self.rules.process:
            self._last = _HOLD
            return None
        self._last = self.rules.evaluate(tail, title, progress)
        return self._last.state

    def force(self, status: str) -> None:
        """Sets the status from outside the rules — AgentManager owns stopped/exited/running."""
        self.status = status
        self._pending = None
        self._clear_idle_gate()

    def _hold_working_to_idle(self, candidate: str, moment: float) -> bool:
        """herdr's PendingIdleConfirmation: plain idle after working needs repeat sightings."""
        last = self._last
        if not (
            self.status == STATUS_WORKING
            and candidate == STATUS_IDLE
            and not last.visible_idle
            and not last.visible_blocker
        ):
            self._clear_idle_gate()
            return False
        if self._idle_started is None:
            self._idle_started = moment
            self._idle_confirmations = 0
            return True
        if moment - self._idle_started >= IDLE_CONFIRMATION_CAP_SECONDS:
            return False
        self._idle_confirmations += 1
        return self._idle_confirmations < IDLE_CONFIRMATIONS

    def _clear_idle_gate(self) -> None:
        self._idle_started = None
        self._idle_confirmations = 0
