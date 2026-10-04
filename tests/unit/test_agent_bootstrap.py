"""Repository preflight, the first-commit plan, and the assertion the module exists for: after
git-init, `git worktree add` actually succeeds."""

import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.agents import bootstrap, worktree


def _init_repo(root: Path, commit: bool = True) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    if commit:
        subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "initial", "--allow-empty"],
            cwd=root, check=True, capture_output=True,
        )


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (root / "app.py").write_text("value = 1\n", newline="\n")
    return root


def test_preflight_reports_not_a_repo_with_a_commit_plan(project):
    result = bootstrap.preflight(project)

    assert result["state"] == bootstrap.STATE_NOT_A_REPO
    assert result["plan"]["file_count"] == 1
    assert result["plan"]["total_bytes"] == len("value = 1\n")


def test_preflight_reports_no_commits_on_an_unborn_head(project):
    _init_repo(project, commit=False)

    result = bootstrap.preflight(project)

    assert result["state"] == bootstrap.STATE_NO_COMMITS
    assert "plan" in result


def test_preflight_reports_ready_on_a_normal_repository(project):
    _init_repo(project)

    result = bootstrap.preflight(project)

    assert result["state"] == bootstrap.STATE_READY


def test_preflight_refuses_a_directory_inside_someone_elses_repository(project):
    _init_repo(project)
    nested = project / "sub" / "inner"
    nested.mkdir(parents=True)

    result = bootstrap.preflight(nested)

    assert result["state"] == bootstrap.STATE_NESTED
    assert result["parent_repo"] == str(project.resolve())


def test_preflight_reports_no_git_when_git_is_not_on_path(project, monkeypatch):
    from codechroma.llm.runtime_env import CliLookupError

    def missing_git(*_args):
        raise CliLookupError("git executable not found")

    monkeypatch.setattr("codechroma.bridge.git_cmd.resolve_runtime_cli", missing_git)

    result = bootstrap.preflight(project)

    assert result["state"] == bootstrap.STATE_NO_GIT


def test_commit_plan_respects_an_existing_gitignore(project):
    (project / ".gitignore").write_text("secrets.txt\nlogs/\n")
    (project / "secrets.txt").write_text("token")
    (project / "logs").mkdir()
    (project / "logs" / "run.log").write_text("noise")

    plan = bootstrap.commit_plan(project)

    paths = {entry["path"] for entry in plan["suspicious"]}
    assert plan["file_count"] == 2
    assert "secrets.txt" not in paths


def test_commit_plan_honors_extra_ignores(project):
    (project / "generated").mkdir()
    (project / "generated" / "out.js").write_text("x" * 100)

    plan = bootstrap.commit_plan(project, ["generated/"])

    assert plan["file_count"] == 1


def test_include_un_excludes_a_preticked_path(project):
    (project / ".env").write_text("SECRET=1")

    default = bootstrap.commit_plan(project)
    kept = bootstrap.commit_plan(project, include=[".env"])

    assert default["file_count"] == 1
    assert kept["file_count"] == 2
    assert kept["suspicious"][0]["preticked"] is False


def test_node_modules_is_reported_as_already_ignored_on_a_fresh_project(project):
    (project / "node_modules").mkdir()
    (project / "node_modules" / "left-pad.js").write_text("x")

    plan = bootstrap.commit_plan(project)

    entry = next(e for e in plan["suspicious"] if e["path"] == "node_modules/")
    assert entry["already_ignored"] is True


def test_dotenv_and_node_modules_land_in_the_suspicious_list_preticked(project):
    (project / ".env").write_text("SECRET=1")
    (project / "node_modules").mkdir()
    (project / "node_modules" / "left-pad.js").write_text("x")

    plan = bootstrap.commit_plan(project)

    by_path = {entry["path"]: entry for entry in plan["suspicious"]}
    assert by_path[".env"]["preticked"] is True
    assert by_path["node_modules/"]["preticked"] is True


def test_private_keys_and_large_files_are_flagged(project):
    (project / "server.pem").write_text("-----BEGIN-----")
    (project / "blob.bin").write_bytes(b"0" * (bootstrap.large_file_bytes() + 1))

    plan = bootstrap.commit_plan(project)

    reasons = {entry["path"]: entry["reason"] for entry in plan["suspicious"]}
    assert "private keys" in reasons["server.pem"]
    assert "5 MB" in reasons["blob.bin"]


def test_initialize_creates_a_gitignore_when_none_exists(project):
    bootstrap.initialize(project, ["node_modules/"])

    written = (project / ".gitignore").read_text()
    assert ".codechroma/" in written
    assert "node_modules/" in written


def test_initialize_never_rewrites_an_existing_gitignore(project):
    (project / ".gitignore").write_text("mine.txt\n")

    result = bootstrap.initialize(project, ["node_modules/"])

    assert (project / ".gitignore").read_text() == "mine.txt\n"
    assert result["created_gitignore"] is False


def test_initialize_is_a_no_op_on_a_ready_repository(project):
    _init_repo(project)

    result = bootstrap.initialize(project)

    assert result == {"state": "ready", "created_repo": False, "created_gitignore": False}


def test_initialize_refuses_when_everything_would_be_ignored(tmp_path):
    root = tmp_path / "ignored-only"
    root.mkdir()
    (root / ".gitignore").write_text("*\n")
    (root / "app.py").write_text("value = 1\n")

    with pytest.raises(bootstrap.BootstrapError, match="nothing to commit"):
        bootstrap.initialize(root)


def test_git_worktree_add_succeeds_after_git_init(project, tmp_path, monkeypatch):
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))
    bootstrap.initialize(project, ["node_modules/"])

    path = worktree.add(project, "agent/first", worktree.worktree_path(project, "first"))

    assert (path / "app.py").read_text() == "value = 1\n"


def test_initialize_completes_an_unborn_head_repository(project, tmp_path, monkeypatch):
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))
    _init_repo(project, commit=False)

    result = bootstrap.initialize(project)

    assert result["created_repo"] is False
    assert result["commit"]
