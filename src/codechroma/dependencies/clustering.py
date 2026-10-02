"""C2-join: deterministic file -> component -> container clustering from real call/import edges.

Each level asks a fixed, ordered chain of signals -- folder default, call-graph majority, merge by
aggregate traffic, import fallback (files only) -- and only escalates once none of them
answer (plan.md's Chain of Responsibility; research.md #6 fixes the mechanism/order, not the
numeric thresholds, which are deliberately left for later tuning against a real large repo).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

import pathspec

from codechroma.analyzers.registry import AnalyzerRegistry
from codechroma.dependencies.digest import build_dependency_index, iter_symbol_edges
from codechroma.graph.models import Graph, SymbolKind

ROOT_FOLDER = "<root>"

# Same gitignore-pattern idiom as engine.py's _BUILTIN_NOISE_PATTERNS ("/" prefix anchors to root).
_INFRA_PATTERNS = (".github/", ".specify/", "testdata/", "/*.yaml", "/*.yml")
_INFRA_SPEC = pathspec.PathSpec.from_lines("gitignore", _INFRA_PATTERNS)


def _is_infra_path(path: str) -> bool:
    """CI/tooling clutter (workflows, root configs, test fixtures) -- never a real component."""
    return _INFRA_SPEC.match_file(path)


@dataclass(slots=True)
class ClusterEdge:
    from_id: str
    to_id: str
    count: int


@dataclass(slots=True)
class ComponentCluster:
    id: str
    container_id: str
    files: list[str]


@dataclass(slots=True)
class ContainerCluster:
    id: str
    component_ids: list[str]


@dataclass(slots=True)
class ClusterResult:
    components: list[ComponentCluster] = field(default_factory=list)
    containers: list[ContainerCluster] = field(default_factory=list)
    component_edges: list[ClusterEdge] = field(default_factory=list)
    container_edges: list[ClusterEdge] = field(default_factory=list)
    undetermined_files: list[str] = field(default_factory=list)
    # File-pair call-graph weights, so callers don't have to recompute file_edge_weights(graph).
    file_edge_weights: dict[tuple[str, str], int] = field(default_factory=dict)


def _pair_key(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def plurality_winner(votes: Counter[str]) -> str | None:
    """The strict top vote-getter; None on an empty or tied vote -- the chain falls through."""
    if not votes:
        return None
    ranked = votes.most_common(2)
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return None
    return ranked[0][0]


def _build_neighbor_weights(edge_weights: dict[tuple[str, str], int]) -> dict[str, Counter[str]]:
    neighbors: dict[str, Counter[str]] = {}
    for (a, b), weight in edge_weights.items():
        neighbors.setdefault(a, Counter())[b] += weight
        neighbors.setdefault(b, Counter())[a] += weight
    return neighbors


def _neighbor_votes(
    item: str, group_of: dict[str, str], neighbors: dict[str, Counter[str]]
) -> Counter[str]:
    votes: Counter[str] = Counter()
    for other, weight in neighbors.get(item, {}).items():
        group = group_of.get(other)
        if group is not None:
            votes[group] += weight
    return votes


def _connected_component(
    start: str, neighbors: dict[str, Counter[str]], allowed: set[str]
) -> set[str]:
    seen = {start}
    stack = [start]
    while stack:
        current = stack.pop()
        for neighbor, weight in neighbors.get(current, {}).items():
            if weight > 0 and neighbor in allowed and neighbor not in seen:
                seen.add(neighbor)
                stack.append(neighbor)
    return seen


def _resolve_chain(
    items: list[str],
    default_group_of: Callable[[str], str | None],
    edge_weights: dict[tuple[str, str], int],
) -> tuple[dict[str, str], list[str]]:
    """folder/parent default -> call-graph majority -> aggregate merge; (group_of, unresolved)."""
    group_of: dict[str, str] = {}
    for item in items:
        default = default_group_of(item)
        if default is not None:
            group_of[item] = default

    neighbors = _build_neighbor_weights(edge_weights)

    for item in [i for i in items if i not in group_of]:
        winner = plurality_winner(_neighbor_votes(item, group_of, neighbors))
        if winner is not None:
            group_of[item] = winner

    remaining = [i for i in items if i not in group_of]
    remaining_set = set(remaining)
    visited: set[str] = set()
    for item in remaining:
        if item in visited:
            continue
        component = _connected_component(item, neighbors, remaining_set)
        visited |= component
        if len(component) >= 2:
            merged_id = f"merged::{min(component)}"
            for member in component:
                group_of[member] = merged_id

    still_unresolved = [i for i in items if i not in group_of]
    return group_of, still_unresolved


def aggregate_edges(
    group_of: dict[str, str], edges: Iterable[tuple[str, str, int]]
) -> dict[tuple[str, str], int]:
    """Rolls item-level edges up to their groups' edges; drops intra-group and unmapped traffic."""
    aggregated: dict[tuple[str, str], int] = {}
    for a, b, weight in edges:
        group_a, group_b = group_of.get(a), group_of.get(b)
        if group_a is None or group_b is None or group_a == group_b:
            continue
        key = _pair_key(group_a, group_b)
        aggregated[key] = aggregated.get(key, 0) + weight
    return aggregated


