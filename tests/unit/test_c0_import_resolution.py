"""Real cross-file call/import edges (C0) via resolve_import, per language, plus qualifier gaps."""

import shutil
from pathlib import Path

import pytest

from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "c0_import_resolution"


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


def test_python_qualifier_call_resolves_across_the_src_layout_package_root(graph):
    node = graph.nodes["src/pkg/service.py::function::Factory.make"]

    assert node.depends_on_ids == ["src/pkg/models.py::function::build"]


def test_python_self_call_never_produces_a_cross_file_edge(graph):
    node = graph.nodes["src/pkg/service.py::function::Factory._local_helper"]

    assert node.depends_on_ids == []


def test_go_qualifier_call_resolves_via_the_gomod_package_directory(graph):
    node = graph.nodes["goservice/handler.go::function::Greet"]

    assert node.depends_on_ids == ["goutil/helper.go::function::Helper"]


def test_typescript_relative_import_resolves_to_the_real_file(graph):
    node = graph.nodes["web/index.ts::function::greet"]

    assert node.depends_on_ids == ["web/utils.ts::function::helper"]
