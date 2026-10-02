"""Deterministic component/container id + name assignment -- Python's job, never the model's.

Generalized out of `wiki_general_agent.py`'s previously-private `_deterministic_name`/`_dedupe_id`/
`_slugify` (used by the Update delta's rename-resolution) so 058-wiki-general-deterministic-fanout's
generate pipeline can share the exact same naming rule for a fresh run's Phase-A id assignment --
one algorithm, not two copies that could drift apart.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    slug = _SLUG_RE.sub("-", text.lower()).strip("-")
    return slug or "group"


def dedupe_id(candidate: str, taken: set[str]) -> str:
    """`candidate`, or `candidate-2`/`candidate-3`/... -- the first one not already in `taken`."""
    if candidate not in taken:
        return candidate
    n = 2
    while f"{candidate}-{n}" in taken:
        n += 1
    return f"{candidate}-{n}"


def deterministic_name(files: list[str], *, top_level: bool) -> tuple[str, str]:
    """(kebab-case id, display name) from the group's heaviest folder/file -- no model call."""
    if top_level:
        counts = Counter(Path(f).parts[0] if Path(f).parts else f for f in files)
    else:
        counts = Counter(Path(f).parent.name or Path(f).stem for f in files)
    winner = counts.most_common(1)[0][0] if counts else "component"
    display = winner.replace("_", " ").replace("-", " ").strip().title() or "Component"
    return slugify(winner), display


def assign_ids(
    groups: list[tuple[str, list[str]]], *, top_level: bool
) -> dict[str, tuple[str, str]]:
    """internal_id -> (real_id, display_name) for every group, deduped against each other."""
    used_ids: set[str] = set()
    resolved: dict[str, tuple[str, str]] = {}
    for internal_id, files in groups:
        real_id, display = deterministic_name(files, top_level=top_level)
        real_id = dedupe_id(real_id, used_ids)
        used_ids.add(real_id)
        resolved[internal_id] = (real_id, display)
    return resolved
