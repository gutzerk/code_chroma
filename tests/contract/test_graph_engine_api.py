"""Contract test: GraphEngine matches contracts/graph-engine-api.md's public interface."""

import inspect
from unittest.mock import patch

from codechroma.engine import GraphEngine

CONTRACT_METHODS = (
    "analyze",
    "reanalyze",
    "get_node",
    "get_children",
    "get_summary",
    "get_dependencies",
    "get_dependents",
)


def test_exposes_all_contract_methods():
    for method_name in CONTRACT_METHODS:
        assert callable(getattr(GraphEngine, method_name, None))


def test_analyze_accepts_repo_path():
    params = list(inspect.signature(GraphEngine.analyze).parameters)
    assert params[1] == "repo_path"


def test_reanalyze_accepts_changed_files():
    params = list(inspect.signature(GraphEngine.reanalyze).parameters)
    assert params[1] == "changed_files"


def test_read_accessors_are_safe_before_any_analysis():
    engine = GraphEngine()

    assert engine.get_node("missing") is None
    assert engine.get_children("__root__") == []
    assert engine.get_summary("missing") is None
    assert engine.get_dependencies("missing") == []
    assert engine.get_dependents("missing") == []


def test_analyze_and_reanalyze_never_call_sync_wiki(tmp_path):
    (tmp_path / "a.py").write_text('"""A module."""\n', encoding="utf-8")
    engine = GraphEngine()

    with patch("codechroma.engine.sync_wiki") as mock_sync_wiki:
        engine.analyze(str(tmp_path))
        engine.reanalyze(["a.py"])

    mock_sync_wiki.assert_not_called()
