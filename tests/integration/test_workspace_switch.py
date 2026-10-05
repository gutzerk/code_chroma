"""Two agent worktrees with different files return different graphs, and main stays untouched."""

import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.agents import worktree
from codechroma.bridge.workspaces import MAIN_ID, STATE_READY, WorkspaceRegistry


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    ).stdout


def _commit(root: Path, message: str) -> None:
    _git(root, "add", "-A")
    _git(root, "commit", "-m", message)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    root.mkdir()
    _git(root, "init", "-b", "main")
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    (root / "shared.py").write_text("def shared():\n    return 1\n", encoding="utf-8")
    _commit(root, "initial")
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))
    return root


def _add_agent(repo: Path, name: str, filename: str, body: str) -> Path:
    path = worktree.worktree_path(repo, name)
    worktree.add(repo, f"agent/{name}", path)
    _git(path, "config", "user.email", "agent@example.com")
    _git(path, "config", "user.name", "Agent")
    (path / filename).write_text(body, encoding="utf-8")
    _commit(path, f"{name} work")
    return path


@pytest.fixture
def registry(repo):
    events: list[dict] = []
    return WorkspaceRegistry(repo, lambda message, key=None: events.append(message)), events


def test_each_worktree_returns_its_own_graph(repo, registry):
    workspaces, _events = registry
    alpha = _add_agent(repo, "alpha", "alpha.py", "def only_in_alpha():\n    return 1\n")
    beta = _add_agent(repo, "beta", "beta.py", "def only_in_beta():\n    return 2\n")
    workspaces.register("alpha", alpha)
    workspaces.register("beta", beta)

    alpha_engine = workspaces.get("alpha").engine
    beta_engine = workspaces.get("beta").engine

    assert alpha_engine.get_node("alpha.py::function::only_in_alpha") is not None
    assert alpha_engine.get_node("beta.py::function::only_in_beta") is None
    assert beta_engine.get_node("beta.py::function::only_in_beta") is not None


def test_switching_leaves_the_main_workspace_untouched(repo, registry):
    workspaces, _events = registry
    alpha = _add_agent(repo, "alpha", "alpha.py", "def only_in_alpha():\n    return 1\n")
    workspaces.register("alpha", alpha)

    workspaces.get("alpha")

    main = workspaces.get(MAIN_ID)
    assert main.engine.get_node("shared.py::function::shared") is not None
    assert main.engine.get_node("alpha.py::function::only_in_alpha") is None


def test_an_agent_workspace_keeps_the_files_it_inherited_from_main(repo, registry):
    workspaces, _events = registry
    alpha = _add_agent(repo, "alpha", "alpha.py", "def only_in_alpha():\n    return 1\n")
    workspaces.register("alpha", alpha)

    engine = workspaces.get("alpha").engine

    assert engine.get_node("shared.py::function::shared") is not None


def test_the_fast_path_reanalyzes_instead_of_reparsing_the_whole_repo(repo, registry, monkeypatch):
    workspaces, _events = registry
    alpha = _add_agent(repo, "alpha", "alpha.py", "def only_in_alpha():\n    return 1\n")
    workspaces.register("alpha", alpha)
    calls: list[str] = []
    monkeypatch.setattr(
        "codechroma.engine.GraphEngine.analyze",
        lambda self, path: calls.append("analyze"),
    )
    real_reanalyze = type(workspaces.main.engine).reanalyze
    monkeypatch.setattr(
        "codechroma.engine.GraphEngine.reanalyze",
        lambda self, files: (calls.append("reanalyze"), real_reanalyze(self, files))[1],
    )

    workspaces.get("alpha")

    assert calls == ["reanalyze"]


def test_a_registered_workspace_is_not_built_until_it_is_asked_for(repo, registry):
    workspaces, _events = registry
    alpha = _add_agent(repo, "alpha", "alpha.py", "def only_in_alpha():\n    return 1\n")

    workspaces.register("alpha", alpha)

    assert not workspaces.is_live("alpha")
    assert len(workspaces) == 1


def test_bringing_a_workspace_up_reports_ready_with_no_error(repo, registry):
    workspaces, _events = registry
    alpha = _add_agent(repo, "alpha", "alpha.py", "def only_in_alpha():\n    return 1\n")
    workspaces.register("alpha", alpha)

    workspaces.get("alpha")

    assert workspaces.state("alpha") == {"state": STATE_READY, "progress": "", "error": None}


def test_an_idle_workspace_is_unloaded_but_its_database_stays(repo, registry):
    workspaces, _events = registry
    alpha = _add_agent(repo, "alpha", "alpha.py", "def only_in_alpha():\n    return 1\n")
    workspaces.register("alpha", alpha)
    workspaces.get("alpha")

    dropped = workspaces.unload_idle(max_idle_seconds=0)

    assert dropped == ["alpha"]
    assert not workspaces.is_live("alpha")
    assert (alpha / ".codechroma" / "graph.db").exists()


def test_main_is_never_unloaded(repo, registry):
    workspaces, _events = registry

    dropped = workspaces.unload_idle(max_idle_seconds=0)

    assert dropped == []
    assert workspaces.is_live(MAIN_ID)


def test_an_agent_workspaces_diff_base_is_its_divergence_point(repo, registry):
    workspaces, _events = registry
    alpha = _add_agent(repo, "alpha", "alpha.py", "def only_in_alpha():\n    return 1\n")
    workspaces.register("alpha", alpha)

    base = workspaces.get("alpha").diff_base()

    assert base == _git(repo, "rev-parse", "main").strip()
    assert workspaces.main.diff_base() == "HEAD"


def test_an_agents_live_pings_name_its_workspace(repo, registry):
    workspaces, events = registry
    alpha = _add_agent(repo, "alpha", "alpha.py", "def only_in_alpha():\n    return 1\n")
    workspaces.register("alpha", alpha)

    workspaces.get("alpha").emit({"type": "changed", "paths": ["alpha.py"]})

    assert events[-1] == {"type": "changed", "paths": ["alpha.py"], "workspace": "alpha"}
