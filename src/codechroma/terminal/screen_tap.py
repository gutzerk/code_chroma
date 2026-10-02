"""A rendered virtual screen on top of a PTY stream, so a detector can read what the user sees.

The raw byte stream from a TUI is repaint garbage — cursor jumps, partial redraws, erase-to-end.
Only the *rendered* screen is a stable thing to match rules against, so `PtySession` feeds the same
chunks it sends to the socket into a `pyte.Screen` here. One extra call, no second read of the fd.

`pyte` is pure Python on purpose: a native dependency would break the PyInstaller desktop build.
"""

from __future__ import annotations

import contextlib
import os
import re
import subprocess
import threading

import pyte

from codechroma.config import settings


def default_rows() -> int:
    return settings.terminal.tap_default_rows


def default_cols() -> int:
    return settings.terminal.tap_default_cols


# "" is "nothing was ever reported", which is not evidence of anything; "none" is a real OSC 9;4;0.
PROGRESS_UNKNOWN = ""
PROGRESS_NONE = "none"

# `OSC 9;4;<state>;<pct>`, read off the raw chunk: pyte drops every OSC code it has no method for.
_OSC_PROGRESS = re.compile(r"\x1b\]9;4;(\d)(?:;(\d+))?(?:\x07|\x1b\\)")

_PROGRESS_STATES = {
    "0": PROGRESS_NONE,
    "1": "running",
    "2": "error",
    "3": "running",
    "4": "warning",
}

def _process_cache_seconds() -> float:
    # `ps` costs a fork; the foreground process only changes when the user launches something.
    return settings.terminal.process_cache_seconds

# pyte reports colours by name; these are the eight SGR bases, "brown" being its word for yellow.
_SGR_BASE = {
    "black": 0,
    "red": 1,
    "green": 2,
    "brown": 3,
    "blue": 4,
    "magenta": 5,
    "cyan": 6,
    "white": 7,
}
_HEX_DIGITS = set("0123456789abcdefABCDEF")


def _colour_sgr(name: str, background: bool) -> str:
    """One SGR parameter for a pyte colour name, which may also be a 6-digit truecolour hex."""
    offset = 40 if background else 30
    if name.startswith("bright") and name[6:] in _SGR_BASE:
        return str(offset + 60 + _SGR_BASE[name[6:]])
    if name in _SGR_BASE:
        return str(offset + _SGR_BASE[name])
    if len(name) == 6 and set(name) <= _HEX_DIGITS:
        return f"{offset + 8};2;{int(name[0:2], 16)};{int(name[2:4], 16)};{int(name[4:6], 16)}"
    return str(offset + 9)


def _char_sgr(char) -> str:
    """The full attribute set for one cell, reset-prefixed so it never inherits the previous run."""
    params = ["0"]
    if char.bold:
        params.append("1")
    if char.italics:
        params.append("3")
    if char.underscore:
        params.append("4")
    if char.blink:
        params.append("5")
    if char.reverse:
        params.append("7")
    if char.strikethrough:
        params.append("9")
    params.append(_colour_sgr(char.fg, background=False))
    params.append(_colour_sgr(char.bg, background=True))
    return "\x1b[" + ";".join(params) + "m"


class ScreenTap:
    """The current rendered screen, the terminal title and the last OSC 9;4 progress state."""

    def __init__(self, rows: int | None = None, cols: int | None = None) -> None:
        rows = rows if rows is not None else default_rows()
        cols = cols if cols is not None else default_cols()
        self._screen = pyte.Screen(cols, rows)
        # Non-strict: an agent TUI emits sequences pyte doesn't model, and none of them are fatal.
        self._stream = pyte.Stream(self._screen, strict=False)
        self._progress = PROGRESS_UNKNOWN
        self._process_name: str | None = None
        self._process_checked_at = 0.0
        self._process_probe: threading.Thread | None = None

    def feed(self, chunk: str) -> None:
        """Never raises: a detector input must not be able to break the terminal it is watching."""
        # The last progress sequence in the chunk is the current one; earlier ones are superseded.
        matches = _OSC_PROGRESS.findall(chunk)
        if matches:
            self._progress = _PROGRESS_STATES.get(matches[-1][0], PROGRESS_NONE)
        with contextlib.suppress(Exception):
            self._stream.feed(chunk)

    def resize(self, rows: int, cols: int) -> None:
        """Kept in step with the PTY's own resize, so the screen matches what is displayed."""
        if rows > 0 and cols > 0:
            self._screen.resize(rows, cols)

    def tail(self, lines: int) -> list[str]:
        """The bottom `lines` rows of the rendered screen, trailing blanks trimmed off each."""
        display = [row.rstrip() for row in self._screen.display]
        return display[-lines:] if lines > 0 else []

    def render(self) -> str:
        """The whole screen redrawn as escape sequences, for a reattach that can't start mid-CSI."""
        out = ["\x1b[?25l\x1b[H\x1b[2J\x1b[3J\x1b[m"]
        for y in range(self._screen.lines):
            row = self._screen.buffer[y]
            cells = [row[x] for x in range(self._screen.columns)]
            while cells and _is_blank(cells[-1]):
                cells.pop()
            if not cells:
                continue
            out.append(f"\x1b[{y + 1};1H")
            attributes = None
            for char in cells:
                key = (char.fg, char.bg, char.bold, char.italics, char.underscore, char.reverse)
                if key != attributes:
                    out.append(_char_sgr(char))
                    attributes = key
                out.append(char.data)
        cursor = self._screen.cursor
        out.append(f"\x1b[m\x1b[{cursor.y + 1};{cursor.x + 1}H")
        if not cursor.hidden:
            out.append("\x1b[?25h")
        return "".join(out)

    @property
    def title(self) -> str:
        """Whatever the process last set via OSC 0/1/2 — Claude puts its spinner state here."""
        return getattr(self._screen, "title", "") or ""

    @property
    def progress(self) -> str:
        return self._progress

    def foreground_process(self, master_fd: int, now: float) -> str | None:
        """The process actually attached to the PTY, so `vim` doesn't get read as an agent state."""
        if now - self._process_checked_at >= _process_cache_seconds():
            self._process_checked_at = now
            self._start_process_probe(master_fd)
        return self._process_name

    def _start_process_probe(self, master_fd: int) -> None:
        """Refreshes the name off-thread: this runs on the event loop, and `ps` can hang for 2s."""
        if self._process_probe is not None and self._process_probe.is_alive():
            return
        self._process_probe = threading.Thread(
            target=self._probe_process, args=(master_fd,), daemon=True
        )
        self._process_probe.start()

    def _probe_process(self, master_fd: int) -> None:
        with contextlib.suppress(Exception):
            self._process_name = _process_name_of(master_fd)


def _is_blank(char) -> bool:
    """A default-attribute space, so trailing runs of them can be dropped from a redraw."""
    return (
        char.data == " "
        and char.fg == "default"
        and char.bg == "default"
        and not char.bold
        and not char.italics
        and not char.underscore
        and not char.reverse
    )


def _process_name_of(master_fd: int) -> str | None:
    """`os.tcgetpgrp` names the foreground group; `ps` turns that into a command name."""
    try:
        pgid = os.tcgetpgrp(master_fd)
    except OSError:
        return None
    try:
        result = subprocess.run(
            ["ps", "-o", "comm=", "-p", str(pgid)], capture_output=True, text=True, timeout=2
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    return os.path.basename(result.stdout.strip()) or None
