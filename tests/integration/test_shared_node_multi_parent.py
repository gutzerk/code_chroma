"""Integration test: the hierarchy mirrors the real directory tree.

A file lives under its own directory node only -- never re-parented under other directories just
because their code references it. Nested directories produce nested folder nodes.
"""

from pathlib import Path

import pytest

from codechroma.engine import GraphEngine
from codechroma.graph.models import HierarchyLevel
from codechroma.graph.store import SqliteGraphStore

FIXTURE_REPO = str(Path(__file__).parent.parent / "fixtures" / "sample_repo")


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    store = SqliteGraphStore(str(tmp_path_factory.mktemp("shared") / "graph.db"))
    engine = GraphEngine(store=store)
    engine.analyze(FIXTURE_REPO)
    return engine


def test_component_has_single_directory_parent_and_is_reachable_from_it(engine):
    component = engine.get_node("component::shared/text_utils.py")

    assert component is not None
    assert component.parent_ids == ["dir::shared"]
    assert any(c.id == component.id for c in engine.get_children("dir::shared"))


def test_nested_directory_produces_nested_folder_nodes(engine):
    nested_component = engine.get_node("component::billing/models/invoice.py")
    models_dir = engine.get_node("dir::billing/models")
    billing_dir = engine.get_node("dir::billing")

    assert nested_component.parent_ids == ["dir::billing/models"]
    assert models_dir.level == HierarchyLevel.PILLAR
    assert models_dir.name == "models"
    assert models_dir.parent_ids == ["dir::billing"]
    assert billing_dir.level == HierarchyLevel.SYSTEM
    assert billing_dir.parent_ids == []
