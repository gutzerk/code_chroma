"""How an agent window notices the user cleared its CLI's conversation (C# HistoryClear.cs)."""

from __future__ import annotations

from dataclasses import dataclass

# The events-socket message telling every canvas an agent's conversation was cleared.
HISTORY_CLEARED_EVENT = "agent-history-cleared"
# Erases xterm's scrollback (and a tap's history) but not the visible screen.
CLEAR_SCROLLBACK = "\x1b[3J"
# Erases screen and scrollback before a resumed process reprints the conversation.
RESET_SCREEN = "\x1b[0m\x1b[H\x1b[2J" + CLEAR_SCROLLBACK
# How long the CLI gets to finish its own clear before the repaint key.
REPAINT_DELAY_SECONDS = 0.3

# The bracketed-paste start marker, after its ESC.
PASTE_START = "[200~"

_MAX_LINE = 256
_PASTE_END = "[201~"


@dataclass(frozen=True)
class ClearWatch:
    """Typed commands to watch (none when a hook reports the clear) and the repaint input."""

    typed_commands: tuple[str, ...]
    repaint: str | None


def clear_watch_for(adapter: object | None, hooked: bool) -> ClearWatch | None:
    """The adapter's clear definition; a hook-reported clear needs no typed watching once wired."""
    if adapter is None:
        return None
    commands = tuple(getattr(adapter, "clear_commands", ()))
    typed = () if getattr(adapter, "hook_reports_clear", False) and hooked else commands
    return ClearWatch(typed, getattr(adapter, "repaint_input", None))


class TypedClearDetector:
    """Follows keystrokes per line; only CR submits; an edited or multi-line line never matches."""

    def __init__(self, commands: tuple[str, ...]) -> None:
        self._commands = frozenset(commands)
        self._line: list[str] = []
        self._escape: list[str] = []
        self._in_escape = False
        self._in_paste = False
        self._unknown = False

    def feed(self, data: str) -> bool:
        """Feeds one input chunk; True when a line submitted in it was a clear command."""
        cleared = False
        for ch in data:
            if self._in_escape:
                self._step_escape(ch)
            elif ch == "\x1b":
                self._in_escape = True
                self._escape = []
            elif ch == "\r" and not self._in_paste:
                cleared = self._submit() or cleared
            elif ch in "\r\n":
                # Ctrl+J and a pasted line break add a composer line instead of submitting.
                self._unknown = True
            elif ch in "\x7f\b":
                if self._line:
                    self._line.pop()
            elif ch in "\x15\x03":
                self._reset()
            elif ch < " " or len(self._line) >= _MAX_LINE:
                self._unknown = True
            else:
                self._line.append(ch)
        return cleared

    def _step_escape(self, ch: str) -> None:
        """Bracketed-paste markers keep the line; any other sequence moves the cursor."""
        self._escape.append(ch)
        if len(self._escape) == 1 and ch not in "[O":
            self._in_escape = False
            self._unknown = True
            return
        if len(self._escape) < 2 or not "@" <= ch <= "~":
            return
        self._in_escape = False
        sequence = "".join(self._escape)
        if sequence == PASTE_START:
            self._in_paste = True
        elif sequence == _PASTE_END:
            self._in_paste = False
        else:
            self._unknown = True

    def skip(self, data: str) -> None:
        """Notes bridge-typed text: unseen on the line, so it is unknown until its CR submits it."""
        if "\r" in data:
            self._reset()
        elif data:
            self._unknown = True

    def _submit(self) -> bool:
        text = "".join(self._line).strip()
        match = not self._unknown and bool(text) and text.split(" ", 1)[0] in self._commands
        self._reset()
        return match

    def _reset(self) -> None:
        self._line = []
        self._unknown = False
