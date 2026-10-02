"""Reading a pull request's identity, with `gh` replaced by a stub script on PATH.

🔴 No test here touches the network or a real GitHub account: `gh` is a shell script this module
writes into a temp dir prepended to PATH, and `origin` is a plain URL on a local repository.
"""

import os
import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.prs import github


def _stub_gh(bin_dir: Path, body: str) -> None:
    """A fake `gh` on PATH; `body` is the sh script standing in for the real binary."""
    bin_dir.mkdir(parents=True, exist_ok=True)
    script = bin_dir / "gh"
    script.write_text(f"#!/bin/sh\n{body}\n")
    script.chmod(0o755)


@pytest.fixture
def bin_dir(tmp_path, monkeypatch):
    path = tmp_path / "bin"
    path.mkdir()
    monkeypatch.setenv("PATH", f"{path}:{os.environ['PATH']}")
    return path


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(
        ["git", "remote", "add", "origin", "https://github.com/acme/app.git"],
        cwd=root, check=True, capture_output=True,
    )
    return root


@pytest.mark.parametrize(
    "raw",
    [
        "https://github.com/acme/app/pull/123",
        "https://github.com/acme/app/pull/123/files",
        "https://github.com/acme/app/pull/123#issuecomment-1",
        "http://github.com/acme/app.git/pull/123",
        "git@github.com:acme/app.git/pull/123",
        "  https://github.com/acme/app/pull/123  ",
    ],
)
def test_every_url_form_yields_the_same_reference(raw):
    reference = github.parse_pr_reference(raw)

    assert (reference.number, reference.owner, reference.repo) == (123, "acme", "app")


@pytest.mark.parametrize("raw", ["123", "#123", " 123 "])
def test_a_bare_number_is_a_reference_with_no_repository(raw):
    reference = github.parse_pr_reference(raw)

    assert reference.number == 123
    assert reference.owner is None


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "not a pr",
        "https://github.com/acme/app/issues/123",
        "https://gitlab.com/acme/app/pull/123",
        "https://github.com/acme/app/pull/abc",
        "12x",
        None,
        42,
    ],
)
def test_anything_that_is_not_a_pull_request_is_rejected(raw):
    assert github.parse_pr_reference(raw) is None


@pytest.mark.parametrize(
    "remote",
    [
        "https://github.com/acme/app.git",
        "https://github.com/acme/app",
        "git@github.com:acme/app.git",
        "ssh://git@github.com/acme/app.git",
    ],
)
def test_origin_slug_reads_every_remote_form(tmp_path, remote):
    root = tmp_path / "repo"
    root.mkdir()
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(
        ["git", "remote", "add", "origin", remote], cwd=root, check=True, capture_output=True
    )

    assert github.origin_slug(root) == ("acme", "app")


def test_a_non_github_remote_has_no_slug(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(
        ["git", "remote", "add", "origin", "https://gitlab.com/acme/app.git"],
        cwd=root, check=True, capture_output=True,
    )

    assert github.origin_slug(root) is None
    assert not github.is_github_remote(root)


def test_a_repository_with_no_origin_has_no_slug(tmp_path):
    root = tmp_path / "bare"
    root.mkdir()
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)

    assert github.origin_slug(root) is None


def test_a_pull_request_of_this_repository_belongs_to_origin(repo):
    reference = github.parse_pr_reference("https://github.com/acme/app/pull/7")

    assert github.belongs_to_origin(reference, repo)


def test_the_owner_comparison_ignores_case(repo):
    reference = github.parse_pr_reference("https://github.com/ACME/App/pull/7")

    assert github.belongs_to_origin(reference, repo)


def test_another_repositorys_pull_request_does_not_belong_to_origin(repo):
    reference = github.parse_pr_reference("https://github.com/other/thing/pull/7")

    assert not github.belongs_to_origin(reference, repo)


def test_a_bare_number_always_belongs_to_the_opened_repository(repo):
    reference = github.parse_pr_reference("7")

    assert github.belongs_to_origin(reference, repo)


