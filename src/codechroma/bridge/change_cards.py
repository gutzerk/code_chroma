"""One card per changed symbol, pinned to the nearest existing block, so a diff reads as a map.

The Diff layer shows *what* the new code says; a change card says *where* the change is and what
kind it is, on the block the user is already looking at. Several cards can land on one block, which
is the point: two deleted siblings both resolve to their file's component node, and a collapsed
folder shows the count below it. `by_node_status` folds those same cards into one added/modified/
removed status per node — the plain hierarchy view's block-recolor signal, in the vocabulary
c1_changes.py's `block-change--*` badges already use.

Deliberately deterministic — no Claude call anywhere. `compute_function_diffs` is the source of
truth for code, `working_tree_status` covers everything it can't parse, and
`plan_resolver.resolve_target` is the one ladder that decides which block a `(file, symbol)` belongs
to. Copying that ladder here would let the plan layer and this one disagree about the same file.
"""

from __future__ import annotations

import difflib
from pathlib import Path

from codechroma.analyzers.registry import AnalyzerRegistry
from codechroma.bridge.git_cmd import detect_git_root, head_content, run_git, working_tree_status
from codechroma.bridge.git_diff import compute_function_diffs
from codechroma.bridge.plan_resolver import resolve_target
from codechroma.engine import IGNORED_DIRS, GraphEngine
from codechroma.io import read_text

# git's word for a change -> the plan layer's word, which is what colours the card.
_KIND_FOR_STATUS = {"added": "add", "modified": "modify", "deleted": "delete"}

_VERB_FOR_STATUS = {"added": "Added", "modified": "Modified", "deleted": "Deleted"}

REASON_BINARY = "binary"
REASON_NO_NODE = "no-node"
REASON_UNPARSED = "unparsed-node-id"


def build_change_cards(
    engine: GraphEngine,
    repo_root: Path,
    base: str = "HEAD",
    registry: AnalyzerRegistry | None = None,
    git_root: Path | None = None,
    raw_statuses: dict[str, str] | None = None,
) -> dict:
    """Every change vs `base` on the nearest node; `git_root`/`raw_statuses` skip a redo of both."""
    repo_root = repo_root.resolve()
    if git_root is None:
        git_root = detect_git_root(repo_root)
    if git_root is None:
        return _payload(base, False, [], [])

    resolved = _resolve_base(repo_root, base)
    if resolved is None:
        # 🔴 An unreachable base makes working_tree_status report nothing, reading as "no change".
        return _payload(base, False, [], [])

    if raw_statuses is None:
        raw_statuses = working_tree_status(repo_root, git_root, base).statuses
    statuses = _in_scope(raw_statuses)
    cards, unassigned = _symbol_cards(engine, repo_root, base, registry)
    covered = {card["file"] for card in cards}
    file_cards, file_unassigned = _file_cards(
        engine, repo_root, git_root, base, statuses, covered
    )
    return _payload(resolved, True, cards + file_cards, unassigned + file_unassigned)


def _payload(base: str, base_resolved: bool, cards: list[dict], unassigned: list[dict]) -> dict:
    return {
        "base": base,
        "base_resolved": base_resolved,
        "card_count": len(cards),
        "cards": cards,
        "by_node": _by_node(cards),
        "by_node_status": _by_node_status(cards),
        "unassigned": unassigned,
    }


def _in_scope(statuses: dict[str, str]) -> dict[str, str]:
    """Drops paths the analysis walk never visited, so no card can point outside the graph."""
    # Not `unassigned`: graph.db and node_modules are out of scope by design, not changes we lost.
    return {
        path: status
        for path, status in statuses.items()
        if not any(part in IGNORED_DIRS for part in Path(path).parts)
    }


def _resolve_base(repo_root: Path, base: str) -> str | None:
    """The commit `base` names, or None when git can't resolve it in this checkout."""
    resolved = run_git(repo_root, "rev-parse", "--verify", "--quiet", base)
    return resolved.strip() if resolved and resolved.strip() else None


def _by_node(cards: list[dict]) -> dict[str, int]:
    """How many cards each block carries — the badge count, including several on one block."""
    counts: dict[str, int] = {}
    for card in cards:
        counts[card["node_id"]] = counts.get(card["node_id"], 0) + 1
    return counts


def _by_node_status(cards: list[dict]) -> dict[str, str]:
    """The plain hierarchy view's block-recolor signal: added/modified/removed per changed node."""
    kinds_by_node: dict[str, set[str]] = {}
    for card in cards:
        kinds_by_node.setdefault(card["node_id"], set()).add(card["status"])
    statuses: dict[str, str] = {}
    for node_id, kinds in kinds_by_node.items():
        if kinds == {"added"}:
            statuses[node_id] = "added"
        elif kinds == {"deleted"}:
            statuses[node_id] = "removed"
        else:
            statuses[node_id] = "modified"
    return statuses


