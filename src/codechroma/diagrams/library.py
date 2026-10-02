"""Cross-project library of user-authored diagram-type definitions, one JSON file per type.

Lives in the user's home directory rather than the repo: a diagram *type* ("data flow, grouped by
layer") is a reusable authoring artifact, not something tied to one codebase. Mirrors
`bridge/agents/worktree.py`'s `worktrees_root()` shape, including its env-var escape hatch -- though
this is the first *live* home-dir store on the Python side (worktrees were deliberately migrated
*out* of `~/.codechroma`; see that module's docstring for why this feature doesn't repeat that
mistake for worktrees themselves).
"""

from __future__ import annotations

import os
import re
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from codechroma.config import settings
from codechroma.diagrams.styles import STYLES
from codechroma.io import delete_file_if_exists, load_json, write_json

__all__ = [
    "DIAGRAM_TYPES_DIR_ENV",
    "valid_type_id",
    "library_dir",
    "type_path",
    "list_types",
    "load_type",
    "save_type",
    "delete_type",
    "validate_definition",
]

DIAGRAM_TYPES_DIR_ENV = "codechroma_DIAGRAM_TYPES_DIR"


@lru_cache(maxsize=1)
def _type_id_re() -> re.Pattern:
    return re.compile(settings.custom_diagrams.type_id_pattern)


