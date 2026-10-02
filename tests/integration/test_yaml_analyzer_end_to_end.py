"""Integration test: a GitHub Actions file gets real Service/Function children, not a placeholder.

Regression test for the original complaint -- an unanalyzed .yml file rendered as an empty
childless box (see docs/planning/050-yaml-analyzer/050-yaml-analyzer.md).
"""

from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.graph.models import HierarchyLevel
from codechroma.graph.store import SqliteGraphStore

FIXTURE_REPO = str(Path(__file__).parent.parent / "fixtures" / "yaml_repo")


def _make_engine(tmp_path: Path) -> GraphEngine:
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    return GraphEngine(store=store)


def test_composite_action_file_gets_a_service_with_a_step_function(tmp_path):
    engine = _make_engine(tmp_path)
    engine.analyze(FIXTURE_REPO)

    component = engine.get_node("component::.github/actions/my-action/action.yml")
    services = engine.get_children(component.id)
    functions = engine.get_children(services[0].id)
    assert len(services) == 1
    assert services[0].level == HierarchyLevel.SERVICE
    assert services[0].name == "My Action"
    assert len(functions) == 1
    assert functions[0].level == HierarchyLevel.FUNCTION
    assert functions[0].name == "Resolve pinned contracts/ submodule"


def test_workflow_file_gets_a_service_per_job_with_step_functions(tmp_path):
    engine = _make_engine(tmp_path)
    engine.analyze(FIXTURE_REPO)

    component = engine.get_node("component::.github/workflows/ci.yml")
    services = engine.get_children(component.id)
    steps = engine.get_children(services[0].id)
    step_names = {step.name for step in steps}
    assert len(services) == 1
    assert services[0].name == "Build and test"
    assert step_names == {"Checkout", "Run tests"}


def test_function_still_decomposes_into_a_logic_block_and_code_leaf(tmp_path):
    engine = _make_engine(tmp_path)
    engine.analyze(FIXTURE_REPO)

    component = engine.get_node("component::.github/actions/my-action/action.yml")
    service = engine.get_children(component.id)[0]
    function = engine.get_children(service.id)[0]
    logic_blocks = engine.get_children(function.id)
    code_leaves = engine.get_children(logic_blocks[0].id)
    assert len(logic_blocks) == 1
    assert logic_blocks[0].level == HierarchyLevel.LOGIC_BLOCK
    assert len(code_leaves) == 1
    assert code_leaves[0].level == HierarchyLevel.CODE
