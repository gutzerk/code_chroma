"""Integration test: the hierarchy mirrors the real directory tree.

A file lives under its own directory node only -- never re-parented under other directories just
because their code references it. Nested directories produce nested folder nodes.
"""

from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.graph.models import HierarchyLevel
from codechroma.graph.store import SqliteGraphStore

FIXTURE_REPO = str(Path(__file__).parent.parent / "fixtures" / "sample_repo")


def test_component_has_single_directory_parent(tmp_path):
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    engine = GraphEngine(store=store)
    engine.analyze(FIXTURE_REPO)

    shared_component = engine.get_node("component::shared/text_utils.py")
    assert shared_component is not None
    assert shared_component.parent_ids == ["dir::shared"]


def test_component_reachable_via_get_children_from_its_directory(tmp_path):
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    engine = GraphEngine(store=store)
    engine.analyze(FIXTURE_REPO)

    children = engine.get_children("dir::shared")
    assert any(c.id == "component::shared/text_utils.py" for c in children)


def test_nested_directory_produces_nested_folder_nodes(tmp_path):
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    engine = GraphEngine(store=store)
    engine.analyze(FIXTURE_REPO)

    nested_component = engine.get_node("component::billing/models/invoice.py")
    assert nested_component is not None
    assert nested_component.parent_ids == ["dir::billing/models"]

    models_dir = engine.get_node("dir::billing/models")
    assert models_dir.level == HierarchyLevel.PILLAR
    assert models_dir.name == "models"
    assert models_dir.parent_ids == ["dir::billing"]

    billing_dir = engine.get_node("dir::billing")
    assert billing_dir.level == HierarchyLevel.SYSTEM
    assert billing_dir.parent_ids == []
