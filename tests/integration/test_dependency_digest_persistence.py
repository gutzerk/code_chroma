"""Integration test: the dependency digest is written on analyze/reanalyze, never fails the run."""

import json
import shutil
from pathlib import Path

import pytest

from codechroma.dependencies.digest import dependency_digest_path
from codechroma.engine import GraphEngine
from codechroma.graph.models import RunStatus
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    return root


def test_analyze_writes_a_valid_dependency_digest(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))

    path = dependency_digest_path(repo)
    digest = json.loads(path.read_text())
    assert digest["totals"]["file_count"] > 0


def test_reanalyze_rewrites_the_digest_with_a_new_edge(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    service_path = repo / "users" / "service.py"
    service_path.write_text(
        service_path.read_text() + "\n\ndef noop_helper():\n    return slugify('x')\n"
    )

    engine.reanalyze(["users/service.py"])

    digest = json.loads(dependency_digest_path(repo).read_text())
    users_file = next(f for f in digest["files"] if f["path"] == "users/service.py")
    assert any(fn["name"] == "noop_helper" for fn in users_file["functions"])


def test_a_failing_digest_build_does_not_fail_the_analysis_run(repo, monkeypatch):
    import codechroma.engine as engine_module

    def _boom(*args, **kwargs):
        raise RuntimeError("digest boom")

    monkeypatch.setattr(engine_module, "build_dependency_digest", _boom)
    engine = GraphEngine(summarizer=AISummarizer())

    result = engine.analyze(str(repo))

    assert result.status == RunStatus.SUCCEEDED.value
