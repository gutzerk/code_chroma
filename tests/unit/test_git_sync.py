"""Unit tests for git_sync.py: detecting on-disk edits via git status and reanalyzing them."""

import subprocess
from pathlib import Path

from codechroma.bridge.git_sync import GitSync


class FakeEngine:
    def __init__(self):
        self.reanalyze_calls: list[list[str]] = []

    def reanalyze(self, changed_files: list[str]) -> None:
        self.reanalyze_calls.append(changed_files)


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


def test_sync_reanalyzes_a_modified_tracked_file(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("def a(): pass\n")
    _init_repo(repo)
    (repo / "a.py").write_text("def a(): return 1\n")
    engine = FakeEngine()
    sync = GitSync(repo)

    sync.sync(engine)

    assert engine.reanalyze_calls == [["a.py"]]


def test_sync_includes_a_new_untracked_file(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("def a(): pass\n")
    _init_repo(repo)
    (repo / "b.py").write_text("def b(): pass\n")
    engine = FakeEngine()
    sync = GitSync(repo)

    sync.sync(engine)

    assert engine.reanalyze_calls == [["b.py"]]


def test_sync_does_not_reanalyze_again_when_nothing_changed_since_last_sync(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("def a(): pass\n")
    _init_repo(repo)
    (repo / "a.py").write_text("def a(): return 1\n")
    engine = FakeEngine()
    sync = GitSync(repo)
    sync.sync(engine)

    sync.sync(engine)

    assert len(engine.reanalyze_calls) == 1


def test_sync_reanalyzes_again_once_the_file_changes_a_second_time(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("def a(): pass\n")
    _init_repo(repo)
    (repo / "a.py").write_text("def a(): return 1\n")
    engine = FakeEngine()
    sync = GitSync(repo)
    sync.sync(engine)

    (repo / "a.py").write_text("def a(): return 2\n")
    sync.sync(engine)

    assert len(engine.reanalyze_calls) == 2


def test_sync_is_a_noop_when_repo_root_is_not_inside_a_git_working_tree(tmp_path):
    engine = FakeEngine()
    sync = GitSync(tmp_path)

    sync.sync(engine)

    assert engine.reanalyze_calls == []


def test_a_failed_git_status_is_logged_instead_of_silently_skipped(tmp_path, monkeypatch, caplog):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("def a(): pass\n")
    _init_repo(repo)
    engine = FakeEngine()
    sync = GitSync(repo)
    monkeypatch.setattr("codechroma.bridge.git_sync.run_git", lambda *_args: None)

    with caplog.at_level("WARNING", logger="codechroma.bridge.git_sync"):
        result = sync.sync(engine)

    assert result is None
    assert any("live update skipped" in record.message for record in caplog.records)


def _commit(root: Path, message: str) -> None:
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", message], cwd=root, check=True, capture_output=True)


def test_head_changed_is_false_right_after_construction(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("def a(): pass\n")
    _init_repo(repo)
    sync = GitSync(repo)

    assert sync.head_changed() is False


def test_head_changed_is_true_once_right_after_a_commit(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("def a(): pass\n")
    _init_repo(repo)
    sync = GitSync(repo)
    (repo / "a.py").write_text("def a(): return 1\n")
    _commit(repo, "second")

    first = sync.head_changed()
    second = sync.head_changed()

    assert (first, second) == (True, False)


def test_head_changed_is_false_for_an_uncommitted_edit(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.py").write_text("def a(): pass\n")
    _init_repo(repo)
    sync = GitSync(repo)
    (repo / "a.py").write_text("def a(): return 1\n")

    assert sync.head_changed() is False


def test_head_changed_is_true_for_the_very_first_commit_on_an_unborn_head(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=repo, check=True)
    sync = GitSync(repo)
    (repo / "a.py").write_text("def a(): pass\n")
    _commit(repo, "initial")

    assert sync.head_changed() is True
