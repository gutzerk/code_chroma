"""Finds FUNCTION source that differs from git HEAD, plus newly-added file/class container nodes."""

from __future__ import annotations

from pathlib import Path

from codechroma.analyzers.registry import AnalyzerRegistry, LanguageAnalyzer
from codechroma.bridge.git_cmd import detect_git_root, head_content, working_tree_status
from codechroma.engine import ROOT_SENTINEL, GraphEngine
from codechroma.graph.models import HierarchyLevel, HierarchyNode, Symbol, SymbolKind
from codechroma.io import read_text, slice_lines


def compute_function_diffs(
    engine: GraphEngine,
    repo_root: Path,
    registry: AnalyzerRegistry | None = None,
    base: str = "HEAD",
) -> list[dict]:
    """Every FUNCTION added/modified/deleted vs `base`, as {node_id, name, status, ...source}."""
    # `base` is "HEAD" for main, merge-base with main for a worktree (else layer empties on commit).
    registry = registry or AnalyzerRegistry.with_defaults()
    repo_root = repo_root.resolve()
    git_root = detect_git_root(repo_root)
    if git_root is None:
        return []

    status = working_tree_status(repo_root, git_root, base)
    if not status.changed and not status.deleted:
        return []

    functions_by_file, containers_by_file = _functions_and_containers_by_source_path(engine)
    results: list[dict] = []

    for file_path in status.changed:
        results.extend(
            _diffs_for_present_file(
                engine, registry, repo_root, git_root, file_path,
                functions_by_file.get(file_path, []),
                containers_by_file.get(file_path, []),
                base,
            )
        )

    for file_path in status.deleted:
        results.extend(_diffs_for_deleted_file(registry, repo_root, git_root, file_path, base))

    return results


def _diffs_for_present_file(
    engine: GraphEngine,
    registry: AnalyzerRegistry,
    repo_root: Path,
    git_root: Path,
    file_path: str,
    current_nodes: list[HierarchyNode],
    container_nodes: list[HierarchyNode],
    base: str = "HEAD",
) -> list[dict]:
    """Added/modified/removed FUNCTION diffs plus 'added' entries for new files/classes."""
    analyzer = registry.for_file(file_path)
    if analyzer is None:
        return []
    current_text = read_text(repo_root / file_path)
    if current_text is None:
        return []

    old_by_id, old_containers_by_id, old_text, existed = old_symbols(
        analyzer, git_root, repo_root, file_path, base
    )
    results: list[dict] = []
    current_ids: set[str] = set()

    for node in current_nodes:
        current_symbol = engine.get_symbol(node.id)
        if current_symbol is None:
            continue
        current_ids.add(node.id)
        proposed_source = slice_lines(
            current_text, current_symbol.start_line, current_symbol.end_line
        )
        old_symbol = old_by_id.get(node.id)
        original_source = (
            slice_lines(old_text, old_symbol.start_line, old_symbol.end_line)
            if old_symbol
            else ""
        )
        if original_source == proposed_source:
            continue
        status = "added" if old_symbol is None else "modified"
        results.append(_entry(node.id, node.name, status, original_source, proposed_source))

    for symbol_id, old_symbol in old_by_id.items():
        if symbol_id in current_ids:
            continue
        original_source = slice_lines(old_text, old_symbol.start_line, old_symbol.end_line)
        results.append(_entry(symbol_id, old_symbol.name, "deleted", original_source, ""))

    results.extend(
        _container_diffs(
            engine, current_text, old_text, container_nodes,
            old_containers_by_id, existed, has_func=bool(results),
        )
    )
    # A present, changed file gets its own file-level diff entry so the file's canvas block (the
    # impact diagram's merged `component::<path>` box, or a file node under Diff) shows a diff of
    # its whole text, not just per-function diffs keyed at function node_ids the file box never
    # owns. `compute_function_diffs` returns only function/class entries; without this the box a
    # user actually clicks carries no diff and renders plain code. Appended after the container
    # pass so this file entry never counts as a "function diff" that suppresses a class-level
    # `modified` entry (`has_func` gates that). The entry is `modified` (an existing thing that
    # changed); a brand-new file's `added` entry comes from `_container_diffs`.
    if existed and current_text != old_text:
        results.append(
            _entry(
                f"component::{file_path}",
                Path(file_path).name,
                "modified",
                old_text,
                current_text,
                "file",
            )
        )
    return results


