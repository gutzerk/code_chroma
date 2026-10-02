"""Unit tests for git_diff.py: matching current FUNCTION nodes against their git-HEAD source."""

import shutil
import subprocess
from pathlib import Path

from codechroma.bridge.git_diff import compute_function_diffs
from codechroma.engine import GraphEngine
from codechroma.graph.store import SqliteGraphStore

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


def _engine_for(repo: Path, tmp_path: Path) -> GraphEngine:
    store = SqliteGraphStore(str(tmp_path / "graph.db"))
    engine = GraphEngine(store=store)
    engine.analyze(str(repo))
    return engine


def test_reports_a_modified_function_with_its_before_and_after(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    slugify_path = repo / "shared" / "text_utils.py"
    slugify_path.write_text(
        slugify_path.read_text().replace(
            'return text.strip().lower().replace(" ", "-")', 'return "patched"'
        )
    )
    engine = _engine_for(repo, tmp_path)

    diffs = compute_function_diffs(engine, repo)

    matching = [d for d in diffs if d["node_id"].endswith("::function::slugify")]
    assert len(matching) == 1
    assert "patched" in matching[0]["proposed_source"]
    assert "patched" not in matching[0]["original_source"]


def test_excludes_unmodified_functions_in_a_changed_file(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    service_path = repo / "users" / "service.py"
    service_path.write_text(service_path.read_text() + "\n# trailing comment\n")
    engine = _engine_for(repo, tmp_path)

    diffs = compute_function_diffs(engine, repo)

    assert not any(d["node_id"].endswith("::function::create_user") for d in diffs)


def test_reports_a_function_in_a_brand_new_untracked_file_with_empty_original(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    (repo / "shared" / "new_module.py").write_text("def brand_new():\n    return 1\n")
    engine = _engine_for(repo, tmp_path)

    diffs = compute_function_diffs(engine, repo)

    matching = [d for d in diffs if d["node_id"].endswith("::function::brand_new")]
    assert len(matching) == 1
    assert matching[0]["original_source"] == ""


def test_reports_a_deleted_function_removed_from_an_existing_file(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    slugify_path = repo / "shared" / "text_utils.py"
    slugify_path.write_text('"""Small text helpers shared across services."""\n')
    engine = _engine_for(repo, tmp_path)

    diffs = compute_function_diffs(engine, repo)

    matching = [d for d in diffs if d["node_id"].endswith("::function::slugify")]
    assert len(matching) == 1
    assert matching[0]["status"] == "deleted"
    assert matching[0]["proposed_source"] == ""
    assert "slugify" in matching[0]["original_source"]


def test_reports_deleted_functions_for_a_deleted_file(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    (repo / "web" / "widget.ts").unlink()
    engine = _engine_for(repo, tmp_path)

    diffs = compute_function_diffs(engine, repo)

    matching = [d for d in diffs if d["node_id"].endswith("::function::renderUserSlug")]
    assert len(matching) == 1
    assert matching[0]["status"] == "deleted"
    assert matching[0]["proposed_source"] == ""


def test_tags_added_and_modified_status_on_each_entry(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    slugify_path = repo / "shared" / "text_utils.py"
    slugify_path.write_text(
        slugify_path.read_text().replace(
            'return text.strip().lower().replace(" ", "-")', 'return "patched"'
        )
    )
    (repo / "shared" / "new_module.py").write_text("def brand_new():\n    return 1\n")
    engine = _engine_for(repo, tmp_path)

    diffs = compute_function_diffs(engine, repo)

    by_name = {d["name"]: d["status"] for d in diffs}
    assert by_name["slugify"] == "modified"
    assert by_name["brand_new"] == "added"


def test_returns_nothing_for_files_with_no_git_changes(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    engine = _engine_for(repo, tmp_path)

    diffs = compute_function_diffs(engine, repo)

    assert diffs == []


def test_returns_empty_list_outside_a_git_working_tree(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    engine = _engine_for(repo, tmp_path)

    diffs = compute_function_diffs(engine, repo)

    assert diffs == []
