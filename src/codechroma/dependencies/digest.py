"""Builds the shared file/class/function dependency digest both diagram context builders read from.

Everything here is a re-shaping of data GraphEngine already resolved once
(HierarchyNode.depends_on_ids, built in GraphBuilder._resolve_symbol_edges) -- no new call-graph
extraction. context/digest.py (the C1 diagram) and bridge/patterns_context.py (the Patterns diagram)
both use DependencyIndex to look up calls/callers instead of re-deriving them, and this module
additionally persists a capped file -> class -> function view to .codechroma/dependency-digest.json
for either skill to fetch on demand.
"""

from __future__ import annotations

import logging
from collections import deque
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from codechroma.config import settings
from codechroma.graph.models import Graph, Symbol, SymbolKind
from codechroma.io import load_json, write_json

logger = logging.getLogger("codechroma.dependencies")

DIGEST_FILENAME = "dependency-digest.json"

# Bounds find_route()'s worst-case latency on a large/disconnected graph -- see docs/planning/019.
ROUTE_HOP_CAP = 12


def max_callees_per_symbol() -> int:
    return settings.dependency_digest.max_callees_per_symbol


def max_callers_per_symbol() -> int:
    return settings.dependency_digest.max_callers_per_symbol


def max_imports_per_file() -> int:
    return settings.dependency_digest.max_imports_per_file


def trivial_max_body_lines() -> int:
    return settings.dependency_digest.trivial_max_body_lines


def max_detailed_files() -> int:
    return settings.dependency_digest.max_detailed_files


def max_total_symbol_entries() -> int:
    return settings.dependency_digest.max_total_symbol_entries


@dataclass(slots=True)
class DependencyIndex:
    """Reverses every node's depends_on_ids once, so "who calls this" is an O(1) lookup."""

    graph: Graph
    dependents_by_node: dict[str, list[str]] = field(default_factory=dict)


def build_dependency_index(graph: Graph) -> DependencyIndex:
    dependents: dict[str, list[str]] = {}
    for node in graph.nodes.values():
        for dep_id in node.depends_on_ids:
            if dep_id in graph.nodes:
                dependents.setdefault(dep_id, []).append(node.id)
    for deps in dependents.values():
        deps.sort()
    return DependencyIndex(graph=graph, dependents_by_node=dependents)


def dependencies_of(index: DependencyIndex, node_id: str) -> list[str]:
    node = index.graph.nodes.get(node_id)
    if node is None:
        return []
    return sorted(dep_id for dep_id in node.depends_on_ids if dep_id in index.graph.nodes)


def dependents_of(index: DependencyIndex, node_id: str) -> list[str]:
    return list(index.dependents_by_node.get(node_id, []))


def _bfs_path(
    index: DependencyIndex,
    from_id: str,
    to_id: str,
    neighbors_of: Callable[[DependencyIndex, str], list[str]],
) -> list[str] | None:
    """Plain BFS over one edge direction, stopping at `ROUTE_HOP_CAP` edges out from `from_id`."""
    visited = {from_id}
    queue: deque[tuple[str, list[str]]] = deque([(from_id, [from_id])])
    while queue:
        node_id, path = queue.popleft()
        if len(path) - 1 >= ROUTE_HOP_CAP:
            continue
        for neighbor in neighbors_of(index, node_id):
            if neighbor in visited:
                continue
            next_path = [*path, neighbor]
            if neighbor == to_id:
                return next_path
            visited.add(neighbor)
            queue.append((neighbor, next_path))
    return None


def find_route(index: DependencyIndex, from_id: str, to_id: str) -> list[str] | None:
    """Dependency path between two nodes: callee direction first, then falling back to caller."""
    if from_id not in index.graph.nodes or to_id not in index.graph.nodes:
        return None
    if from_id == to_id:
        return [from_id]
    return _bfs_path(index, from_id, to_id, dependencies_of) or _bfs_path(
        index, from_id, to_id, dependents_of
    )


def iter_symbol_edges(index: DependencyIndex) -> Iterator[tuple[str, str]]:
    """Every resolved (from_node_id, to_node_id) edge in the graph, exactly once."""
    for node in index.graph.nodes.values():
        for dep_id in node.depends_on_ids:
            if dep_id in index.graph.nodes:
                yield node.id, dep_id


