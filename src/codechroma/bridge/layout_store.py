"""One saved-layout JSON file (box-id -> {x, y}), shared by every canvas view that persists drags.

`Workspace.layout_store(kind)` hands one out per layout kind; the load/save/sanitize logic exists
once here instead of one copy per view (the c1/patterns/hierarchy/epics triples it replaced).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from codechroma.io import load_json, write_json


def layout_path_for(root: Path, kind: str) -> Path:
    """The shared `.codechroma/{kind}-layout.json` convention every layout-bearing view follows."""
    return root / ".codechroma" / f"{kind}-layout.json"


def sanitize_layout(raw: object) -> dict:
    """Keeps only box-id -> {x, y} entries with finite numeric coordinates; drops any junk."""
    if not isinstance(raw, dict):
        return {}
    clean: dict = {}
    for box_id, value in raw.items():
        if not isinstance(box_id, str) or not isinstance(value, dict):
            continue
        x, y = value.get("x"), value.get("y")
        if isinstance(x, bool) or isinstance(y, bool):
            continue
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            clean[box_id] = {"x": float(x), "y": float(y)}
    return clean


@dataclass(frozen=True)
class LayoutStore:
    """Load/save of one view's dragged box positions, sanitized in both directions."""

    path: Path

    def load(self) -> dict:
        """The saved positions; {} when none saved yet or the file is junk."""
        return sanitize_layout(load_json(self.path))

    def save(self, raw: object) -> dict:
        """Persists sanitized positions and returns exactly what was written."""
        layout = sanitize_layout(raw)
        write_json(self.path, layout)
        return layout
