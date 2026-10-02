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


@pytest.fixture
def polyglot_repo(tmp_path):
    root = tmp_path / "polyglot_repo"
    shutil.copytree(POLYGLOT_FIXTURE_REPO, root)
    return root


def test_analyze_alone_never_creates_the_wiki_directory(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))

    assert not (repo / ".codechroma" / "wiki").exists()


def test_generate_wiki_before_analyze_raises(repo):
    engine = GraphEngine(summarizer=AISummarizer())

    with pytest.raises(RuntimeError):
        engine.generate_wiki()


def test_generate_wiki_after_analyze_writes_the_full_tree(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    result = engine.generate_wiki()

    assert result.output_dir == repo / ".codechroma" / "wiki"
    assert (result.output_dir / "index.md").exists()
    assert (result.output_dir / "files" / "billing" / "index.md").exists()
    assert (result.output_dir / "files" / "billing" / "service.md").exists()
    assert (result.output_dir / "files" / "billing" / "models" / "invoice.md").exists()
    assert (result.output_dir / "files" / "billing" / "models" / "index.md").exists()
    assert result.gap_report_path.exists()
    assert result.gap_json_path.exists()


def test_generate_wiki_gives_a_nested_subfolder_its_own_index_page(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    result = engine.generate_wiki()

    nested_index = result.output_dir / "files" / "billing" / "models" / "index.md"
    parent_index = result.output_dir / "files" / "billing" / "index.md"
    assert "invoice.py" in nested_index.read_text()
    assert "models/index.md" in parent_index.read_text()


def test_generate_wiki_shows_real_docstrings_from_the_fixture_repo(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    result = engine.generate_wiki()

    text = (result.output_dir / "files" / "billing" / "service.md").read_text()
    assert "Billing and invoicing service." in text
    assert "Handles invoice creation for billed accounts." in text
    assert "Create an invoice for the named account." in text


def test_gap_json_is_valid_and_matches_undocumented_count(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    result = engine.generate_wiki()

    gaps = json.loads(result.gap_json_path.read_text())
    assert len(gaps) == result.undocumented_count


def test_generate_wiki_shows_full_breakdown_for_a_go_file(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    result = engine.generate_wiki()

    text = (result.output_dir / "files" / "billing" / "reporter.md").read_text()
    assert "Package billing generates billing reports." in text
    assert "### Report" in text
    assert "`RenderReport`" in text
    assert "RenderReport builds a human-readable summary for an account." in text
    assert "`formatCurrency`" in text
    assert "formatCurrency is an internal helper with no exported doc requirement." in text


def test_generate_wiki_shows_full_breakdown_for_a_tsx_file(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    result = engine.generate_wiki()

    text = (result.output_dir / "files" / "web" / "UserCard.md").read_text()
    assert "`UserCard`" in text
    assert "UserCard renders a single user's summary card." in text


def test_generate_wiki_shows_summaries_for_all_seven_new_languages(polyglot_repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(polyglot_repo))
    result = engine.generate_wiki()

    pages = {
        "JavaGreeter.md": "Builds the greeting for a name.",
        "CSharpGreeter.md": "Builds the greeting for a name.",
        "rust_greeter.md": "Builds the greeting for a name.",
        "php_greeter.md": "Builds the greeting for a name.",
        "ruby_greeter.md": "Builds the greeting for a name.",
        "c_greeter.md": "Builds the greeting for a name.",
    }
    for name, documented_summary in pages.items():
        text = (result.output_dir / "files" / name).read_text()
        assert documented_summary in text
        assert "*no docstring*" in text


def test_h_extension_resolves_through_the_cpp_analyzer_end_to_end(polyglot_repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(polyglot_repo))
    result = engine.generate_wiki()

    text = (result.output_dir / "files" / "cpp_greeter.md").read_text()
    assert "### Greeter" in text
    assert "Greets people by name." in text


def test_gap_report_flags_only_the_undocumented_exported_go_and_ts_symbols(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    result = engine.generate_wiki()

    gaps = json.loads(result.gap_json_path.read_text())
    go_and_ts_gaps = {
        g["qualified_name"]
        for g in gaps
        if g["path"] in ("billing/reporter.go", "web/UserCard.tsx")
    }
    assert go_and_ts_gaps == {"SendReport", "trackUserCardView"}
