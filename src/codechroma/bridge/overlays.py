"""Named `OverlayProvider`s -- sidecar annotations attached to a diagram's nodes by their own id.

037-total-diagram-unification, US2 (T027-T029): the body of `c1_changes.py` (the git-diff +
authored-review merge, including ghost resolution) now lives here as the `"changes"` named
provider -- see contracts/overlay.md. `attach_overlays()` is the one dispatch point
`routes/diagrams.py`'s `resolve_diagram()` calls for every type's `GET /repos/{id}/{kind}`, reading
`overlays[]` off the type's own `DiagramTypeDefinition` instead of an `isC1`/`isImpact` branch. Each
provider both (a) merges its overlay's full authored payload onto `resolved[name]`, exactly what the
dedicated `/impact-changes` route already returned (kept, unchanged, importing from here now), and
(b) distributes a per-node view onto `resolved["nodes"][i]["overlays"][name]` for the canvas's
inline badge rendering (`useNodeOverlays`). Only `"changes"` ghosts: a removed block isn't in the
diagram's own `nodes[]`, so its records arrive in a parallel top-level `resolved["ghosts"]` array,
never an `is_ghost` flag on a shared list (data-model.md's post-analysis fix).

The `"changes"` overlay moved from `c1` to `impact` (post-038): instead of matching a changed file
onto a C1 block by longest-path-prefix, it resolves each changed symbol to its real graph node via
`change_cards.build_change_cards` (the same ladder `plan_resolver.resolve_target` already uses) and
walks that node's real ancestors (`GraphEngine.get_node(...).parent_ids`) until it finds one of
impact's own boxes -- impact boxes are already real graph nodes (`nodes[].node_id`), so no path
matching is needed at all, only a bounded ancestor walk for the case where impact collapsed several
seed symbols into one file/dir-level box.

The old `"plan"` overlay (formerly `c1_plan.py`) was retired along with the `codechroma-plan` skill;
see `docs/architecture/change-cards.md` and `docs/architecture/c1-diagram.md` for what replaced it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from codechroma.bridge.change_cards import build_change_cards
from codechroma.bridge.git_cmd import detect_git_root, working_tree_status
from codechroma.fingerprint import hash_lines
from codechroma.trace.mapper import FrameMapper

if TYPE_CHECKING:
    from codechroma.bridge.workspaces import Workspace
    from codechroma.engine import GraphEngine

__all__ = [
    "OverlayProvider",
    "OVERLAY_PROVIDERS",
    "register_overlay_provider",
    "attach_overlays",
    "fingerprint_for",
    "impact_changes_path",
    "resolve_impact_changes",
]

# Ordered worst-to-best so a mixed set of file statuses collapses to the honest label.
_ADDED = "added"
_MODIFIED = "modified"
_REMOVED = "removed"


class OverlayProvider(Protocol):
    def resolve(self, ws: Workspace, resolved: dict, by_id: dict[str, dict]) -> dict: ...


OVERLAY_PROVIDERS: dict[str, OverlayProvider] = {}


def register_overlay_provider(name: str, provider: OverlayProvider) -> None:
    OVERLAY_PROVIDERS[name] = provider


def attach_overlays(resolved: dict, ws: Workspace, names: list[str]) -> dict:
    # Providers mutate node dicts in place, never replace resolved["nodes"] -- one index suffices.
    by_id = _by_node_id(resolved)
    for name in names:
        provider = OVERLAY_PROVIDERS.get(name)
        if provider is not None:
            resolved = provider.resolve(ws, resolved, by_id)
    return resolved


def _by_node_id(resolved: dict) -> dict[str, dict]:
    nodes = resolved.get("nodes")
    if not isinstance(nodes, list):
        return {}
    return {
        node["id"]: node
        for node in nodes
        if isinstance(node, dict) and isinstance(node.get("id"), str)
    }


def _set_overlay(node: dict, name: str, payload: object) -> None:
    overlays = node.get("overlays")
    if not isinstance(overlays, dict):
        overlays = {}
        node["overlays"] = overlays
    overlays[name] = payload


# --- "changes": impact's git-diff + authored-review merge (formerly c1_changes.py, moved 038+) ---


@dataclass(slots=True)
class _Block:
    """One impact box, addressed by its own canvas id plus the real graph node it resolves to."""

    id: str
    name: str
    node_id: str
    files: list[dict] = field(default_factory=list)
    comments: list[dict] = field(default_factory=list)


def fingerprint_for(statuses: dict[str, str]) -> str:
    """Stable hash of the changed-file set, so a review can declare which diff it reviewed."""
    return hash_lines(f"{status} {path}" for path, status in statuses.items())


def impact_changes_path(repo_root: Path) -> Path:
    """Where the review skill writes -- the file the bridge and its FileWatcher read."""
    return repo_root / ".codechroma" / "impact-changes.json"


def resolve_impact_changes(
    repo_root: Path,
    impact: dict,
    authored: dict | None = None,
    base: str = "HEAD",
    review_comments: list[dict] | None = None,
    general_comments: list[dict] | None = None,
    engine: GraphEngine | None = None,
) -> dict:
    """The Impact diagram's boxes annotated with what the diff against `base` does to each one."""
    # The fingerprint is computed from this same base, so an agent's review isn't permanently stale.
    repo_root = repo_root.resolve()
    git_root = detect_git_root(repo_root)
    raw_statuses = working_tree_status(repo_root, git_root, base).statuses if git_root else {}
    statuses = _in_scope(raw_statuses)
    blocks = _index_impact_nodes(impact)
    by_node_id = {block.node_id: block for block in blocks}
    unassigned = _attribute_cards(
        engine, repo_root, base, by_node_id, git_root, raw_statuses, statuses
    )
    comments = _resolve_comment_symbols(engine, repo_root, review_comments or [])
    unassigned_comments = _attribute_comments(engine, comments, by_node_id)

    authored = authored if isinstance(authored, dict) else {}
    reviewed = authored.get("fingerprint")
    fingerprint = fingerprint_for(statuses)
    by_id = {block.id: block for block in blocks}

    return {
        "fingerprint": fingerprint,
        "reviewed_fingerprint": reviewed if isinstance(reviewed, str) else None,
        "has_review": bool(authored),
        "stale": bool(authored) and reviewed != fingerprint,
        "summary": str(authored.get("summary", "")),
        "blocks": _merge_blocks(blocks, authored.get("blocks"), engine),
        "ghosts": _resolve_ghosts(authored.get("ghosts"), by_id),
        "relationships": _resolve_relationships(authored.get("relationships"), set(by_id)),
        "unassigned": unassigned,
        "changed_file_count": len(statuses),
        "general_pr_comments": [*(general_comments or []), *unassigned_comments],
    }


