"""Integration test for User Story 1: analyze() produces the full 7-level hierarchy.

Covers spec Acceptance Scenarios 1-3 and quickstart.md Scenario 1.
"""

from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.graph.models import HierarchyLevel
from codechroma.graph.store import SqliteGraphStore

FIXTURE_REPO = str(Path(__file__).parent.parent / "fixtures" / "sample_repo")


def _make_engine(tmp_path: Path) -> GraphEngine:
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    return GraphEngine(store=store)


def _walk_all_descendants(engine: GraphEngine, node_id: str) -> list:
    collected = []
    for child in engine.get_children(node_id):
        collected.append(child)
        collected.extend(_walk_all_descendants(engine, child.id))
    return collected


def test_analyze_succeeds(tmp_path):
    engine = _make_engine(tmp_path)
    result = engine.analyze(FIXTURE_REPO)
    assert result.status == "succeeded"


def test_hierarchy_rooted_at_system_nodes_with_full_descendant_chain(tmp_path):
    engine = _make_engine(tmp_path)
    engine.analyze(FIXTURE_REPO)

    roots = engine.get_children("__root__")
    assert len(roots) >= 1
    assert all(r.level == HierarchyLevel.SYSTEM for r in roots)

    all_nodes = []
    for root in roots:
        all_nodes.append(root)
        all_nodes.extend(_walk_all_descendants(engine, root.id))

    levels_present = {n.level for n in all_nodes}
    assert levels_present == set(HierarchyLevel)


def test_monorepo_with_unrelated_systems_produces_multiple_system_nodes(tmp_path):
    engine = _make_engine(tmp_path)
    engine.analyze(FIXTURE_REPO)

    roots = engine.get_children("__root__")
    assert len(roots) >= 2


def test_function_has_at_least_one_logic_block(tmp_path):
    engine = _make_engine(tmp_path)
    engine.analyze(FIXTURE_REPO)

    all_nodes = []
    for root in engine.get_children("__root__"):
        all_nodes.extend(_walk_all_descendants(engine, root.id))

    functions = [n for n in all_nodes if n.level == HierarchyLevel.FUNCTION]
    assert functions
    for function in functions:
        logic_blocks = engine.get_children(function.id)
        assert len(logic_blocks) >= 1
        assert all(lb.level == HierarchyLevel.LOGIC_BLOCK for lb in logic_blocks)


def test_parent_child_links_are_consistent(tmp_path):
    engine = _make_engine(tmp_path)
    engine.analyze(FIXTURE_REPO)

    roots = engine.get_children("__root__")
    all_nodes = list(roots)
    for root in roots:
        all_nodes.extend(_walk_all_descendants(engine, root.id))

    for node in all_nodes:
        if node.level == HierarchyLevel.SYSTEM:
            continue
        assert node.parent_ids
        for parent_id in node.parent_ids:
            parent_children = engine.get_children(parent_id)
            assert any(c.id == node.id for c in parent_children)
