"""HashNode: a Merkle tree over the wiki's folder/file hierarchy, for a one-comparison freshness."""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from pathlib import Path

from codechroma.fingerprint import hash_lines
from codechroma.graph.models import Graph, HierarchyLevel, HierarchyNode
from codechroma.io import load_json_or_none, write_json
from codechroma.wiki.generator import children_by_parent

HASHTREE_FILENAME = ".hashtree.json"


@dataclass(slots=True)
class HashNode:
    """One file or folder's content hash -- the spec's Freshness Snapshot entity (data-model.md)."""

    path: str
    hash: str
    children: dict[str, HashNode] = field(default_factory=dict)


def _hash_children(children: dict[str, HashNode]) -> str:
    return hash_lines(f"{name}:{child.hash}" for name, child in children.items())


def _build_node(
    node: HierarchyNode, children_map: dict[str, list[HierarchyNode]], repo_root: Path
) -> HashNode:
    path = node.source_path or node.name
    if node.level == HierarchyLevel.COMPONENT:
        try:
            content = (repo_root / path).read_bytes()
        except OSError:
            # Deleted on disk since the last reanalyze() -- a stable sentinel hash, not a crash.
            return HashNode(path=path, hash="missing")
        return HashNode(path=path, hash=hashlib.sha1(content).hexdigest())
    child_nodes = sorted(children_map.get(node.id, []), key=lambda n: n.name)
    children = {child.name: _build_node(child, children_map, repo_root) for child in child_nodes}
    return HashNode(path=path, hash=_hash_children(children), children=children)


def build_tree(
    graph: Graph, repo_root: Path, children_map: dict[str, list[HierarchyNode]] | None = None
) -> HashNode:
    """Hashes every parsed file and folder in graph into one rooted HashNode tree."""
    if children_map is None:
        children_map = children_by_parent(graph.nodes)
    top_level = sorted(
        (n for n in graph.nodes.values() if n.level == HierarchyLevel.SYSTEM),
        key=lambda n: n.name,
    )
    children = {folder.name: _build_node(folder, children_map, repo_root) for folder in top_level}
    return HashNode(path="", hash=_hash_children(children), children=children)


def _all_paths(node: HashNode) -> list[str]:
    paths = [node.path] if node.path else []
    for child in node.children.values():
        paths.extend(_all_paths(child))
    return paths


def diff_tree(old: HashNode | None, new: HashNode) -> list[str]:
    """Paths whose hash changed since `old` (or every path, if `old` is None -- no prior state)."""
    if old is None:
        return _all_paths(new)
    if old.hash == new.hash:
        return []
    if not old.children and not new.children:
        return [new.path]
    changed: list[str] = []
    for name in sorted(set(old.children) | set(new.children)):
        old_child = old.children.get(name)
        new_child = new.children.get(name)
        if old_child is None:
            assert new_child is not None
            changed.append(new_child.path)
        elif new_child is None:
            changed.append(old_child.path)
        elif old_child.hash != new_child.hash:
            changed.extend(diff_tree(old_child, new_child))
    return changed


def _dict_to_node(data: dict) -> HashNode:
    children = {name: _dict_to_node(child) for name, child in data.get("children", {}).items()}
    return HashNode(path=data["path"], hash=data["hash"], children=children)


def load_previous_tree(output_dir: Path) -> HashNode | None:
    """The last-persisted HashNode for this wiki output dir, or None if missing/corrupt."""
    data = load_json_or_none(output_dir / HASHTREE_FILENAME)
    if data is None:
        return None
    try:
        return _dict_to_node(data)
    except (KeyError, TypeError):
        return None


def persist_tree(output_dir: Path, tree: HashNode) -> None:
    """Saves `tree` as this wiki output dir's freshness snapshot for the next sync_wiki() call."""
    write_json(output_dir / HASHTREE_FILENAME, asdict(tree))
