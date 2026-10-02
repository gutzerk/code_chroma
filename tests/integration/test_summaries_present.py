"""Integration test for User Story 2: every hierarchy node has a non-null AI summary.

Covers spec SC-003 and quickstart.md Scenario 2.
"""

from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.graph.store import SqliteGraphStore

FIXTURE_REPO = str(Path(__file__).parent.parent / "fixtures" / "sample_repo")


def _walk_all_nodes(engine: GraphEngine) -> list:
    collected = []

    def _walk(node_id: str) -> None:
        for child in engine.get_children(node_id):
            collected.append(child)
            _walk(child.id)

    _walk("__root__")
    return collected


def test_every_node_has_a_summary(tmp_path):
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    engine = GraphEngine(store=store)
    engine.analyze(FIXTURE_REPO)

    all_nodes = _walk_all_nodes(engine)
    assert all_nodes
    for node in all_nodes:
        summary = engine.get_summary(node.id)
        assert summary is not None
        assert summary.text
