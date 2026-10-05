"""git worktree wrappers against a real temporary repository — no mocks, no fake git."""

import shutil
import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.agents import worktree


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    (root / "app.py").write_text("value = 1\n", encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


def _add_submodule(repo: Path, tmp_path: Path) -> Path:
    """A real submodule, since the gitdir pointer this exercises only exists for a real one."""
    origin = tmp_path / "vendor-origin"
    origin.mkdir()
    _init_repo(origin)
    subprocess.run(["git", "-c", "protocol.file.allow=always", "submodule", "add", str(origin),
                    "vendor"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "add submodule"], cwd=repo, check=True,
                   capture_output=True)
    return origin


@pytest.fixture
def repo(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    root.mkdir()
    _init_repo(root)
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))
    return root


def test_add_creates_a_branch_and_a_populated_directory(repo):
    path = worktree.worktree_path(repo, "refund-flow")

    worktree.add(repo, "agent/refund-flow", path)

    branches = subprocess.run(
        ["git", "branch", "--list", "agent/refund-flow"], cwd=repo, capture_output=True, text=True
    ).stdout
    assert "agent/refund-flow" in branches
    assert (path / "app.py").read_text(encoding="utf-8") == "value = 1\n"


def test_add_surfaces_git_stderr_on_failure(repo):
    path = worktree.worktree_path(repo, "dup")
    worktree.add(repo, "agent/dup", path)

    with pytest.raises(worktree.WorktreeError) as error:
        worktree.add(repo, "agent/dup", worktree.worktree_path(repo, "dup2"))

    assert "agent/dup" in str(error.value)


def test_add_detached_creates_no_branch_at_all(repo):
    path = worktree.worktree_path(repo, "pr-12")
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()

    worktree.add_detached(repo, path, head)

    branches = subprocess.run(
        ["git", "branch", "--list"], cwd=repo, capture_output=True, text=True
    ).stdout
    symbolic = subprocess.run(["git", "symbolic-ref", "-q", "HEAD"], cwd=path, capture_output=True)
    assert "pr-12" not in branches
    assert symbolic.returncode != 0
    assert (path / "app.py").read_text(encoding="utf-8") == "value = 1\n"


def test_add_detached_checks_out_the_commit_it_was_given(repo):
    (repo / "app.py").write_text("value = 2\n", encoding="utf-8")
    subprocess.run(["git", "commit", "-am", "second"], cwd=repo, check=True, capture_output=True)
    first = subprocess.run(
        ["git", "rev-parse", "HEAD~1"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    path = worktree.worktree_path(repo, "pr-13")

    worktree.add_detached(repo, path, first)

    assert (path / "app.py").read_text(encoding="utf-8") == "value = 1\n"


def test_checkout_detached_moves_an_existing_worktree(repo):
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    path = worktree.add_detached(repo, worktree.worktree_path(repo, "pr-14"), head)
    (repo / "app.py").write_text("value = 3\n", encoding="utf-8")
    subprocess.run(["git", "commit", "-am", "third"], cwd=repo, check=True, capture_output=True)
    moved = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()

    worktree.checkout_detached(path, moved)

    assert (path / "app.py").read_text(encoding="utf-8") == "value = 3\n"


def test_checkout_detached_refuses_rather_than_discarding_a_local_edit(repo):
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    path = worktree.add_detached(repo, worktree.worktree_path(repo, "pr-15"), head)
    (repo / "app.py").write_text("value = 4\n", encoding="utf-8")
    subprocess.run(["git", "commit", "-am", "fourth"], cwd=repo, check=True, capture_output=True)
    moved = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    (path / "app.py").write_text("hand-edited\n", encoding="utf-8")

    with pytest.raises(worktree.WorktreeError):
        worktree.checkout_detached(path, moved)

    assert (path / "app.py").read_text(encoding="utf-8") == "hand-edited\n"


def test_remove_deletes_the_directory_but_keeps_the_branch(repo):
    path = worktree.worktree_path(repo, "keeper")
    worktree.add(repo, "agent/keeper", path)

    worktree.remove(repo, path)

    branches = subprocess.run(
        ["git", "branch", "--list", "agent/keeper"], cwd=repo, capture_output=True, text=True
    ).stdout
    assert not path.exists()
    assert "agent/keeper" in branches


def test_remove_refuses_a_dirty_worktree_without_force(repo):
    path = worktree.worktree_path(repo, "dirty")
    worktree.add(repo, "agent/dirty", path)
    (path / "app.py").write_text("value = 2\n", encoding="utf-8")

    with pytest.raises(worktree.WorktreeError):
        worktree.remove(repo, path)

    assert path.exists()


def test_remove_with_force_drops_a_dirty_worktree(repo):
    path = worktree.worktree_path(repo, "dirty")
    worktree.add(repo, "agent/dirty", path)
    (path / "app.py").write_text("value = 2\n", encoding="utf-8")

    worktree.remove(repo, path, force=True)

    assert not path.exists()


def test_delete_branch_removes_the_branch(repo):
    path = worktree.worktree_path(repo, "gone")
    worktree.add(repo, "agent/gone", path)
    worktree.remove(repo, path)

    worktree.delete_branch(repo, "agent/gone")

    branches = subprocess.run(
        ["git", "branch", "--list", "agent/gone"], cwd=repo, capture_output=True, text=True
    ).stdout
    assert branches.strip() == ""


def test_prune_recovers_after_the_directory_is_deleted_by_hand(repo):
    path = worktree.worktree_path(repo, "manual")
    worktree.add(repo, "agent/manual", path)
    shutil.rmtree(path)

    worktree.prune(repo)

    listed = [Path(entry["path"]) for entry in worktree.list_worktrees(repo)]
    assert str(path) not in listed


def test_list_worktrees_reports_path_and_branch(repo):
    path = worktree.worktree_path(repo, "listed")
    worktree.add(repo, "agent/listed", path)

    entries = worktree.list_worktrees(repo)

    matching = [entry for entry in entries if entry["branch"] == "agent/listed"]
    assert len(matching) == 1
    assert Path(matching[0]["path"]).name == "listed"


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("refund flow", "refund-flow"),
        ("Refund Flow!!", "refund-flow"),
        ("возврат средств", "agent1"),
        ("🎉🎉🎉", "agent1"),
        ("...", "agent1"),
        ("   ", "agent1"),
        ("Café Réservations", "cafe-reservations"),
    ],
)
def test_slugify_survives_hostile_titles(title, expected):
    assert worktree.slugify(title) == expected


