"""Unit tests for wiki/hashtree.py's HashNode, build_tree(), diff_tree(), and persistence."""

import pytest

from codechroma.graph.models import Graph, HierarchyLevel, HierarchyNode
from codechroma.wiki.hashtree import (
    HashNode,
    build_tree,
    diff_tree,
    load_previous_tree,
    persist_tree,
)


def _graph_with_two_files() -> Graph:
    nodes = {
        "dir::pkg": HierarchyNode(
            id="dir::pkg", name="pkg", level=HierarchyLevel.SYSTEM, source_path="pkg"
        ),
        "component::pkg/a.py": HierarchyNode(
            id="component::pkg/a.py",
            name="a.py",
            level=HierarchyLevel.COMPONENT,
            parent_ids=["dir::pkg"],
            source_path="pkg/a.py",
        ),
        "component::pkg/b.py": HierarchyNode(
            id="component::pkg/b.py",
            name="b.py",
            level=HierarchyLevel.COMPONENT,
            parent_ids=["dir::pkg"],
            source_path="pkg/b.py",
        ),
    }
    return Graph(nodes=nodes)


@pytest.fixture
def repo_root(tmp_path):
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "a.py").write_text("print('a')\n")
    (tmp_path / "pkg" / "b.py").write_text("print('b')\n")
    return tmp_path


def test_build_tree_root_hash_is_stable_for_identical_content(repo_root):
    graph = _graph_with_two_files()

    first = build_tree(graph, repo_root)
    second = build_tree(graph, repo_root)

    assert first.hash == second.hash


def test_build_tree_root_hash_changes_when_a_file_changes(repo_root):
    graph = _graph_with_two_files()
    before = build_tree(graph, repo_root)

    (repo_root / "pkg" / "a.py").write_text("print('changed')\n")
    after = build_tree(graph, repo_root)

    assert before.hash != after.hash


def test_diff_tree_returns_nothing_and_does_not_descend_when_root_hashes_match():
    old = HashNode(path="", hash="same", children={"pkg": HashNode(path="pkg", hash="old-child")})
    new = HashNode(path="", hash="same", children={"pkg": HashNode(path="pkg", hash="new-child")})

    assert diff_tree(old, new) == []


def test_diff_tree_reports_only_the_one_changed_file(repo_root):
    graph = _graph_with_two_files()
    old = build_tree(graph, repo_root)

    (repo_root / "pkg" / "a.py").write_text("print('changed')\n")
    new = build_tree(graph, repo_root)

    assert diff_tree(old, new) == ["pkg/a.py"]


def test_diff_tree_reports_an_added_folder_without_descending(repo_root):
    graph = _graph_with_two_files()
    old = build_tree(graph, repo_root)

    (repo_root / "extra").mkdir()
    (repo_root / "extra" / "c.py").write_text("print('c')\n")
    new_nodes = dict(graph.nodes)
    new_nodes["dir::extra"] = HierarchyNode(
        id="dir::extra", name="extra", level=HierarchyLevel.SYSTEM, source_path="extra"
    )
    new_nodes["component::extra/c.py"] = HierarchyNode(
        id="component::extra/c.py",
        name="c.py",
        level=HierarchyLevel.COMPONENT,
        parent_ids=["dir::extra"],
        source_path="extra/c.py",
    )
    new = build_tree(Graph(nodes=new_nodes), repo_root)

    assert diff_tree(old, new) == ["extra"]


def test_diff_tree_reports_a_removed_file(repo_root):
    graph = _graph_with_two_files()
    old = build_tree(graph, repo_root)

    reduced_nodes = {k: v for k, v in graph.nodes.items() if k != "component::pkg/b.py"}
    new = build_tree(Graph(nodes=reduced_nodes), repo_root)

    assert diff_tree(old, new) == ["pkg/b.py"]


def test_diff_tree_returns_every_path_when_old_is_none(repo_root):
    graph = _graph_with_two_files()
    new = build_tree(graph, repo_root)

    assert set(diff_tree(None, new)) == {"pkg", "pkg/a.py", "pkg/b.py"}


def test_build_tree_does_not_crash_when_a_tracked_file_is_missing_on_disk(repo_root):
    graph = _graph_with_two_files()
    (repo_root / "pkg" / "a.py").unlink()

    tree = build_tree(graph, repo_root)

    assert tree.children["pkg"].children["a.py"].hash == "missing"


def test_persist_tree_then_load_previous_tree_round_trips(repo_root):
    graph = _graph_with_two_files()
    tree = build_tree(graph, repo_root)
    output_dir = repo_root / ".codechroma" / "wiki"

    persist_tree(output_dir, tree)
    loaded = load_previous_tree(output_dir)

    assert loaded == tree