def _file_folder(path: str) -> str:
    parent = Path(path).parent.as_posix()
    return parent if parent != "." else ROOT_FOLDER


def _folder_default_for_files(files: list[str]) -> Callable[[str], str | None]:
    """A folder shared by >=2 files is a real default group; a lone file falls through."""
    folder_counts = Counter(_file_folder(f) for f in files)
    trivial_repo = len(files) <= 1

    def default_group_of(file: str) -> str | None:
        folder = _file_folder(file)
        if trivial_repo or folder_counts[folder] >= 2:
            return f"folder::{folder}"
        return None

    return default_group_of


def _files_by_dir(files: list[str]) -> dict[str, list[str]]:
    by_dir: dict[str, list[str]] = {}
    for f in files:
        by_dir.setdefault(Path(f).parent.as_posix(), []).append(f)
    return by_dir


def file_edge_weights(graph: Graph) -> dict[tuple[str, str], int]:
    """Aggregate, bidirectional, cross-file call-graph traffic per unordered file pair."""
    index = build_dependency_index(graph)
    weights: dict[tuple[str, str], int] = {}
    for from_id, to_id in iter_symbol_edges(index):
        from_symbol = graph.symbols.get(from_id)
        to_symbol = graph.symbols.get(to_id)
        if from_symbol is None or to_symbol is None:
            continue
        if from_symbol.file_path == to_symbol.file_path:
            continue
        key = _pair_key(from_symbol.file_path, to_symbol.file_path)
        weights[key] = weights.get(key, 0) + 1
    return weights


def _raw_import_edges(
    graph: Graph, repo_root: Path, registry: AnalyzerRegistry, files_by_dir: dict[str, list[str]]
) -> dict[tuple[str, str], int]:
    """file<->file "imports" edges from raw Symbol.imports -- independent of any resolved call."""
    weights: dict[tuple[str, str], int] = {}
    for symbol in graph.symbols.values():
        if symbol.kind != SymbolKind.MODULE or not symbol.imports:
            continue
        analyzer = registry.for_file(symbol.file_path)
        if analyzer is None:
            continue
        for dotted in set(symbol.imports.values()):
            candidate = analyzer.resolve_import(dotted, symbol.file_path, repo_root)
            if candidate is None:
                continue
            for target in files_by_dir.get(candidate, [candidate]):
                if target == symbol.file_path:
                    continue
                key = _pair_key(symbol.file_path, target)
                weights[key] = weights.get(key, 0) + 1
    return weights


def build_component_clusters(
    graph: Graph,
    repo_root: Path,
    registry: AnalyzerRegistry,
    edge_weights: dict[tuple[str, str], int] | None = None,
) -> tuple[dict[str, str], list[str]]:
    """file -> group_id for every parsed file, plus the files no signal could place."""
    all_files = {s.file_path for s in graph.symbols.values()}
    files = sorted(f for f in all_files if not _is_infra_path(f))
    if edge_weights is None:
        edge_weights = file_edge_weights(graph)
    group_of, unresolved = _resolve_chain(files, _folder_default_for_files(files), edge_weights)

    files_by_dir = _files_by_dir(files)
    import_weights = _raw_import_edges(graph, repo_root, registry, files_by_dir)
    import_neighbors = _build_neighbor_weights(import_weights)
    for file in list(unresolved):
        winner = plurality_winner(_neighbor_votes(file, group_of, import_neighbors))
        if winner is not None:
            group_of[file] = winner
            unresolved.remove(file)

    return group_of, unresolved