def test_slugify_caps_length_for_git_refs_and_paths():
    slug = worktree.slugify("a" * 300)

    assert len(slug) == worktree.max_slug_length()


def test_slugify_fallback_index_keeps_ids_distinct():
    assert worktree.slugify("🎉", fallback_index=3) == "agent3"


def test_worktrees_live_under_the_repository_by_default(repo, monkeypatch):
    monkeypatch.delenv(worktree.WORKSPACES_DIR_ENV, raising=False)

    path = worktree.worktree_path(repo, "inside")

    assert path == repo / ".codechroma" / "worktrees" / "inside"


def test_the_env_override_wins_and_keeps_a_per_repo_level(repo, tmp_path):
    path = worktree.worktree_path(repo, "outside")

    assert path == tmp_path / "worktrees" / worktree.slugify(repo.name) / "outside"


def test_add_works_with_a_path_nested_inside_the_repository(repo, monkeypatch):
    monkeypatch.delenv(worktree.WORKSPACES_DIR_ENV, raising=False)
    path = worktree.worktree_path(repo, "nested")

    worktree.add(repo, "agent/nested", path)

    assert (path / "app.py").read_text(encoding="utf-8") == "value = 1\n"


def test_move_relocates_a_worktree_and_git_still_knows_it(repo, tmp_path):
    source = worktree.worktree_path(repo, "mover")
    worktree.add(repo, "agent/mover", source)
    target = repo / ".codechroma" / "worktrees" / "mover"

    worktree.move(repo, source, target)

    listed = [Path(entry["path"]) for entry in worktree.list_worktrees(repo)]
    assert target in listed
    assert not source.exists()


def test_move_carries_uncommitted_work_across(repo):
    source = worktree.worktree_path(repo, "dirty-mover")
    worktree.add(repo, "agent/dirty-mover", source)
    (source / "app.py").write_text("value = 99\n", encoding="utf-8")

    worktree.move(repo, source, repo / ".codechroma" / "worktrees" / "dirty-mover")

    moved = repo / ".codechroma" / "worktrees" / "dirty-mover" / "app.py"
    assert moved.read_text(encoding="utf-8") == "value = 99\n"


def test_move_keeps_a_submodule_usable(repo, tmp_path):
    _add_submodule(repo, tmp_path)
    source = worktree.worktree_path(repo, "sub-mover")
    worktree.add(repo, "agent/sub-mover", source)
    subprocess.run(["git", "-c", "protocol.file.allow=always", "submodule", "update", "--init"],
                   cwd=source, check=True, capture_output=True)

    worktree.move(repo, source, repo / ".codechroma" / "worktrees" / "sub-mover")

    moved = repo / ".codechroma" / "worktrees" / "sub-mover" / "vendor"
    result = subprocess.run(["git", "status", "--porcelain"], cwd=moved, capture_output=True,
                            text=True)
    assert result.returncode == 0, result.stderr


def test_move_leaves_a_healthy_submodule_pointer_alone(repo, tmp_path):
    _add_submodule(repo, tmp_path)
    source = worktree.worktree_path(repo, "healthy")
    worktree.add(repo, "agent/healthy", source)

    worktree.move(repo, source, repo / ".codechroma" / "worktrees" / "healthy")

    pointer = repo / ".codechroma" / "worktrees" / "healthy" / "vendor" / ".git"
    assert not pointer.exists()


def test_legacy_worktrees_root_is_the_old_home_directory_path():
    assert worktree.legacy_worktrees_root() == Path.home() / ".codechroma" / "worktrees"


def test_main_branch_falls_back_to_the_local_default(repo):
    assert worktree.main_branch(repo) in ("main", "master")
