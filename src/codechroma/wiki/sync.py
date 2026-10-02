"""sync_wiki(): rewrites what changed since the last sync, or the whole wiki on the first run."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import TYPE_CHECKING

from codechroma.dependencies.digest import group_by_file
from codechroma.graph.models import DIRECTORY_LEVELS, Graph, HierarchyLevel, HierarchyNode
from codechroma.wiki.generator import (
    FilePages,
    children_by_parent,
    compute_gaps,
    file_page_relative_path,
    generate_wiki,
    write_file_page,
    write_folder_page,
    write_gap_reports,
    write_root_page,
)
from codechroma.wiki.hashtree import (
    HashNode,
    build_tree,
    diff_tree,
    load_previous_tree,
    persist_tree,
)
from codechroma.wiki.models import WikiSyncResult

if TYPE_CHECKING:
    from codechroma.engine import GraphEngine


def _ancestor_folder_paths(path: str, nodes_by_path: dict[str, HierarchyNode]) -> list[str]:
    """Every still-existing ancestor folder path of `path`, closest first, up to a top-level dir."""
    ancestors: list[str] = []
    current = Path(path).parent
    while str(current) not in (".", ""):
        current_str = str(current)
        if current_str in nodes_by_path:
            ancestors.append(current_str)
        current = current.parent
    return ancestors


def _delete_removed_page(path: str, output_dir: Path) -> None:
    """Deletes a since-removed path's leftover wiki output: a file's page or a folder's subtree."""
    file_page = output_dir / "files" / file_page_relative_path(path)
    if file_page.is_file():
        file_page.unlink()
    folder_dir = output_dir / "files" / path
    if folder_dir.is_dir():
        shutil.rmtree(folder_dir)


def _write_folder_subtree(
    folder: HierarchyNode,
    children_map: dict[str, list[HierarchyNode]],
    files_by_path: FilePages,
    output_dir: Path,
) -> list[Path]:
    """Every page under a wholesale-added folder: its own index plus every descendant page."""
    pages = write_folder_page(folder, children_map, files_by_path, output_dir)
    for child in sorted(children_map.get(folder.id, []), key=lambda n: n.name):
        if child.level == HierarchyLevel.COMPONENT:
            file_symbols = files_by_path.get(child.source_path or "")
            if file_symbols is not None:
                pages.append(write_file_page(file_symbols, output_dir))
        else:
            pages.extend(_write_folder_subtree(child, children_map, files_by_path, output_dir))
    return pages


def _sync_partial(
    graph: Graph,
    repo_root: Path,
    output_dir: Path,
    changed: list[str],
    children_map: dict[str, list[HierarchyNode]],
) -> WikiSyncResult:
    files_by_path = group_by_file(graph)
    nodes_by_path = {n.source_path: n for n in graph.nodes.values() if n.source_path}

    regenerated: list[Path] = []
    folders_to_write: set[str] = set()

    for path in changed:
        file_symbols = files_by_path.get(path)
        node = nodes_by_path.get(path)
        if file_symbols is not None:
            regenerated.append(write_file_page(file_symbols, output_dir))
        elif node is not None and node.level in DIRECTORY_LEVELS:
            regenerated.extend(
                _write_folder_subtree(node, children_map, files_by_path, output_dir)
            )
        else:
            # Removed path: delete its stale page(s); surviving ancestors must drop it too.
            _delete_removed_page(path, output_dir)
        folders_to_write.update(_ancestor_folder_paths(path, nodes_by_path))

    for folder_path in sorted(folders_to_write):
        folder_node = nodes_by_path.get(folder_path)
        if folder_node is not None:
            regenerated.extend(
                write_folder_page(folder_node, children_map, files_by_path, output_dir)
            )

    regenerated.append(write_root_page(graph, repo_root, output_dir))

    gaps = compute_gaps(files_by_path)
    write_gap_reports(gaps, output_dir)

    return WikiSyncResult(
        changed_paths=sorted(set(changed)), regenerated_pages=regenerated, full_regeneration=False
    )


def _sync_full(
    graph: Graph, repo_root: Path, output_dir: Path
) -> tuple[WikiSyncResult, HashNode]:
    children_map = children_by_parent(graph.nodes)
    files_by_path = group_by_file(graph)
    result = generate_wiki(graph, repo_root, output_dir, children_map, files_by_path)
    new_tree = build_tree(graph, repo_root, children_map)
    return (
        WikiSyncResult(
            changed_paths=sorted(files_by_path),
            regenerated_pages=result.pages,
            full_regeneration=True,
        ),
        new_tree,
    )


def sync_wiki(engine: GraphEngine, output_dir: Path) -> WikiSyncResult:
    """Regenerates only what changed since the last sync, or the whole wiki on a first run."""
    repo_root = engine.repo_root
    graph = engine.snapshot()
    old = load_previous_tree(output_dir)
    if old is None:
        sync_result, new_tree = _sync_full(graph, repo_root, output_dir)
        persist_tree(output_dir, new_tree)
        return sync_result

    children_map = children_by_parent(graph.nodes)
    new_tree = build_tree(graph, repo_root, children_map)
    changed = diff_tree(old, new_tree)
    if not changed:
        return WikiSyncResult(changed_paths=[], regenerated_pages=[], full_regeneration=False)

    sync_result = _sync_partial(graph, repo_root, output_dir, changed, children_map)
    persist_tree(output_dir, new_tree)
    return sync_result