def test_metadata_comes_back_parsed(repo, bin_dir):
    _stub_gh(
        bin_dir,
        'echo \'{"number":7,"title":"Add refunds","url":"https://github.com/acme/app/pull/7",'
        '"state":"OPEN","author":{"login":"octocat"},"headRefName":"feature/refunds",'
        '"headRefOid":"abc1234","baseRefName":"main","isCrossRepository":true,'
        '"headRepositoryOwner":{"login":"octocat"},"additions":120,"deletions":12,'
        '"changedFiles":7}\'',
    )

    metadata = github.fetch_metadata(repo, 7)

    assert metadata["headRefOid"] == "abc1234"
    assert metadata["baseRefName"] == "main"
    assert github.author_login(metadata) == "octocat"
    assert github.head_owner(metadata) == "octocat"


def test_a_pull_request_gh_cannot_find_gives_no_metadata(repo, bin_dir):
    _stub_gh(bin_dir, 'echo "no pull requests found" >&2; exit 1')

    assert github.fetch_metadata(repo, 999) is None


def test_unparseable_gh_output_gives_no_metadata(repo, bin_dir):
    _stub_gh(bin_dir, 'echo "not json at all"')

    assert github.fetch_metadata(repo, 7) is None


def test_metadata_without_a_head_commit_is_not_usable(repo, bin_dir):
    _stub_gh(bin_dir, 'echo \'{"number":7,"title":"Add refunds"}\'')

    assert github.fetch_metadata(repo, 7) is None


def test_authentication_is_whatever_gh_auth_status_says(repo, bin_dir):
    _stub_gh(bin_dir, 'case "$1 $2" in "auth status") exit 0 ;; esac; exit 1')

    assert github.is_authenticated(repo)


def test_a_logged_out_gh_is_not_authenticated(repo, bin_dir):
    _stub_gh(bin_dir, "exit 1")

    assert not github.is_authenticated(repo)


def test_gh_missing_from_path_is_detected(monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))

    assert not github.has_gh()


def test_general_comments_come_back_normalized(repo, bin_dir):
    _stub_gh(
        bin_dir,
        'echo \'{"comments":[{"author":{"login":"jane"},"body":"LGTM",'
        '"createdAt":"2026-07-30T10:00:00Z"}]}\'',
    )

    comments = github.fetch_general_comments(repo, 7)

    assert comments == [
        {
            "author": "jane",
            "body": "LGTM",
            "created_at": "2026-07-30T10:00:00Z",
            "path": None,
            "line": None,
        }
    ]


def test_general_comments_are_empty_when_gh_fails(repo, bin_dir):
    _stub_gh(bin_dir, "exit 1")

    assert github.fetch_general_comments(repo, 7) == []


def test_general_comments_are_empty_on_unparseable_output(repo, bin_dir):
    _stub_gh(bin_dir, 'echo "not json"')

    assert github.fetch_general_comments(repo, 7) == []


def test_review_comments_come_back_normalized(repo, bin_dir):
    _stub_gh(
        bin_dir,
        'echo \'[{"user":{"login":"jane"},"body":"Why?","created_at":"2026-07-30T10:00:00Z",'
        '"path":"src/app.py","line":12}]\'',
    )

    comments = github.fetch_review_comments(repo, 7)

    assert comments == [
        {
            "author": "jane",
            "body": "Why?",
            "created_at": "2026-07-30T10:00:00Z",
            "path": "src/app.py",
            "line": 12,
        }
    ]


def test_review_comments_fall_back_to_original_line_when_resolved(repo, bin_dir):
    _stub_gh(
        bin_dir,
        'echo \'[{"user":{"login":"jane"},"body":"Old thread","path":"src/app.py",'
        '"original_line":9}]\'',
    )

    comments = github.fetch_review_comments(repo, 7)

    assert comments[0]["line"] == 9


def test_review_comments_are_empty_without_a_github_origin(tmp_path, bin_dir):
    root = tmp_path / "bare"
    root.mkdir()
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)

    assert github.fetch_review_comments(root, 7) == []