def library_dir() -> Path:
    """`$codechroma_DIAGRAM_TYPES_DIR` when set, else `~/.codechroma/diagram-types`."""
    configured = os.environ.get(DIAGRAM_TYPES_DIR_ENV, "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".codechroma" / "diagram-types"


def valid_type_id(type_id: str) -> bool:
    """`type_id` becomes a filename on disk -- reject anything that isn't a plain slug."""
    # fullmatch, not match: `$` alone still lets one trailing "\n" through under plain match().
    return bool(_type_id_re().fullmatch(type_id))


def type_path(type_id: str) -> Path:
    return library_dir() / f"{type_id}.json"


def _type_count() -> int:
    """How many `*.json` files the library holds -- a bare count, no need to parse each one."""
    directory = library_dir()
    return sum(1 for _ in directory.glob("*.json")) if directory.is_dir() else 0


def list_types() -> list[dict]:
    """Every saved definition's `{id, title, description, style}` summary, sorted by id."""
    directory = library_dir()
    if not directory.is_dir():
        return []
    summaries = []
    for path in sorted(directory.glob("*.json")):
        data = load_json(path)
        if not isinstance(data, dict) or not isinstance(data.get("id"), str):
            continue
        summaries.append(
            {
                "id": data["id"],
                "title": data.get("title", data["id"]),
                "description": data.get("description", ""),
                "style": data.get("style"),
            }
        )
    return summaries


def load_type(type_id: str) -> dict | None:
    """One definition by id; None for an invalid id, an unknown one, or a malformed file."""
    if not valid_type_id(type_id):
        return None
    data = load_json(type_path(type_id))
    return data if data and data.get("id") == type_id else None


_VALID_LAYOUT_DIRECTIONS = ("TB", "LR")
_VALID_CHECK_SHAPES = ("hierarchical", "flat")


def _valid_relation_kind(kind: object) -> bool:
    return isinstance(kind, dict) and isinstance(kind.get("id"), str) and bool(kind["id"].strip())


def _valid_style(style: object) -> bool:
    """A catalog name, or an inline style dict (loosened per contracts/style-catalog.md)."""
    return isinstance(style, dict) or style in STYLES


def _valid_addons(addons: object) -> bool:
    return not isinstance(addons, dict) or all(isinstance(v, bool) for v in addons.values())


def _valid_overlays(overlays: object, known: set[str] | None) -> bool:
    if not isinstance(overlays, list) or not all(isinstance(o, str) for o in overlays):
        return False
    return known is None or all(o in known for o in overlays)


def _valid_context(context: object, known: set[str] | None) -> bool:
    if context is None:
        return True
    return isinstance(context, str) and (known is None or context in known)


def _valid_checks(checks: object) -> bool:
    if checks is None:
        return True
    return isinstance(checks, dict) and checks.get("shape") in _VALID_CHECK_SHAPES


# Mirrors review._REVIEW_RESOLVERS' own keys -- a config outside this set never resolves.
_VALID_REVIEW_PAIRS = {("explanatory", "impact-changes")}


def _valid_review(review: object, known: set[str] | None) -> bool:
    if review is None:
        return True
    if not isinstance(review, dict):
        return False
    pair = (review.get("axis"), review.get("agent_factory"))
    if pair not in _VALID_REVIEW_PAIRS:
        return False
    return known is None or pair[1] in known


def validate_definition(
    definition: dict,
    *,
    known_context_providers: set[str] | None = None,
    known_overlay_providers: set[str] | None = None,
    known_review_agents: set[str] | None = None,
) -> list[str]:
    """Field-level problems, incl. layout/grouping/relation_kinds shape -- [] means it's savable."""
    # known_* name registered provider/agent-factory names; None skips that check (FR-011).
    problems = []
    type_id = definition.get("id")
    if not isinstance(type_id, str) or not valid_type_id(type_id):
        problems.append(f"id must match {settings.custom_diagrams.type_id_pattern!r}")
    if not isinstance(definition.get("title"), str) or not definition["title"].strip():
        problems.append("title is required")
    if not _valid_style(definition.get("style")):
        problems.append(f"style must be one of {sorted(STYLES)} or an inline style object")
    instructions = definition.get("instructions")
    if not isinstance(instructions, str) or not instructions.strip():
        problems.append("instructions is required")
    layout = definition.get("layout")
    if not isinstance(layout, dict) or layout.get("direction") not in _VALID_LAYOUT_DIRECTIONS:
        problems.append(f"layout must have direction one of {_VALID_LAYOUT_DIRECTIONS}")
    grouping = definition.get("grouping")
    if not isinstance(grouping, dict) or not isinstance(grouping.get("enabled"), bool):
        problems.append("grouping must be an object with a boolean 'enabled'")
    relation_kinds = definition.get("relation_kinds")
    valid_kinds = isinstance(relation_kinds, list) and all(
        _valid_relation_kind(k) for k in relation_kinds
    )
    if not valid_kinds:
        problems.append("relation_kinds must be a list of {'id': str, 'label': str} objects")
    if not _valid_addons(definition.get("addons")):
        problems.append("addons must be an object of booleans")
    if not _valid_overlays(definition.get("overlays", []), known_overlay_providers):
        problems.append("overlays must be a list of registered overlay names")
    if not _valid_context(definition.get("context"), known_context_providers):
        problems.append("context must be null or a registered context provider name")
    if not _valid_checks(definition.get("checks")):
        problems.append(f"checks.shape must be one of {_VALID_CHECK_SHAPES}")
    if not _valid_review(definition.get("review"), known_review_agents):
        problems.append("review must be null or an object with a known axis and agent_factory")
    return problems


def save_type(
    definition: dict,
    *,
    known_context_providers: set[str] | None = None,
    known_overlay_providers: set[str] | None = None,
    known_review_agents: set[str] | None = None,
) -> dict:
    """Validates, stamps timestamps, and writes a definition; raises ValueError if it's invalid."""
    problems = validate_definition(
        definition,
        known_context_providers=known_context_providers,
        known_overlay_providers=known_overlay_providers,
        known_review_agents=known_review_agents,
    )
    type_id = definition.get("id")
    existing = load_type(type_id) if isinstance(type_id, str) else None
    if existing is None and _type_count() >= settings.custom_diagrams.max_types:
        problems.append(f"library already holds {settings.custom_diagrams.max_types} types")
    if problems:
        raise ValueError("; ".join(problems))
    assert isinstance(type_id, str)  # validate_definition already rejected a missing/bad id above
    now = datetime.now(UTC).isoformat()
    stamped = {
        **definition,
        "schema_version": definition.get("schema_version", 1),
        "created_at": existing.get("created_at") if existing else now,
        "updated_at": now,
    }
    write_json(type_path(type_id), stamped)
    return stamped


def delete_type(type_id: str) -> bool:
    """Removes a saved definition; False if the id is invalid or nothing was there."""
    if not valid_type_id(type_id):
        return False
    return delete_file_if_exists(type_path(type_id))
