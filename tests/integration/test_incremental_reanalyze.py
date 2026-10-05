"""Integration test for incremental re-analysis (FR-009, quickstart.md Scenario 4).

Modifies one fixture file, calls reanalyze([that_file]), and asserts the returned GraphDiff
only references nodes reachable from that file.
"""

import shutil
from pathlib import Path

from codechroma.engine import GraphEngine
from codechroma.graph.store import SqliteGraphStore

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _copy_fixture(tmp_path: Path) -> Path:
    repo_copy = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo_copy)
    return repo_copy


def test_reanalyze_only_touches_nodes_reachable_from_changed_file(tmp_path):
    repo = _copy_fixture(tmp_path)
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    engine = GraphEngine(store=store)
    engine.analyze(str(repo))

    changed_file = repo / "billing" / "service.py"
    with changed_file.open("a") as f:
        f.write(
            "\n    def cancel_invoice(self, invoice_id: str) -> None:\n"
            "        del self._invoices[invoice_id]\n"
        )

    result = engine.reanalyze(["billing/service.py"])

    assert result.status == "succeeded"
    assert result.diff.removed_node_ids == []
    assert result.diff.reparented_node_ids == []
    assert result.diff.added_node_ids
    assert all("billing/service.py" in node_id for node_id in result.diff.added_node_ids)

    new_function = engine.get_node(
        "billing/service.py::function::BillingService.cancel_invoice"
    )
    assert new_function is not None
    assert engine.get_summary(new_function.id) is not None


def test_reanalyze_preserves_stable_ids_for_unrelated_nodes(tmp_path):
    repo = _copy_fixture(tmp_path)
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    engine = GraphEngine(store=store)
    engine.analyze(str(repo))

    shared_component_id = "component::shared/text_utils.py"
    before_node = engine.get_node(shared_component_id)
    assert before_node is not None

    (repo / "users" / "service.py").write_text(
        (repo / "users" / "service.py").read_text(encoding="utf-8") + "\n\ndef noop():\n    pass\n"
, encoding="utf-8")
    engine.reanalyze(["users/service.py"])

    after_node = engine.get_node(shared_component_id)
    assert after_node is not None
    assert after_node.parent_ids == before_node.parent_ids


def test_reanalyze_removes_nodes_for_deleted_file(tmp_path):
    repo = _copy_fixture(tmp_path)
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    engine = GraphEngine(store=store)
    engine.analyze(str(repo))

    (repo / "web" / "widget.ts").unlink()
    result = engine.reanalyze(["web/widget.ts"])

    assert result.status == "succeeded"
    assert "component::web/widget.ts" in result.diff.removed_node_ids
    assert engine.get_node("component::web/widget.ts") is None