def _top_segment(path: str) -> str:
    parts = Path(path).parts
    return parts[0] if parts else ROOT_FOLDER


def _container_default_for_components(
    components: list[ComponentCluster],
) -> Callable[[str], str | None]:
    """A top-level dir shared by >=2 components' files is a real default container."""
    top_segment_by_component: dict[str, str | None] = {}
    for comp in components:
        top_segment_by_component[comp.id] = plurality_winner(
            Counter(_top_segment(f) for f in comp.files)
        )
    trivial = len(components) <= 1
    segment_counts = Counter(v for v in top_segment_by_component.values() if v is not None)

    def default_group_of(component_id: str) -> str | None:
        segment = top_segment_by_component.get(component_id)
        if segment is None:
            return None
        if trivial or segment_counts[segment] >= 2:
            return f"top::{segment}"
        return None

    return default_group_of


def build_container_clusters(
    components: list[ComponentCluster], component_edges: dict[tuple[str, str], int]
) -> dict[str, str]:
    """component_id -> container group_id; a signal-less component becomes its own container."""
    # No import-fallback here: Symbol.imports is a file-level signal only, so pass 2 reuses 3 steps.
    component_ids = [c.id for c in components]
    group_of, unresolved = _resolve_chain(
        component_ids, _container_default_for_components(components), component_edges
    )
    for component_id in unresolved:
        group_of[component_id] = f"solo::{component_id}"
    return group_of


def build_clusters(graph: Graph, repo_root: Path, registry: AnalyzerRegistry) -> ClusterResult:
    """The full C2-join result: deterministic files[]/edges[] ready for manifest.json."""
    weights = file_edge_weights(graph)
    file_group_of, undetermined_files = build_component_clusters(
        graph, repo_root, registry, weights
    )

    components_by_group: dict[str, list[str]] = {}
    for file, group in file_group_of.items():
        components_by_group.setdefault(group, []).append(file)
    components = [
        ComponentCluster(id=group_id, container_id="", files=sorted(files))
        for group_id, files in sorted(components_by_group.items())
    ]
    component_edge_weights = aggregate_edges(
        file_group_of, ((a, b, w) for (a, b), w in weights.items())
    )

    container_group_of = build_container_clusters(components, component_edge_weights)
    for comp in components:
        comp.container_id = container_group_of[comp.id]

    containers_by_group: dict[str, list[str]] = {}
    for comp in components:
        containers_by_group.setdefault(comp.container_id, []).append(comp.id)
    containers = [
        ContainerCluster(id=group_id, component_ids=sorted(ids))
        for group_id, ids in sorted(containers_by_group.items())
    ]
    container_edge_weights = aggregate_edges(
        container_group_of, ((a, b, w) for (a, b), w in component_edge_weights.items())
    )

    return ClusterResult(
        components=components,
        containers=containers,
        component_edges=[
            ClusterEdge(a, b, w) for (a, b), w in sorted(component_edge_weights.items()) if w >= 1
        ],
        container_edges=[
            ClusterEdge(a, b, w) for (a, b), w in sorted(container_edge_weights.items()) if w >= 1
        ],
        undetermined_files=sorted(undetermined_files),
        file_edge_weights=weights,
    )


def undetermined_candidates(
    file: str,
    result: ClusterResult,
    weights: dict[tuple[str, str], int],
    limit: int = 3,
) -> list[dict]:
    """2-3 real candidate components (id + already-assigned files) closest to `file`, never code."""
    file_to_component = {f: c.id for c in result.components for f in c.files}
    files_by_component = {c.id: c.files for c in result.components}
    neighbors = _build_neighbor_weights(weights)

    votes: Counter[str] = Counter()
    for other, weight in neighbors.get(file, {}).items():
        component_id = file_to_component.get(other)
        if component_id is not None:
            votes[component_id] += weight

    ranked = [component_id for component_id, _ in votes.most_common(limit)]
    for comp in result.components:
        if len(ranked) >= limit:
            break
        if comp.id not in ranked:
            ranked.append(comp.id)

    return [{"id": cid, "files": files_by_component[cid]} for cid in ranked[:limit]]