def dependency_digest_path(repo_root: Path) -> Path:
    return repo_root / ".codechroma" / DIGEST_FILENAME


def load_dependency_digest(repo_root: Path) -> dict:
    """Tolerates a missing or malformed file, returning {}."""
    return load_json(dependency_digest_path(repo_root))


def write_dependency_digest(repo_root: Path, digest: dict) -> None:
    write_json(dependency_digest_path(repo_root), digest)


def _node_id_for(symbol: Symbol, graph: Graph) -> str | None:
    """A symbol's own id is its HierarchyNode id when one was built for it; else None."""
    return symbol.id if symbol.id in graph.nodes else None


def _is_trivial(symbol: Symbol, calls: list[str]) -> bool:
    """A getter/setter-style function: no resolved outgoing calls and a body of a line or two."""
    span = symbol.end_line - symbol.start_line + 1
    return not calls and span <= trivial_max_body_lines()


def _symbol_entry(index: DependencyIndex, graph: Graph, symbol: Symbol) -> dict:
    node_id = _node_id_for(symbol, graph)
    calls = dependencies_of(index, node_id) if node_id else []
    called_by = dependents_of(index, node_id) if node_id else []
    n_callees = max_callees_per_symbol()
    n_callers = max_callers_per_symbol()
    return {
        "id": symbol.id,
        "node_id": node_id,
        "name": symbol.name,
        "is_trivial": _is_trivial(symbol, calls),
        "calls": calls[:n_callees],
        "calls_overflow": max(0, len(calls) - n_callees),
        "called_by": called_by[:n_callers],
        "called_by_overflow": max(0, len(called_by) - n_callers),
    }


@dataclass(slots=True)
class _FileSymbols:
    path: str
    module: Symbol | None
    classes: list[Symbol]
    methods_by_class_id: dict[str, list[Symbol]]
    functions: list[Symbol]
    variables: list[Symbol] = field(default_factory=list)


def group_by_file(graph: Graph) -> dict[str, _FileSymbols]:
    symbols_by_file: dict[str, list[Symbol]] = {}
    for symbol in graph.symbols.values():
        symbols_by_file.setdefault(symbol.file_path, []).append(symbol)

    files: dict[str, _FileSymbols] = {}
    for file_path, symbols in symbols_by_file.items():
        module = next((s for s in symbols if s.kind == SymbolKind.MODULE), None)
        classes = [s for s in symbols if s.kind == SymbolKind.CLASS]
        class_ids = {c.id for c in classes}
        methods_by_class_id: dict[str, list[Symbol]] = {c.id: [] for c in classes}
        functions: list[Symbol] = []
        variables = [s for s in symbols if s.kind == SymbolKind.VARIABLE]
        for symbol in symbols:
            if symbol.kind != SymbolKind.FUNCTION:
                continue
            if symbol.parent_symbol_id in class_ids:
                methods_by_class_id[symbol.parent_symbol_id].append(symbol)
            elif module is not None and symbol.parent_symbol_id == module.id:
                functions.append(symbol)
        files[file_path] = _FileSymbols(
            path=file_path,
            module=module,
            classes=classes,
            methods_by_class_id=methods_by_class_id,
            functions=functions,
            variables=variables,
        )
    return files


def _file_signal(index: DependencyIndex, file_symbols: _FileSymbols) -> int:
    """Edge count touching this file's symbols, in either direction -- ranks which files matter."""
    signal = 0
    all_ids = {c.id for c in file_symbols.classes}
    all_ids.update(s.id for methods in file_symbols.methods_by_class_id.values() for s in methods)
    all_ids.update(s.id for s in file_symbols.functions)
    for symbol_id in all_ids:
        signal += len(dependencies_of(index, symbol_id)) + len(dependents_of(index, symbol_id))
    return signal


def _file_entry_count(file_symbols: _FileSymbols, index: DependencyIndex, graph: Graph) -> int:
    """How many detail entries this file would contribute -- classes plus non-trivial callables."""
    count = len(file_symbols.classes)
    for methods in file_symbols.methods_by_class_id.values():
        for method in methods:
            calls = dependencies_of(index, _node_id_for(method, graph) or "")
            if not _is_trivial(method, calls):
                count += 1
    for func in file_symbols.functions:
        calls = dependencies_of(index, _node_id_for(func, graph) or "")
        if not _is_trivial(func, calls):
            count += 1
    return count


