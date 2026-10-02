"""Fetching a pull request into a detached worktree, against two real local repositories.

🔴 No network: `origin` is a bare repository on disk carrying a real `refs/pull/<n>/head`, exactly
as GitHub serves one, so the fetch refspec is exercised for real rather than mocked.
"""

import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.agents import worktree
from codechroma.bridge.prs import importer


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    ).stdout


def _init(root: Path) -> None:
    _git(root, "init", "-b", "main")
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")


@pytest.fixture
def origin(tmp_path):
    """A bare 'GitHub': main plus a real refs/pull/7/head one commit ahead of it."""
    seed = tmp_path / "seed"
    seed.mkdir()
    _init(seed)
    (seed / "app.py").write_text("value = 1\n")
    _git(seed, "add", "-A")
    _git(seed, "commit", "-m", "initial")
    _git(seed, "checkout", "-b", "feature/refunds")
    (seed / "refund.py").write_text("def issue_refund():\n    return 1\n")
    _git(seed, "add", "-A")
    _git(seed, "commit", "-m", "add refunds")
    bare = tmp_path / "origin.git"
    _git(tmp_path, "init", "--bare", str(bare))
    _git(seed, "remote", "add", "origin", str(bare))
    _git(seed, "push", "origin", "main")
    _git(seed, "push", "origin", "feature/refunds:refs/pull/7/head")
    return bare, seed


@pytest.fixture
def repo(tmp_path, origin, monkeypatch):
    """A clone of that origin — the repository the user has open in the canvas."""
    bare, _seed = origin
    root = tmp_path / "repo"
    _git(tmp_path, "clone", str(bare), str(root))
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    monkeypatch.delenv(worktree.WORKSPACES_DIR_ENV, raising=False)
    return root


def test_both_refs_land_under_our_own_namespace(repo):
    importer.fetch_refs(repo, 7, "main")

    refs = _git(repo, "for-each-ref", "--format=%(refname)", "refs/codechroma")
    assert "refs/codechroma/pr/7/head" in refs
    assert "refs/codechroma/pr/7/base" in refs


def test_the_users_remote_tracking_refs_are_untouched(repo):
    before = _git(repo, "for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes")

    importer.fetch_refs(repo, 7, "main")

    assert _git(repo, "for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes") == before


def test_the_fetch_creates_no_local_branch(repo):
    importer.fetch_refs(repo, 7, "main")

    assert _git(repo, "branch", "--list").strip() == "* main"


def test_import_checks_the_head_out_detached(repo):
    path, sha = importer.import_pr(repo, 7, "main")

    assert (path / "refund.py").exists()
    assert _git(path, "rev-parse", "HEAD").strip() == sha
    assert subprocess.run(["git", "symbolic-ref", "-q", "HEAD"], cwd=path).returncode != 0


def test_the_worktree_is_clean_because_codechroma_is_excluded_first(repo):
    path, _sha = importer.import_pr(repo, 7, "main")

    exclude = Path(_git(repo, "rev-parse", "--git-path", "info/exclude").strip())
    assert ".codechroma/" in (repo / exclude).read_text()
    assert _git(path, "status", "--porcelain") == ""


def test_the_base_ref_makes_the_merge_base_resolvable(repo):
    importer.import_pr(repo, 7, "main")

    merge_base = _git(repo, "merge-base", importer.local_base_ref(7), importer.local_head_ref(7))
    assert merge_base.strip() == _git(repo, "rev-parse", "origin/main").strip()


def test_skills_are_installed_into_a_pull_request_worktree(repo):
    path, _sha = importer.import_pr(repo, 7, "main")

    # A read-only PR still runs diagram-review skills whose artifacts land in the worktree
    # itself, so the agent needs a local copy — sync_all_skills copies every skill in.
    assert (path / ".claude" / "skills" / "codechroma-review-diagram" / "SKILL.md").exists()


def test_skills_are_reinstalled_when_a_worktree_is_recreated(repo):
    import shutil

    path, _sha = importer.import_pr(repo, 7, "main")
    shutil.rmtree(path)
    skills = path / ".claude" / "skills"

    importer.refresh_pr(repo, 7, path, "main", _sha)

    assert (path / "refund.py").exists()
    assert (skills / "codechroma-review-diagram" / "SKILL.md").exists()


def test_refresh_reports_no_change_when_the_head_has_not_moved(repo):
    path, sha = importer.import_pr(repo, 7, "main")

    refreshed, moved = importer.refresh_pr(repo, 7, path, "main", sha)

    assert refreshed == sha
    assert not moved


def test_refresh_follows_a_new_commit_on_the_pull_request(repo, origin):
    _bare, seed = origin
    path, sha = importer.import_pr(repo, 7, "main")
    (seed / "refund.py").write_text("def issue_refund():\n    return 2\n")
    _git(seed, "commit", "-am", "tweak the refund")
    _git(seed, "push", "--force", "origin", "feature/refunds:refs/pull/7/head")

    refreshed, moved = importer.refresh_pr(repo, 7, path, "main", sha)

    assert moved
    assert refreshed != sha
    assert (path / "refund.py").read_text() == "def issue_refund():\n    return 2\n"


def test_refresh_recreates_a_worktree_deleted_by_hand(repo):
    import shutil

    path, sha = importer.import_pr(repo, 7, "main")
    shutil.rmtree(path)

    refreshed, moved = importer.refresh_pr(repo, 7, path, "main", sha)

    assert moved
    assert (path / "refund.py").exists()
    assert refreshed == sha


def test_remove_drops_the_worktree_and_both_refs(repo):
    path, _sha = importer.import_pr(repo, 7, "main")

    importer.remove_pr(repo, 7, path)

    assert not path.exists()
    assert _git(repo, "for-each-ref", "--format=%(refname)", "refs/codechroma").strip() == ""


def test_remove_survives_a_worktree_that_is_already_gone(repo):
    import shutil

    path, _sha = importer.import_pr(repo, 7, "main")
    shutil.rmtree(path)

    importer.remove_pr(repo, 7, path)

    assert _git(repo, "for-each-ref", "--format=%(refname)", "refs/codechroma").strip() == ""


def test_the_worktree_lives_beside_the_agents(repo):
    assert importer.worktree_path(repo, 7) == repo / ".codechroma" / "worktrees" / "pr-7"


def test_a_pull_request_the_origin_does_not_have_fails_loudly(repo):
    with pytest.raises(Exception) as caught:
        importer.import_pr(repo, 999, "main")

    assert "999" in str(caught.value) or "couldn't find" in str(caught.value).lower()