def _in_scope(raw_statuses: dict[str, str]) -> dict[str, str]:
    """Repo-relative path -> added/modified/deleted, minus `.codechroma/` artifacts (own writes)."""
    # Else the fingerprint self-invalidates every run.
    return {
        path: status
        for path, status in raw_statuses.items()
        if ".codechroma" not in Path(path).parts
    }


def _index_impact_nodes(impact: dict) -> list[_Block]:
    """Every impact box that names a real `node_id` -- the diagram's addressable boxes."""
    nodes = impact.get("nodes") if isinstance(impact, dict) else None
    if not isinstance(nodes, list):
        return []
    blocks = []
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"]:
            continue
        node_id = node.get("node_id")
        if not isinstance(node_id, str) or not node_id:
            continue
        name = str(node.get("name", node["id"]))
        blocks.append(_Block(id=node["id"], name=name, node_id=node_id))
    return blocks


def _owning_block(
    node_id: str, by_node_id: dict[str, _Block], engine: GraphEngine
) -> _Block | None:
    """The impact box that IS `node_id`, or the nearest real ancestor box that collapsed it."""
    visited: set[str] = set()
    frontier = [node_id]
    while frontier:
        current = frontier.pop(0)
        if current in visited:
            continue
        visited.add(current)
        block = by_node_id.get(current)
        if block is not None:
            return block
        node = engine.get_node(current)
        if node is not None:
            frontier.extend(node.parent_ids)
    return None


def _attribute_cards(
    engine: GraphEngine | None,
    repo_root: Path,
    base: str,
    by_node_id: dict[str, _Block],
    git_root: Path | None,
    raw_statuses: dict[str, str],
    statuses: dict[str, str],
) -> list[dict]:
    """Every changed symbol/file onto the impact box that owns/collapses it (mutates its block)."""
    if engine is None:
        # No graph to resolve against: every changed file is honestly unassigned, not dropped.
        return [{"path": path, "status": status} for path, status in sorted(statuses.items())]
    result = build_change_cards(
        engine, repo_root, base=base, git_root=git_root, raw_statuses=raw_statuses
    )
    unassigned: list[dict] = []
    for card in result["cards"]:
        entry = {"path": card["file"], "status": card["status"]}
        block = _owning_block(card["node_id"], by_node_id, engine)
        if block is None:
            unassigned.append(entry)
        else:
            block.files.append(entry)
    for item in result["unassigned"]:
        unassigned.append({"path": item["path"], "status": item["status"]})
    return unassigned


def _resolve_comment_symbols(
    engine: GraphEngine | None, repo_root: Path, comments: list[dict]
) -> list[dict]:
    """Narrows a line-numbered comment to its exact function/class via the trace mapper's index."""
    if engine is None or not comments:
        return comments
    mapper = FrameMapper(engine, repo_root)
    resolved = []
    for comment in comments:
        path, line = comment.get("path"), comment.get("line")
        node_id = None
        if isinstance(path, str) and path and isinstance(line, int):
            node_id = mapper.resolve_by_line(path, line)
        symbol = engine.get_symbol(node_id) if node_id else None
        resolved.append(
            {**comment, "node_id": node_id, "symbol": symbol.qualified_name if symbol else None}
        )
    return resolved