def _class_detail(
    index: DependencyIndex, graph: Graph, file_symbols: _FileSymbols, cls: Symbol
) -> dict:
    methods = sorted(file_symbols.methods_by_class_id.get(cls.id, []), key=lambda s: s.name)
    method_entries = []
    omitted = 0
    for method in methods:
        entry = _symbol_entry(index, graph, method)
        if entry["is_trivial"]:
            omitted += 1
            continue
        method_entries.append(entry)
    entry = _symbol_entry(index, graph, cls)
    entry["methods"] = method_entries
    entry["methods_omitted"] = omitted
    return entry


def _file_detail(index: DependencyIndex, graph: Graph, file_symbols: _FileSymbols) -> dict:
    module = file_symbols.module
    imports = sorted(set(module.imports.values())) if module is not None else []
    classes = sorted(file_symbols.classes, key=lambda s: s.name)
    functions = sorted(file_symbols.functions, key=lambda s: s.name)

    function_entries = []
    functions_omitted = 0
    for func in functions:
        entry = _symbol_entry(index, graph, func)
        if entry["is_trivial"]:
            functions_omitted += 1
            continue
        function_entries.append(entry)

    node_id = f"component::{file_symbols.path}"
    return {
        "path": file_symbols.path,
        "node_id": node_id if node_id in graph.nodes else None,
        "imports": imports[:max_imports_per_file()],
        "imports_overflow": max(0, len(imports) - max_imports_per_file()),
        "classes": [_class_detail(index, graph, file_symbols, cls) for cls in classes],
        "classes_omitted": 0,
        "functions": function_entries,
        "functions_omitted": functions_omitted,
    }


def _bare_file_entry(file_symbols: _FileSymbols, graph: Graph) -> dict:
    node_id = f"component::{file_symbols.path}"
    return {
        "path": file_symbols.path,
        "node_id": node_id if node_id in graph.nodes else None,
        "detail_omitted": True,
    }


def build_dependency_digest(
    graph: Graph, repo_root: Path, index: DependencyIndex | None = None
) -> dict:
    """The full, capped file -> class -> function digest persisted to dependency_digest_path()."""
    index = index or build_dependency_index(graph)
    files_by_path = group_by_file(graph)

    ranked = sorted(
        files_by_path.values(),
        key=lambda fs: (-_file_signal(index, fs), fs.path),
    )

    detailed_paths: set[str] = set()
    remaining_files = max_detailed_files()
    remaining_entries = max_total_symbol_entries()
    truncated = False
    for file_symbols in ranked:
        entry_count = _file_entry_count(file_symbols, index, graph)
        if remaining_files <= 0 or entry_count > remaining_entries:
            truncated = True
            continue
        detailed_paths.add(file_symbols.path)
        remaining_files -= 1
        remaining_entries -= entry_count

    files_output = []
    for path in sorted(files_by_path):
        file_symbols = files_by_path[path]
        if path in detailed_paths:
            files_output.append(_file_detail(index, graph, file_symbols))
        else:
            files_output.append(_bare_file_entry(file_symbols, graph))

    class_count = sum(len(fs.classes) for fs in files_by_path.values())
    function_count = sum(
        len(fs.functions) + sum(len(m) for m in fs.methods_by_class_id.values())
        for fs in files_by_path.values()
    )
    edge_count = sum(1 for _ in iter_symbol_edges(index))
    files_omitted = len(files_by_path) - len(detailed_paths)

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "totals": {
            "file_count": len(files_by_path),
            "class_count": class_count,
            "function_count": function_count,
            "edge_count": edge_count,
        },
        "caps": {
            "max_callees_per_symbol": max_callees_per_symbol(),
            "max_callers_per_symbol": max_callers_per_symbol(),
            "max_imports_per_file": max_imports_per_file(),
            "trivial_max_body_lines": trivial_max_body_lines(),
            "max_detailed_files": max_detailed_files(),
            "max_total_symbol_entries": max_total_symbol_entries(),
        },
        "truncated": truncated,
        "files_omitted": files_omitted,
        "files": files_output,
    }
