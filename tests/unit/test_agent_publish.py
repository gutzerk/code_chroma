"""Publish preflight and PR creation, with `gh` replaced by a stub script on PATH.

🔴 No test here touches the network or a real GitHub account: `gh` is a shell script this module
writes into a temp dir that is prepended to PATH, and `origin` points at a second local repository.
"""

import os
import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.agents import publish, worktree


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    ).stdout


def _stub_gh(bin_dir: Path, body: str) -> None:
    """A fake `gh` on PATH; `body` is the sh case-body deciding what each subcommand does."""
    bin_dir.mkdir(parents=True, exist_ok=True)
    script = bin_dir / "gh"
    script.write_text(f"#!/bin/sh\n{body}\n")
    script.chmod(0o755)


def _stub_claude(bin_dir: Path, body: str) -> None:
    """A fake `claude` on PATH, shadowing any real CLI already there — tests must never call it."""
    bin_dir.mkdir(parents=True, exist_ok=True)
    script = bin_dir / "claude"
    script.write_text(f"#!/bin/sh\n{body}\n")
    script.chmod(0o755)


def _install_conventional_commit_hook(repo: Path) -> None:
    """Rejects any commit-msg not shaped like `type(scope): summary` — mirrors a real-world hook."""
    hook = repo / ".git" / "hooks" / "commit-msg"
    hook.write_text(
        "#!/bin/sh\n"
        "if ! grep -Eq '^[a-z]+(\\([a-z0-9_-]+\\))?: .+' \"$1\"; then\n"
        "  echo 'commit-msg: header is not Conventional Commits' >&2\n"
        "  exit 1\n"
        "fi\n"
    )
    hook.chmod(0o755)


AUTH_OK_NO_PR = """
case "$1 $2" in
  "auth status") exit 0 ;;
  "repo view") echo '{"nameWithOwner":"acme/app"}'; exit 0 ;;
  "pr view") exit 1 ;;
  "pr create") echo "https://github.com/acme/app/pull/123"; exit 0 ;;
esac
exit 1
"""


@pytest.fixture
def bin_dir(tmp_path, monkeypatch):
    if os.name == "nt":
        pytest.skip("uses POSIX shebang stubs")
    path = tmp_path / "bin"
    path.mkdir()
    monkeypatch.setenv("PATH", f"{path}{os.pathsep}{os.environ['PATH']}")
    from codechroma.llm import runtime_env

    monkeypatch.setattr(runtime_env, "_probe", lambda *_: ({}, None, (), "test-shell"))
    environment = runtime_env.get_runtime_environment()
    environment.inherited = dict(os.environ)
    environment.refresh("test PATH changed", force=True).result()
    return path


@pytest.fixture
def repo(tmp_path, monkeypatch):
    origin = tmp_path / "origin.git"
    _git(tmp_path, "init", "--bare", str(origin))
    root = tmp_path / "repo"
    root.mkdir()
    _git(root, "init", "-b", "main")
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    _git(root, "remote", "add", "origin", "https://github.com/acme/app.git")
    (root / "app.py").write_text("value = 1\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-m", "initial")
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))
    return root


@pytest.fixture
def agent(repo, tmp_path):
    path = worktree.worktree_path(repo, "refund-flow")
    worktree.add(repo, "agent/refund-flow", path)
    _git(path, "config", "user.email", "agent@example.com")
    _git(path, "config", "user.name", "Agent")
    return path


def _commit_work(agent_path: Path) -> None:
    (agent_path / "refund.py").write_text("def refund():\n    return 1\n")
    _git(agent_path, "add", "-A")
    _git(agent_path, "commit", "-m", "agent work")


def test_no_gh_on_path_is_reported_before_the_click(agent, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda _name, **_kwargs: None)

    result = publish.preflight(agent, "agent/refund-flow", "main")

    assert result["ready"] is False
    assert result["reason"] == publish.REASON_GH_MISSING
    assert result["text"] == "GitHub CLI required"


