"""Integration test for User Story 1: analyze() produces the full 7-level hierarchy.

Covers spec Acceptance Scenarios 1-3, SC-003 (summaries) and quickstart.md Scenarios 1-2.
"""

from pathlib import Path

import pytest

from codechroma.engine import GraphEngine
from codechroma.graph.models import HierarchyLevel
from codechroma.graph.store import SqliteGraphStore

FIXTURE_REPO = str(Path(__file__).parent.parent / "fixtures" / "sample_repo")


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    store = SqliteGraphStore(str(tmp_path_factory.mktemp("hier") / "graph.db"))
    engine = GraphEngine(store=store)
    result = engine.analyze(FIXTURE_REPO)
    assert result.status == "succeeded"
    return engine


def _walk_all_descendants(engine: GraphEngine, node_id: str) -> list:
    collected = []
    for child in engine.get_children(node_id):
        collected.append(child)
        collected.extend(_walk_all_descendants(engine, child.id))
    return collected


@pytest.fixture(scope="module")
def all_nodes(engine):
    return _walk_all_descendants(engine, "__root__")


def test_hierarchy_rooted_at_system_nodes_with_full_descendant_chain(engine, all_nodes):
    roots = engine.get_children("__root__")

    assert len(roots) >= 2
    assert all(r.level == HierarchyLevel.SYSTEM for r in roots)
    assert {n.level for n in all_nodes} == set(HierarchyLevel)


def test_function_has_at_least_one_logic_block(engine, all_nodes):
    functions = [n for n in all_nodes if n.level == HierarchyLevel.FUNCTION]

    assert functions
    for function in functions:
        logic_blocks = engine.get_children(function.id)
        assert len(logic_blocks) >= 1
        assert all(lb.level == HierarchyLevel.LOGIC_BLOCK for lb in logic_blocks)


def test_parent_child_links_are_consistent(engine, all_nodes):
    for node in all_nodes:
        if node.level == HierarchyLevel.SYSTEM:
            continue
        assert node.parent_ids
        for parent_id in node.parent_ids:
            assert any(c.id == node.id for c in engine.get_children(parent_id))


def test_every_node_has_a_summary(engine, all_nodes):
    assert all_nodes
    for node in all_nodes:
        summary = engine.get_summary(node.id)
        assert summary is not None
        assert summary.text
