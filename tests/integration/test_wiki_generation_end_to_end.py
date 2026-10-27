"""Integration test: real GraphEngine().analyze() then generate_wiki(), on-demand only."""

import json
import shutil
from pathlib import Path

import pytest

from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"
POLYGLOT_FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "polyglot_repo"


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    return root


@pytest.fixture(scope="module")
def sample_wiki(tmp_path_factory):
    root = tmp_path_factory.mktemp("wiki_sample") / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(root))
    return root, engine.generate_wiki()


@pytest.fixture(scope="module")
def polyglot_wiki(tmp_path_factory):
    root = tmp_path_factory.mktemp("wiki_polyglot") / "polyglot_repo"
    shutil.copytree(POLYGLOT_FIXTURE_REPO, root)
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(root))
    return engine.generate_wiki()


def test_analyze_alone_never_creates_the_wiki_directory(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))

    assert not (repo / ".codechroma" / "wiki").exists()


def test_generate_wiki_before_analyze_raises(repo):
    engine = GraphEngine(summarizer=AISummarizer())

    with pytest.raises(RuntimeError):
        engine.generate_wiki()


def test_generate_wiki_after_analyze_writes_the_full_tree_with_real_docstrings(sample_wiki):
    root, result = sample_wiki

    out = result.output_dir
    assert out == root / ".codechroma" / "wiki"
    for rel in ("index.md", "files/billing/index.md", "files/billing/models/index.md"):
        assert (out / rel).exists()
    assert (out / "files" / "billing" / "models" / "invoice.md").exists()
    assert result.gap_report_path.exists()
    text = (out / "files" / "billing" / "service.md").read_text(encoding="utf-8")
    assert "Billing and invoicing service." in text
    assert "Create an invoice for the named account." in text


def test_gap_report_flags_only_the_undocumented_exported_go_and_ts_symbols(sample_wiki):
    _, result = sample_wiki

    gaps = json.loads(result.gap_json_path.read_text(encoding="utf-8"))
    go_and_ts_gaps = {
        g["qualified_name"]
        for g in gaps
        if g["path"] in ("billing/reporter.go", "web/UserCard.tsx")
    }
    assert go_and_ts_gaps == {"SendReport", "trackUserCardView"}


def test_generate_wiki_shows_summaries_for_all_seven_new_languages(polyglot_wiki):
    for name in (
        "JavaGreeter.md",
        "CSharpGreeter.md",
        "rust_greeter.md",
        "php_greeter.md",
        "ruby_greeter.md",
        "c_greeter.md",
    ):
        text = (polyglot_wiki.output_dir / "files" / name).read_text(encoding="utf-8")
        assert "Builds the greeting for a name." in text
        assert "*no docstring*" in text


def test_h_extension_resolves_through_the_cpp_analyzer_end_to_end(polyglot_wiki):
    text = (polyglot_wiki.output_dir / "files" / "cpp_greeter.md").read_text(encoding="utf-8")

    assert "### Greeter" in text
    assert "Greets people by name." in text