def test_a_failed_auth_status_reads_as_not_authenticated(agent, bin_dir):
    _stub_gh(bin_dir, "exit 1")

    result = publish.preflight(agent, "agent/refund-flow", "main")

    assert result["reason"] == publish.REASON_NOT_AUTHENTICATED
    assert result["text"] == "Log in: gh auth login"


def test_a_gitlab_origin_reads_as_not_github(agent, monkeypatch):
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "gh")
    monkeypatch.setattr(
        publish,
        "run_gh",
        lambda _root, *args: "" if args == ("auth", "status") else None,
    )
    monkeypatch.setattr(
        "codechroma.bridge.prs.github.run_gh", lambda *_args: None
    )
    _git(agent, "remote", "set-url", "origin", "https://gitlab.com/acme/app.git")

    result = publish.preflight(agent, "agent/refund-flow", "main")

    assert result["reason"] == publish.REASON_NOT_GITHUB
    assert "gh repo view" in result["text"]


def test_a_branch_with_no_commits_has_nothing_to_open_a_pr_for(agent, bin_dir):
    _stub_gh(bin_dir, AUTH_OK_NO_PR)

    result = publish.preflight(agent, "agent/refund-flow", "main")

    assert result["reason"] == publish.REASON_NO_COMMITS
    assert result["text"] == "The agent hasn't committed anything yet"


def test_a_ready_branch_reports_its_uncommitted_files_rather_than_hiding_them(agent, bin_dir):
    _stub_gh(bin_dir, AUTH_OK_NO_PR)
    _commit_work(agent)
    (agent / "not-yet-committed.py").write_text("x = 1\n")

    result = publish.preflight(agent, "agent/refund-flow", "main")

    assert result["ready"] is True
    assert result["dirty"] == ["not-yet-committed.py"]


def test_an_existing_pr_is_linked_instead_of_a_second_one_being_offered(agent, bin_dir):
    _stub_gh(
        bin_dir,
        """
case "$1 $2" in
  "auth status") exit 0 ;;
  "repo view") echo '{"nameWithOwner":"acme/app"}'; exit 0 ;;
  "pr view") echo "https://github.com/acme/app/pull/7"; exit 0 ;;
esac
exit 1
""",
    )
    _commit_work(agent)

    result = publish.preflight(agent, "agent/refund-flow", "main")

    assert result["reason"] == publish.REASON_EXISTS
    assert result["pr_url"] == "https://github.com/acme/app/pull/7"


def test_create_pr_pushes_the_branch_and_returns_the_url(agent, repo, bin_dir, tmp_path):
    _stub_gh(bin_dir, AUTH_OK_NO_PR)
    _git(agent, "remote", "set-url", "origin", str(tmp_path / "origin.git"))
    _commit_work(agent)

    url = publish.create_pr(agent, "agent/refund-flow", "main")

    pushed = _git(tmp_path / "origin.git", "branch", "--list", "agent/refund-flow")
    assert url == "https://github.com/acme/app/pull/123"
    assert "agent/refund-flow" in pushed


def test_create_pr_commits_the_dirty_files_when_asked(agent, bin_dir, tmp_path):
    _stub_gh(bin_dir, AUTH_OK_NO_PR)
    _stub_claude(bin_dir, 'echo "chore: commit late file"')
    _git(agent, "remote", "set-url", "origin", str(tmp_path / "origin.git"))
    _commit_work(agent)
    (agent / "late.py").write_text("late = True\n")

    publish.create_pr(agent, "agent/refund-flow", "main", commit_dirty=True)

    assert publish.dirty_files(agent) == []
    assert "late.py" in _git(agent, "show", "--name-only", "--format=", "HEAD")


def test_create_pr_uses_claudes_generated_commit_message(agent, bin_dir, tmp_path):
    _stub_gh(bin_dir, AUTH_OK_NO_PR)
    _stub_claude(bin_dir, 'echo "feat(refund): add late file"')
    _git(agent, "remote", "set-url", "origin", str(tmp_path / "origin.git"))
    _commit_work(agent)
    (agent / "late.py").write_text("late = True\n")

    publish.create_pr(agent, "agent/refund-flow", "main", commit_dirty=True)

    assert _git(agent, "log", "-1", "--format=%s").strip() == "feat(refund): add late file"


