"""The signal the codechroma-impact skill reads: a rich slice around a change's seeds.

The deterministic `resolve_impact` slice is exactly the "only what the LLM needs" input the canvas
didn't want to dumps the whole repo with. This module wraps that slice with the per-node evidence
the skill needs to author a curated diagram: what each seed is (a changed function/class/file, or a
plan step's target), what file/symbol level it is, and the anchor path each node lives under so the
skill can label the collapsed "everything else" background correctly.

`source` picks the sponsor: `"diff"` (seeds from change cards, reason = git's added/modified/deleted
word) or `"plan"` (seeds mined from a feature directory's `plan.md`/`tasks.md` code paths, reason =
the spec line that mentions each path). Both reduce to the same slice; only the reason text differs.
The plan source needs a `feature` (a feature-dir path like `specs/006-…`, resolved against the repo
root) — with no feature named it yields no seeds, matching the canvas's "add a feature path" state.
"""

from __future__ import annotations

import re
from pathlib import Path

from codechroma.analyzers.registry import AnalyzerRegistry
from codechroma.bridge.change_cards import build_change_cards
from codechroma.bridge.git_cmd import detect_git_root, working_tree_status
from codechroma.bridge.impact import resolve_impact
from codechroma.bridge.plan_resolver import resolve_target
from codechroma.dependencies.digest import build_dependency_index
from codechroma.engine import ROOT_SENTINEL
from codechroma.fingerprint import hash_lines

_ROLE_FOR_LEVEL = {
    "system": "dir",
    "pillar": "dir",
    "component": "file",
    "service": "class",
    "function": "function",
    "logic_block": "code",
    "code": "code",
}

# Backticked tokens that name a source file: contains a path separator and a known source extension.
_SPEC_FILE_RE = re.compile(r"`([^`]+)`")
# Source suffixes the engine parses, derived from the analyzers so this never drifts from what
# `resolve_target` can anchor (same source of truth as routes/graph.py's `_language_by_suffix`).
_SOURCE_SUFFIXES = tuple(
    ext[1:] for ext in AnalyzerRegistry.with_defaults().supported_extensions()
)

# The feature-spec files whose code references seed the plan slice (`spec.md` is requirements
# prose — mostly ID references, not paths — so it is deliberately not scanned here).
_SPEC_SEED_FILES = ("plan.md", "tasks.md")


def normalize_source(source: str, default: str = "diff") -> str:
    """One sponsor's valid values ('diff'/'plan'), falling back to the default on anything else."""
    return source if source in ("diff", "plan") else default


def authored_source(authored: dict, default: str = "diff") -> str:
    """The sponsor an authored file was generated under — read off its `source` field."""
    return normalize_source(authored.get("source", default), default)


def authored_feature(authored: dict) -> str | None:
    """The feature dir a plan-authored file was generated under, if any."""
    value = authored.get("feature")
    return value if isinstance(value, str) and value else None


def _feature_dir(ws, feature: str | None) -> Path | None:
    """Resolve a feature-dir path against the repo root; None if it isn't a directory."""
    if not feature:
        return None
    path = Path(feature)
    path = path if path.is_absolute() else ws.root / path
    try:
        resolved = path.resolve()
    except OSError:
        return None
    return resolved if resolved.is_dir() else None


def _feature_spec_seeds(ws, feature: str | None) -> dict[str, str]:
    """seed node_id -> the spec line naming it, mined from a feature dir's plan.md/tasks.md."""
    feature_dir = _feature_dir(ws, feature)
    if feature_dir is None:
        return {}
    seeds: dict[str, str] = {}
    for filename in _SPEC_SEED_FILES:
        path = feature_dir / filename
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for token, line in _code_paths(text):
            node_id, _resolution = resolve_target(ws.engine, token, None)
            seeds.setdefault(node_id, line)
    return seeds


def _code_paths(text: str) -> list[tuple[str, str]]:
    """Backticked tokens that look like a source file, each with the stripped line naming it."""
    found: list[tuple[str, str]] = []
    for line in text.splitlines():
        for token in _SPEC_FILE_RE.findall(line):
            stripped = token.strip()
            if "/" not in stripped:
                continue
            if not stripped.endswith(_SOURCE_SUFFIXES):
                continue
            if stripped.startswith(("http://", "https://", "docs/", "specs/")):
                continue
            found.append((stripped, line.strip()))
    return found


def _source_seeds(ws, source: str, feature: str | None = None) -> dict[str, str]:
    """seed node_id -> one-line reason it's a seed, for the chosen source."""
    if source == "plan":
        return _feature_spec_seeds(ws, feature)
    change_cards = build_change_cards(ws.engine, ws.root, base=ws.diff_base())
    return {
        card["node_id"]: str(card.get("status") or "changed")
        for card in change_cards["cards"]
    }


