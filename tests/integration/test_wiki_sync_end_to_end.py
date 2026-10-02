"""Integration test: real GraphEngine().analyze() then sync_wiki(), across the three stories."""

import shutil
from pathlib import Path

import pytest

from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    return root


def test_sync_wiki_before_analyze_raises(repo):
    engine = GraphEngine(summarizer=AISummarizer())

    with pytest.raises(RuntimeError):
        engine.sync_wiki()


def test_first_sync_matches_a_direct_generate_wiki_call(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))

    full = engine.generate_wiki(output_dir=repo / ".codechroma" / "wiki_full")
    sync_output_dir = repo / ".codechroma" / "wiki_sync"
    synced = engine.sync_wiki(output_dir=sync_output_dir)
    full_relative = {p.relative_to(full.output_dir) for p in full.pages}
    synced_relative = {p.relative_to(sync_output_dir) for p in synced.regenerated_pages}

    assert synced.full_regeneration is True
    assert full_relative == synced_relative
    assert (sync_output_dir / "index.md").exists()


def test_second_sync_with_no_changes_reports_and_writes_nothing(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    output_dir = repo / ".codechroma" / "wiki"
    engine.sync_wiki(output_dir=output_dir)
    mtimes_before = {p: p.stat().st_mtime_ns for p in output_dir.rglob("*.md")}

    result = engine.sync_wiki(output_dir=output_dir)

    assert result.changed_paths == []
    assert result.regenerated_pages == []
    mtimes_after = {p: p.stat().st_mtime_ns for p in output_dir.rglob("*.md")}
    assert mtimes_before == mtimes_after


def test_editing_one_file_rewrites_only_its_page_and_ancestor_indexes(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    output_dir = repo / ".codechroma" / "wiki"
    engine.sync_wiki(output_dir=output_dir)
    mtimes_before = {p: p.stat().st_mtime_ns for p in output_dir.rglob("*.md")}
    expected_pages = {
        output_dir / "files" / "billing" / "service.md",
        output_dir / "files" / "billing" / "index.md",
        output_dir / "index.md",
    }
    # gaps.md is a whole-repo aggregate, always rewritten on any change -- see research.md.
    also_rewritten = expected_pages | {output_dir / "gaps.md"}

    changed_file = repo / "billing" / "service.py"
    changed_file.write_text(
        changed_file.read_text().replace(
            "Create an invoice for the named account.",
            "Create an invoice for the named account, updated.",
        )
    )
    engine.reanalyze(["billing/service.py"])
    result = engine.sync_wiki(output_dir=output_dir)
    mtimes_after = {p: p.stat().st_mtime_ns for p in output_dir.rglob("*.md")}
    untouched = {path: mtime for path, mtime in mtimes_before.items() if path not in also_rewritten}

    assert result.changed_paths == ["billing/service.py"]
    assert set(result.regenerated_pages) == expected_pages
    assert all(mtimes_after[path] == mtime_before for path, mtime_before in untouched.items())


def test_editing_one_file_updates_gaps_but_not_a_sibling_file_page(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    output_dir = repo / ".codechroma" / "wiki"
    engine.sync_wiki(output_dir=output_dir)
    sibling_page = output_dir / "files" / "billing" / "reporter.md"
    sibling_before = sibling_page.read_text()

    changed_file = repo / "billing" / "service.py"
    changed_file.write_text(changed_file.read_text() + "\n\ndef helper():\n    pass\n")
    engine.reanalyze(["billing/service.py"])
    engine.sync_wiki(output_dir=output_dir)

    assert sibling_page.read_text() == sibling_before
    assert "helper" in (output_dir / "gaps.md").read_text()


def test_deleting_a_file_removes_its_page_and_updates_the_folder_index(repo):
    # billing/ has other files, so it survives service.py's removal and the deletion is file-level.
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    output_dir = repo / ".codechroma" / "wiki"
    engine.sync_wiki(output_dir=output_dir)
    page = output_dir / "files" / "billing" / "service.md"
    assert page.exists()

    (repo / "billing" / "service.py").unlink()
    engine.reanalyze(["billing/service.py"])
    result = engine.sync_wiki(output_dir=output_dir)

    assert result.changed_paths == ["billing/service.py"]
    assert not page.exists()
    assert "service" not in (output_dir / "files" / "billing" / "index.md").read_text()


def test_deleting_a_folder_removes_its_whole_page_subtree(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    output_dir = repo / ".codechroma" / "wiki"
    engine.sync_wiki(output_dir=output_dir)
    folder_dir = output_dir / "files" / "billing" / "models"
    assert folder_dir.is_dir()

    (repo / "billing" / "models" / "invoice.py").unlink()
    (repo / "billing" / "models").rmdir()
    engine.reanalyze(["billing/models/invoice.py"])
    result = engine.sync_wiki(output_dir=output_dir)

    assert "billing/models" in result.changed_paths
    assert not folder_dir.exists()
    assert "models" not in (output_dir / "files" / "billing" / "index.md").read_text()


def test_adding_a_folder_creates_pages_for_it_and_its_contents(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    output_dir = repo / ".codechroma" / "wiki"
    engine.sync_wiki(output_dir=output_dir)

    new_dir = repo / "newpkg"
    new_dir.mkdir()
    (new_dir / "thing.py").write_text('"""A new module."""\n')
    engine.reanalyze(["newpkg/thing.py"])
    result = engine.sync_wiki(output_dir=output_dir)

    assert (output_dir / "files" / "newpkg" / "index.md").exists()
    assert (output_dir / "files" / "newpkg" / "thing.md").exists()
    assert "newpkg" in (output_dir / "index.md").read_text()
    assert "newpkg" in result.changed_paths


def test_renaming_a_file_removes_the_old_page_and_creates_a_new_one(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    output_dir = repo / ".codechroma" / "wiki"
    engine.sync_wiki(output_dir=output_dir)
    old_page = output_dir / "files" / "shared" / "text_utils.md"
    new_page = output_dir / "files" / "shared" / "text_utils2.md"

    (repo / "shared" / "text_utils.py").rename(repo / "shared" / "text_utils2.py")
    engine.reanalyze(["shared/text_utils.py", "shared/text_utils2.py"])
    result = engine.sync_wiki(output_dir=output_dir)

    assert not old_page.exists()
    assert new_page.exists()
    assert set(result.changed_paths) == {"shared/text_utils.py", "shared/text_utils2.py"}