def _symbol_cards(
    engine: GraphEngine, repo_root: Path, base: str, registry: AnalyzerRegistry | None
) -> tuple[list[dict], list[dict]]:
    """A card per function/class/file diff the analyzers saw, plus the ones that pinned nowhere."""
    cards: list[dict] = []
    unassigned: list[dict] = []
    for entry in compute_function_diffs(engine, repo_root, registry, base):
        file_path, symbol = _split_node_id(entry["node_id"])
        if file_path is None:
            unassigned.append(_unassigned(entry["node_id"], entry["status"], REASON_UNPARSED))
            continue
        added, removed = _line_delta(entry["original_source"], entry["proposed_source"])
        card = _card(
            engine,
            card_id=entry["node_id"],
            file_path=file_path,
            symbol=symbol,
            name=entry["name"],
            target=entry["level"],
            status=entry["status"],
            added=added,
            removed=removed,
        )
        if card is None:
            unassigned.append(_unassigned(file_path, entry["status"], REASON_NO_NODE))
            continue
        cards.append(card)
    return cards, unassigned


def _file_cards(
    engine: GraphEngine,
    repo_root: Path,
    git_root: Path,
    base: str,
    statuses: dict[str, str],
    covered: set[str],
) -> tuple[list[dict], list[dict]]:
    """A card per changed path no symbol diff covered — a Markdown-only PR is not an empty one."""
    cards: list[dict] = []
    unassigned: list[dict] = []
    for file_path in sorted(path for path in statuses if path not in covered):
        status = statuses[file_path]
        added, removed, binary = _file_line_delta(repo_root, git_root, file_path, base, status)
        card = _card(
            engine,
            card_id=file_path,
            file_path=file_path,
            symbol=None,
            name=Path(file_path).name,
            target="file",
            status=status,
            added=added,
            removed=removed,
            binary=binary,
        )
        if card is None:
            unassigned.append(_unassigned(file_path, status, REASON_NO_NODE))
            continue
        cards.append(card)
    return cards, unassigned


def _card(
    engine: GraphEngine,
    *,
    card_id: str,
    file_path: str,
    symbol: str | None,
    name: str,
    target: str,
    status: str,
    added: int,
    removed: int,
    binary: bool = False,
) -> dict | None:
    """One card, or None when the ladder resolved to something the graph doesn't actually have."""
    node_id, resolution = resolve_target(engine, file_path, symbol)
    if engine.get_node(node_id) is None:
        # The ladder's root fallback can name a node an empty graph never had: report, don't pin.
        return None
    return {
        "id": card_id,
        "text": f"{_VERB_FOR_STATUS.get(status, 'Changed')} {name}",
        "details": "",
        "node_id": node_id,
        "kind": _KIND_FOR_STATUS.get(status, "modify"),
        "resolution": resolution,
        "file": file_path,
        "symbol": symbol,
        "name": name,
        "target": target,
        "status": status,
        "added_lines": added,
        "removed_lines": removed,
        "binary": binary,
    }


def _unassigned(path: str, status: str, reason: str) -> dict:
    """A change that produced no card, named rather than dropped."""
    return {"path": path, "status": status, "reason": reason}


def _split_node_id(node_id: str) -> tuple[str | None, str | None]:
    """The (file, symbol) a diff entry's node id spells, or (None, None) for an unfamiliar shape."""
    for marker in ("::function::", "::class::"):
        file_path, separator, symbol = node_id.partition(marker)
        if separator:
            return file_path, symbol
    if node_id.startswith("component::"):
        return node_id.removeprefix("component::"), None
    return None, None


def _line_delta(original: str, proposed: str) -> tuple[int, int]:
    """How many lines this change adds and removes, for the count on the card."""
    added = removed = 0
    diff = difflib.unified_diff(original.splitlines(), proposed.splitlines(), lineterm="", n=0)
    for line in diff:
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            added += 1
        elif line.startswith("-"):
            removed += 1
    return added, removed


def _file_line_delta(
    repo_root: Path, git_root: Path, file_path: str, base: str, status: str
) -> tuple[int, int, bool]:
    """Line counts for a whole-file change, plus whether it is binary and so has none to report."""
    old_bytes = head_content(git_root, repo_root, file_path, base)
    try:
        original = old_bytes.decode() if old_bytes else ""
    except UnicodeDecodeError:
        return 0, 0, True
    proposed = "" if status == "deleted" else read_text(repo_root / file_path)
    if proposed is None:
        return 0, 0, True
    added, removed = _line_delta(original, proposed)
    return added, removed, False