def _anchor_path(engine, node_id: str) -> list[str]:
    """The System→Pillar→… ancestor path, deepest-first, for a collapsed box's parent label."""
    anchors: list[str] = []
    parent_id = node_id
    for _ in range(4):
        node = engine.get_node(parent_id)
        if node is None or not node.parent_ids:
            break
        parent_id = node.parent_ids[0]
        parent = engine.get_node(parent_id)
        if parent is not None and parent.id != ROOT_SENTINEL:
            anchors.append(parent.name)
    return anchors


def build_impact_context(ws, source: str = "diff", feature: str | None = None) -> dict:
    """The rich slice payload GET /repos/{id}/impact-context returns to the impact skill."""
    ws.sync()
    graph = ws.engine.snapshot()
    index = build_dependency_index(graph)
    seeds_by_id = _source_seeds(ws, source, feature)
    slice_payload = resolve_impact(graph, index, sorted(seeds_by_id), hop=1)

    nodes = []
    for node in slice_payload["nodes"]:
        node_id = node["node_id"]
        graph_node = graph.nodes.get(node_id)
        level = (
            _ROLE_FOR_LEVEL.get(graph_node.level.value, "")
            if graph_node is not None
            else ""
        )
        nodes.append(
            {
                "id": node_id,
                "name": node["name"],
                "node_id": node_id,
                "seed": node["seed"],
                "path": graph_node.source_path if graph_node else None,
                "level": level,
                "kinds": list(graph_node.symbol_ids) if graph_node else [],
                "reason": seeds_by_id.get(node_id) if node["seed"] else None,
                "anchors": _anchor_path(ws.engine, node_id),
            }
        )

    return {
        "source": source,
        "feature": feature if source == "plan" else None,
        "nodes": nodes,
        "relations": slice_payload["relations"],
        "seed_count": slice_payload["seed_count"],
        "node_count": slice_payload["node_count"],
        "truncated": slice_payload["truncated"],
        # Same cheap fingerprint the resolver/review compare against, so a stale check never forks.
        "fingerprint": impact_fingerprint(ws, source, feature, seeds_by_id=seeds_by_id),
    }


def impact_fingerprint(
    ws, source: str = "diff", feature: str | None = None, seeds_by_id: dict[str, str] | None = None
) -> str:
    """The slice's 'what changed' identity for staleness, computed without rebuilding the slice.

    Rebuilding the whole slice just to hash the seed set made staleness a full graph walk on every
    open — the lag the impact view had. Both the resolver and the review compare against this, and
    build_impact_context stamps it, so the fingerprint the skill copies and the one staleness
    compares against are always the same value for the same source. `seeds_by_id` reuses a caller's
    already-mined plan seed set instead of re-mining the spec files.

    The diff source hashes git's statuses (which files moved, like change-cards / c1_changes) —
    cheap, and catches file add/delete/change. The plan source hashes its mined spec seeds — it
    parses only the feature's plan.md/tasks.md and resolves each path, never a slice walk.
    """
    if source == "plan":
        seeds = seeds_by_id if seeds_by_id is not None else _feature_spec_seeds(ws, feature)
        return hash_lines(
            f"{node_id} {reason}" for node_id, reason in sorted(seeds.items())
        )
    return _diff_fingerprint(ws, ws.diff_base())


def impact_seed_count(
    ws, source: str = "diff", feature: str | None = None, seeds_by_id: dict[str, str] | None = None
) -> int:
    """The slice's seed count, for the resolver's cheap payload — never a full slice rebuild.

    Plan seeds are mined from the feature's spec files, so their count is exact and cheap.
    `seeds_by_id` reuses an already-mined set. The diff seed count would need the whole change-card
    walk, and the canvas doesn't render it, so the resolver reports 0 for diff on a reviewed read —
    the fingerprint is the load-bearing signal.
    """
    if source == "plan":
        seeds = seeds_by_id if seeds_by_id is not None else _feature_spec_seeds(ws, feature)
        return len(seeds)
    return 0


def _diff_fingerprint(ws, base: str) -> str:
    """Cheap 'what changed' hash over git's statuses, mirroring change-cards' file identity.

    Rebuilding the whole slice just to hash the seed set is what made staleness slow (a full graph
    walk per open). Git status is the same 'which files moved' signal the diff seeds derive from, at
    a fraction of the cost — like c1_changes' fingerprint does. `seed_count`/`node_count` in the
    rich context answer for the slice's real shape; this only gates staleness.
    """
    repo_root = ws.root.resolve()
    git_root = detect_git_root(repo_root)
    if git_root is None:
        return ""
    statuses = working_tree_status(repo_root, git_root, base).statuses
    # Skip our own `.codechroma/` artifacts: skill writes (impact.json, etc.) are untracked, so
    # they'd otherwise change every status run and stale-check would never settle.
    # Same guard git_sync._changed_paths uses to keep the live watcher from self-looping.
    return hash_lines(
        f"{status} {path}"
        for path, status in sorted(statuses.items())
        if ".codechroma" not in Path(path).parts
    )
