"""Unit coverage for build_dependency_digest: the shared file/class/function call digest."""

import json
import shutil
from pathlib import Path

import pytest

from codechroma.dependencies import digest as digest_module
from codechroma.dependencies.digest import build_dependency_digest
from codechroma.engine import GraphEngine
from codechroma.graph.models import Graph, HierarchyLevel, HierarchyNode, Symbol, SymbolKind
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    return root


@pytest.fixture
def graph(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    return engine.snapshot()


def _digest_file(built: dict, path: str) -> dict:
    return next(entry for entry in built["files"] if entry["path"] == path)


def test_every_parsed_file_appears_with_its_component_node_id(graph, repo):
    built = build_dependency_digest(graph, repo)

    billing = _digest_file(built, "billing/service.py")
    assert billing["node_id"] == "component::billing/service.py"


def test_cross_file_call_resolves_as_a_class_calls_entry(graph, repo):
    built = build_dependency_digest(graph, repo)

    billing = _digest_file(built, "billing/service.py")
    billing_service = next(c for c in billing["classes"] if c["name"] == "BillingService")
    assert "shared/text_utils.py::function::slugify" in billing_service["calls"]


def test_digest_round_trips_through_json(graph, repo):
    built = build_dependency_digest(graph, repo)

    assert json.loads(json.dumps(built)) == built


def _module_symbol(file_path: str) -> Symbol:
    return Symbol(
        id=f"{file_path}::module::mod",
        file_path=file_path,
        kind=SymbolKind.MODULE,
        name="mod",
        qualified_name="mod",
        start_line=1,
        end_line=1,
        language="python",
    )


def test_fan_out_beyond_the_callee_cap_is_truncated_with_an_overflow_count(tmp_path):
    file_path = "big.py"
    module = _module_symbol(file_path)
    caller = Symbol(
        id=f"{file_path}::function::caller",
        file_path=file_path,
        kind=SymbolKind.FUNCTION,
        name="caller",
        qualified_name="caller",
        start_line=1,
        end_line=20,
        language="python",
        parent_symbol_id=module.id,
    )
    callees = [
        Symbol(
            id=f"{file_path}::function::callee_{i}",
            file_path=file_path,
            kind=SymbolKind.FUNCTION,
            name=f"callee_{i}",
            qualified_name=f"callee_{i}",
            start_line=1,
            end_line=1,
            language="python",
            parent_symbol_id=module.id,
        )
        for i in range(20)
    ]
    caller_node = HierarchyNode(
        id=caller.id,
        name=caller.name,
        level=HierarchyLevel.FUNCTION,
        depends_on_ids=sorted(c.id for c in callees),
    )
    callee_nodes = {
        c.id: HierarchyNode(id=c.id, name=c.name, level=HierarchyLevel.FUNCTION) for c in callees
    }
    graph = Graph(
        nodes={caller.id: caller_node, **callee_nodes},
        symbols={module.id: module, caller.id: caller, **{c.id: c for c in callees}},
    )

    built = build_dependency_digest(graph, tmp_path)

    entry = _digest_file(built, file_path)
    caller_entry = next(f for f in entry["functions"] if f["name"] == "caller")
    assert len(caller_entry["calls"]) == digest_module.max_callees_per_symbol()
    assert caller_entry["calls_overflow"] == 20 - digest_module.max_callees_per_symbol()


def test_trivial_no_call_function_is_omitted_and_counted(tmp_path):
    file_path = "small.py"
    module = _module_symbol(file_path)
    trivial = Symbol(
        id=f"{file_path}::function::trivial",
        file_path=file_path,
        kind=SymbolKind.FUNCTION,
        name="trivial",
        qualified_name="trivial",
        start_line=5,
        end_line=5,
        language="python",
        parent_symbol_id=module.id,
    )
    trivial_node = HierarchyNode(id=trivial.id, name=trivial.name, level=HierarchyLevel.FUNCTION)
    graph = Graph(
        nodes={trivial.id: trivial_node},
        symbols={module.id: module, trivial.id: trivial},
    )

    built = build_dependency_digest(graph, tmp_path)

    entry = _digest_file(built, file_path)
    assert entry["functions"] == []
    assert entry["functions_omitted"] == 1


def test_low_file_cap_marks_the_digest_truncated(graph, repo, monkeypatch):
    monkeypatch.setattr(digest_module, "max_detailed_files", lambda: 1)

    built = build_dependency_digest(graph, repo)

    assert built["truncated"] is True
    assert built["files_omitted"] >= 1
    assert any(entry.get("detail_omitted") for entry in built["files"])
