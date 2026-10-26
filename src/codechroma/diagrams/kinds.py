"""The built-in diagram kinds the Draw dialog lists, read from `kinds.json` (shared with C#)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_PATH = Path(__file__).with_name("kinds.json")


@lru_cache(maxsize=1)
def _data() -> dict:
    return json.loads(_PATH.read_text(encoding="utf-8"))


def list_kinds() -> list[dict]:
    """Every built-in kind: id, name, purpose."""
    return [dict(kind) for kind in _data()["kinds"]]


def kind_ids() -> set[str]:
    """The ids a launch may name as its `diagram_type`."""
    return {kind["id"] for kind in _data()["kinds"]}


def schematics() -> tuple[str, ...]:
    """The schematic ids a saved custom type may name."""
    return tuple(_data()["schematics"])


def max_request_chars() -> int:
    """The longest request a launch may carry."""
    return int(_data()["max_request_chars"])