def _container_diffs(
    engine: GraphEngine,
    current_text: str,
    old_text: str,
    container_nodes: list[HierarchyNode],
    old_containers_by_id: dict[str, Symbol],
    existed: bool,
    has_func: bool,
) -> list[dict]:
    """'added' for new file/class nodes, plus 'modified' for a changed class when no func diff."""
    results: list[dict] = []
    for node in container_nodes:
        if node.level == HierarchyLevel.COMPONENT:
            if existed:
                continue
            results.append(_entry(node.id, node.name, "added", "", current_text, _level_str(node)))
            continue
        symbol = engine.get_symbol(node.id)
        if symbol is None:
            continue
        proposed_source = slice_lines(current_text, symbol.start_line, symbol.end_line)
        old_symbol = old_containers_by_id.get(node.id)
        if not existed or old_symbol is None:
            results.append(
                _entry(node.id, node.name, "added", "", proposed_source, _level_str(node))
            )
            continue
        if has_func:
            continue
        original_source = slice_lines(old_text, old_symbol.start_line, old_symbol.end_line)
        if original_source == proposed_source:
            continue
        results.append(
            _entry(
                node.id, node.name, "modified", original_source, proposed_source, _level_str(node)
            )
        )
    return results


def _level_str(node: HierarchyNode) -> str:
    return "file" if node.level == HierarchyLevel.COMPONENT else "class"


def _diffs_for_deleted_file(
    registry: AnalyzerRegistry, repo_root: Path, git_root: Path, file_path: str, base: str = "HEAD"
) -> list[dict]:
    """Every FUNCTION `base` had in a file that no longer exists on disk, as a 'deleted' diff."""
    analyzer = registry.for_file(file_path)
    if analyzer is None:
        return []
    old_by_id, _old_containers_by_id, old_text, _existed = old_symbols(
        analyzer, git_root, repo_root, file_path, base
    )
    return [
        _entry(
            symbol_id,
            symbol.name,
            "deleted",
            slice_lines(old_text, symbol.start_line, symbol.end_line),
            "",
        )
        for symbol_id, symbol in old_by_id.items()
    ]


def old_symbols(
    analyzer: LanguageAnalyzer, git_root: Path, repo_root: Path, file_path: str, base: str = "HEAD"
) -> tuple[dict[str, Symbol], dict[str, Symbol], str, bool]:
    """`base`'s FUNCTION symbols by id, its CLASS/MODULE ones by id, its text, file-existed."""
    old_bytes = head_content(git_root, repo_root, file_path, base)
    try:
        old_parsed = analyzer.parse(file_path, old_bytes)
    except Exception:
        old_parsed = []
    old_by_id = {s.id: s for s in old_parsed if s.kind == SymbolKind.FUNCTION}
    old_containers_by_id = {
        s.id: s for s in old_parsed if s.kind in (SymbolKind.CLASS, SymbolKind.MODULE)
    }
    old_text = old_bytes.decode("utf8", errors="replace")
    return old_by_id, old_containers_by_id, old_text, bool(old_bytes)


def _entry(
    node_id: str, name: str, status: str, original: str, proposed: str, level: str = "function"
) -> dict:
    return {
        "node_id": node_id,
        "name": name,
        "status": status,
        "original_source": original,
        "proposed_source": proposed,
        "level": level,
    }


_CONTAINER_LEVELS = (HierarchyLevel.COMPONENT, HierarchyLevel.SERVICE)


def _functions_and_containers_by_source_path(
    engine: GraphEngine,
) -> tuple[dict[str, list[HierarchyNode]], dict[str, list[HierarchyNode]]]:
    """FUNCTION and COMPONENT/SERVICE nodes, each grouped by source_path, in one graph walk."""
    functions: dict[str, HierarchyNode] = {}
    containers: dict[str, HierarchyNode] = {}
    visited: set[str] = set()

    def _walk(node_id: str) -> None:
        for child in engine.get_children(node_id):
            # Multi-parenting means a node can be reached twice; CODE leaves are never of interest.
            if child.level == HierarchyLevel.CODE or child.id in visited:
                continue
            visited.add(child.id)
            if child.level == HierarchyLevel.FUNCTION:
                functions[child.id] = child
            elif child.level in _CONTAINER_LEVELS:
                containers[child.id] = child
            # Nothing below a FUNCTION is a function or a container, so stop descending there.
            if child.level != HierarchyLevel.FUNCTION:
                _walk(child.id)

    _walk(ROOT_SENTINEL)
    return _by_source_path(functions), _by_source_path(containers)


def _by_source_path(nodes: dict[str, HierarchyNode]) -> dict[str, list[HierarchyNode]]:
    by_file: dict[str, list[HierarchyNode]] = {}
    for node in nodes.values():
        if node.source_path:
            by_file.setdefault(node.source_path, []).append(node)
    return by_file