def test_create_pr_falls_back_to_a_fixed_message_when_claude_is_missing(
    agent, bin_dir, tmp_path, monkeypatch
):
    _stub_gh(bin_dir, AUTH_OK_NO_PR)
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which",
        lambda name, **_kwargs: None if name == "claude" else "/usr/bin/true",
    )
    _git(agent, "remote", "set-url", "origin", str(tmp_path / "origin.git"))
    _commit_work(agent)
    (agent / "late.py").write_text("late = True\n")

    publish.create_pr(agent, "agent/refund-flow", "main", commit_dirty=True)

    assert _git(agent, "log", "-1", "--format=%s").strip() == publish._FALLBACK_COMMIT_MESSAGE


def test_create_pr_retries_the_message_after_a_commit_msg_hook_rejection(
    agent, repo, bin_dir, tmp_path
):
    _stub_gh(bin_dir, AUTH_OK_NO_PR)
    _stub_claude(
        bin_dir,
        """
        case "$2" in
          *rejected*) echo "fix(refund): satisfy the commit hook" ;;
          *) echo "add the late file" ;;
        esac
        """,
    )
    _git(agent, "remote", "set-url", "origin", str(tmp_path / "origin.git"))
    _commit_work(agent)
    # Installed after the fixtures' own commits, which predate this test's hook-compliance concern.
    _install_conventional_commit_hook(repo)
    (agent / "late.py").write_text("late = True\n")

    publish.create_pr(agent, "agent/refund-flow", "main", commit_dirty=True)

    assert _git(agent, "log", "-1", "--format=%s").strip() == "fix(refund): satisfy the commit hook"


def test_create_pr_leaves_the_dirty_files_out_when_not_asked(agent, bin_dir, tmp_path):
    _stub_gh(bin_dir, AUTH_OK_NO_PR)
    _git(agent, "remote", "set-url", "origin", str(tmp_path / "origin.git"))
    _commit_work(agent)
    (agent / "late.py").write_text("late = True\n")

    publish.create_pr(agent, "agent/refund-flow", "main", commit_dirty=False)

    assert publish.dirty_files(agent) == ["late.py"]
    assert "late.py" not in _git(agent, "show", "--name-only", "--format=", "HEAD")


def test_create_pr_returns_the_existing_url_rather_than_opening_a_second(agent, bin_dir, tmp_path):
    _stub_gh(
        bin_dir,
        """
case "$1 $2" in
  "auth status") exit 0 ;;
  "pr view") echo "https://github.com/acme/app/pull/7"; exit 0 ;;
  "pr create") echo "https://github.com/acme/app/pull/999"; exit 0 ;;
esac
exit 1
""",
    )
    _git(agent, "remote", "set-url", "origin", str(tmp_path / "origin.git"))
    _commit_work(agent)

    url = publish.create_pr(agent, "agent/refund-flow", "main")

    assert url == "https://github.com/acme/app/pull/7"


def test_a_failed_push_surfaces_gits_own_message(agent, bin_dir):
    _stub_gh(bin_dir, AUTH_OK_NO_PR)
    _git(agent, "remote", "set-url", "origin", "https://github.com/acme/does-not-resolve.invalid")
    _commit_work(agent)

    with pytest.raises(publish.PublishError):
        publish.create_pr(agent, "agent/refund-flow", "main")


def test_a_hanging_gh_is_killed_on_timeout_and_leaves_no_orphan(agent, bin_dir, monkeypatch):
    _stub_gh(bin_dir, "sleep 60")
    monkeypatch.setattr(publish, "_gh_timeout", lambda: 1)

    result = publish.preflight(agent, "agent/refund-flow", "main")

    assert result["reason"] == publish.REASON_NOT_AUTHENTICATED
    assert subprocess.run(["pgrep", "-f", "sleep 60"], capture_output=True).returncode != 0