def _attribute_comments(
    engine: GraphEngine | None, comments: list[dict], by_node_id: dict[str, _Block]
) -> list[dict]:
    """Resolved comments onto the box that owns/collapses their node; unresolved ones unassigned."""
    unassigned: list[dict] = []
    for comment in comments:
        node_id = comment.get("node_id")
        block = _owning_block(node_id, by_node_id, engine) if node_id and engine else None
        if block is None:
            unassigned.append(comment)
        else:
            block.comments.append(comment)
    return unassigned


def _source_path(engine: GraphEngine | None, node_id: str) -> str | None:
    """A block's file/dir path for display, read off the real graph node it resolves to."""
    node = engine.get_node(node_id) if engine is not None else None
    return node.source_path if node is not None else None


def _status_for(files: list[dict]) -> str:
    """A block is added/removed only when every changed file under it agrees; else modified."""
    kinds = {entry["status"] for entry in files}
    if kinds == {"added"}:
        return _ADDED
    if kinds == {"deleted"}:
        return _REMOVED
    return _MODIFIED


def _authored_by_id(authored_blocks: object) -> dict[str, dict]:
    if not isinstance(authored_blocks, list):
        return {}
    return {
        entry["block"]: entry
        for entry in authored_blocks
        if isinstance(entry, dict) and isinstance(entry.get("block"), str)
    }


def _merge_blocks(
    blocks: list[_Block], authored_blocks: object, engine: GraphEngine | None = None
) -> list[dict]:
    """One entry per block that either git or the review has something to say about."""
    authored = _authored_by_id(authored_blocks)
    merged: list[dict] = []
    for block in blocks:
        entry = authored.get(block.id)
        if not block.files and not block.comments and entry is None:
            continue
        status = _status_for(block.files)
        if entry is not None and entry.get("status") in (_ADDED, _MODIFIED, _REMOVED):
            status = entry["status"]
        merged.append(
            {
                "block": block.id,
                "node_id": block.id,
                "name": block.name,
                "path": _source_path(engine, block.node_id),
                "status": status,
                "files": block.files,
                "change_count": len(block.files),
                "before": _text(entry, "before"),
                "after": _text(entry, "after"),
                "explanation": _text(entry, "explanation"),
                "pr_comments": block.comments,
            }
        )
    return merged


def _text(entry: dict | None, key: str) -> str:
    value = entry.get(key) if entry else None
    return value if isinstance(value, str) else ""


def _resolve_ghosts(ghosts: object, by_id: dict[str, _Block]) -> list[dict]:
    """Boxes the change removed: absent from impact.json, so the canvas needs their parent's id."""
    if not isinstance(ghosts, list):
        return []
    resolved: list[dict] = []
    seen: set[str] = set()
    for ghost in ghosts:
        if not isinstance(ghost, dict):
            continue
        parent = ghost.get("parent")
        ghost_id = ghost.get("id")
        if not isinstance(parent, str) or not isinstance(ghost_id, str) or not ghost_id:
            continue
        if parent not in by_id:
            continue
        node_id = f"impact-ghost::{parent}/{ghost_id}"
        if node_id in seen:
            continue
        seen.add(node_id)
        resolved.append(
            {
                "id": ghost_id,
                "node_id": node_id,
                "parent": parent,
                "parent_node_id": parent,
                "name": str(ghost.get("name", ghost_id)),
                "status": _REMOVED,
                "before": _text(ghost, "before"),
                "after": _text(ghost, "after"),
                "explanation": _text(ghost, "explanation"),
            }
        )
    return resolved


def _resolve_relationships(relationships: object, node_ids: set[str]) -> list[dict]:
    """Relationship deltas whose endpoints both name a real block -- the rest can't be drawn."""
    if not isinstance(relationships, list):
        return []
    resolved: list[dict] = []
    for relationship in relationships:
        if not isinstance(relationship, dict):
            continue
        source, target = relationship.get("from"), relationship.get("to")
        status = relationship.get("status")
        if source not in node_ids or target not in node_ids or source == target:
            continue
        resolved.append(
            {
                "from": source,
                "to": target,
                "from_node_id": source,
                "to_node_id": target,
                "label": str(relationship.get("label", "")),
                "status": status if status in (_ADDED, _MODIFIED, _REMOVED) else _MODIFIED,
                "explanation": _text(relationship, "explanation"),
            }
        )
    return resolved


class _ChangesOverlayProvider:
    """Registered as `"changes"` -- git-diff badges + the authored review, ghosts included."""

    def resolve(self, ws: Workspace, resolved: dict, by_id: dict[str, dict]) -> dict:
        outcome = resolve_impact_changes(
            ws.root, resolved, ws.load_impact_changes(), base=ws.diff_base(), engine=ws.engine
        )
        resolved["changes"] = outcome
        resolved["ghosts"] = [
            {**ghost, "overlays": {"changes": ghost}} for ghost in outcome["ghosts"]
        ]
        for entry in outcome["blocks"]:
            node = by_id.get(entry["node_id"])
            if node is not None:
                _set_overlay(node, "changes", entry)
        return resolved


register_overlay_provider("changes", _ChangesOverlayProvider())
