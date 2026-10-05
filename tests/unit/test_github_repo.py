"""Opening a GitHub project: reference parsing, and clone/refresh against a local bare repo.

🔴 No test here touches the network: `clone_url` is patched to a bare repository in a temp dir.
"""

import subprocess
from pathlib import Path

import pytest

from codechroma.bridge import github_repo
from codechroma.bridge.github_repo import GithubRef, GithubRepoError


@pytest.mark.parametrize(
    "raw",
    [
        "https://github.com/acme/app",
        "https://github.com/acme/app.git",
        "https://www.github.com/acme/app/",
        "git@github.com:acme/app.git",
        "github.com/acme/app",
        "acme/app",
    ],
)
def test_every_form_yields_the_same_reference(raw):
    assert github_repo.parse_github_ref(raw) == GithubRef("acme", "app")


@pytest.mark.parametrize(
    ("raw", "ref"),
    [("acme/app@v1", "v1"), ("https://github.com/acme/app/tree/feature/x", "feature/x")],
)
def test_a_ref_can_ride_along_in_the_text(raw, ref):
    assert github_repo.parse_github_ref(raw) == GithubRef("acme", "app", ref)


def test_an_explicit_ref_beats_the_inline_one():
    assert github_repo.parse_github_ref("acme/app@v1", "main").ref == "main"


@pytest.mark.parametrize("raw", ["", None, "acme", "../app", "acme/..", "https://gitlab.com/a/b"])
def test_garbage_is_refused_with_a_hint(raw):
    with pytest.raises(GithubRepoError, match="owner/repo"):
        github_repo.parse_github_ref(raw)


def test_a_ref_that_looks_like_an_option_is_refused():
    with pytest.raises(GithubRepoError, match="not a valid"):
        github_repo.parse_github_ref("acme/app", "--upload-pack=x")


def _git(cwd: Path, *args: str) -> str:
    env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
           "GIT_COMMITTER_EMAIL": "t@t", "PATH": "/usr/bin:/bin:/usr/local/bin"}
    return subprocess.run(
        ["git", *args], cwd=cwd, env=env, check=True, capture_output=True, text=True
    ).stdout.strip()


@pytest.fixture
def remote(tmp_path, monkeypatch):
    work = tmp_path / "work"
    work.mkdir()
    _git(work, "init", "-q", "-b", "main")
    (work / "a.py").write_text("x = 1\n", encoding="utf-8")
    _git(work, "add", ".")
    _git(work, "commit", "-qm", "one")
    _git(work, "tag", "v1")
    bare = tmp_path / "remote.git"
    _git(tmp_path, "clone", "-q", "--bare", str(work), str(bare))
    _git(work, "remote", "add", "origin", str(bare))
    monkeypatch.setattr(github_repo, "clone_url", lambda _reference: str(bare))
    monkeypatch.setenv(github_repo.CACHE_ENV_VAR, str(tmp_path / "cache"))
    return work


def test_clones_into_the_managed_cache(remote, tmp_path):
    path = github_repo.open_github_repo(GithubRef("acme", "app"))

    assert path == (tmp_path / "cache" / "acme" / "app").resolve()
    assert (path / "a.py").read_text(encoding="utf-8") == "x = 1\n"


def test_reopening_fetches_new_commits(remote):
    github_repo.open_github_repo(GithubRef("acme", "app"))
    (remote / "b.py").write_text("y = 2\n", encoding="utf-8")
    _git(remote, "add", ".")
    _git(remote, "commit", "-qm", "two")
    _git(remote, "push", "-q", "origin", "main")

    path = github_repo.open_github_repo(GithubRef("acme", "app"))

    assert (path / "b.py").exists()


def test_a_tag_can_be_checked_out_and_the_default_restored(remote):
    (remote / "b.py").write_text("y = 2\n", encoding="utf-8")
    _git(remote, "add", ".")
    _git(remote, "commit", "-qm", "two")
    _git(remote, "push", "-q", "origin", "main")

    tagged = github_repo.open_github_repo(GithubRef("acme", "app", "v1"))
    tag_has_b = (tagged / "b.py").exists()
    latest = github_repo.open_github_repo(GithubRef("acme", "app"))

    assert not tag_has_b
    assert (latest / "b.py").exists()


def test_an_unknown_ref_is_a_clear_error(remote):
    with pytest.raises(GithubRepoError, match="no branch, tag or commit named 'nope'"):
        github_repo.open_github_repo(GithubRef("acme", "app", "nope"))


def test_a_custom_clone_dir_is_used(remote, tmp_path):
    target = tmp_path / "mine"

    path = github_repo.open_github_repo(GithubRef("acme", "app"), target)

    assert path == target.resolve()


def test_a_non_git_directory_is_never_overwritten(remote, tmp_path):
    target = tmp_path / "busy"
    target.mkdir()
    (target / "keep.txt").write_text("hi", encoding="utf-8")

    with pytest.raises(GithubRepoError, match="not a git checkout"):
        github_repo.open_github_repo(GithubRef("acme", "app"), target)


def test_a_missing_repository_says_not_found(tmp_path, monkeypatch):
    monkeypatch.setattr(github_repo, "clone_url", lambda _reference: str(tmp_path / "nope.git"))

    with pytest.raises(GithubRepoError, match="not found"):
        github_repo.open_github_repo(GithubRef("acme", "app"), tmp_path / "dest")
