"""TestClient coverage for auto_start_agents: bringing agent PTYs back up on the next boot."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge.agents import worktree

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


def _stub_claude(bin_dir: Path) -> None:
    """A fake `claude` on PATH: prints one line and reads stdin, so the PTY stays open."""
    binary = bin_dir / "claude"
    binary.parent.mkdir(parents=True, exist_ok=True)
    binary.write_text("#!/bin/sh\necho ready\nexec cat\n")
    binary.chmod(0o755)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    _init_repo(root)
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))
    return root


def test_a_stopped_agent_auto_starts_on_the_next_boot(repo, tmp_path, monkeypatch, make_bridge):
    TestClient(make_bridge(repo).app).post("/agents", json={"title": "runner"})
    _stub_claude(tmp_path / "bin")
    monkeypatch.setenv("PATH", f"{tmp_path / 'bin'}:{os.environ['PATH']}")

    restarted = make_bridge(repo)
    with TestClient(restarted.app) as live:
        body = live.get("/agents").json()
        running = restarted.agent_sessions.is_running("runner")

    assert body["agents"][0]["status"] != "stopped"
    assert body["agents"][0]["pid"] is not None
    assert running


def test_a_lost_worktree_is_skipped_without_crashing_boot(repo, tmp_path, monkeypatch, make_bridge):
    created = TestClient(make_bridge(repo).app).post("/agents", json={"title": "lost"}).json()
    shutil.rmtree(created["worktree"])
    _stub_claude(tmp_path / "bin")
    monkeypatch.setenv("PATH", f"{tmp_path / 'bin'}:{os.environ['PATH']}")

    restarted = make_bridge(repo)
    with TestClient(restarted.app) as live:
        body = live.get("/agents").json()
        running = restarted.agent_sessions.is_running("lost")

    assert body["agents"][0]["worktree_lost"] is True
    assert body["agents"][0]["status"] == "stopped"
    assert not running


def test_a_missing_claude_binary_does_not_crash_boot(repo, make_bridge, monkeypatch):
    TestClient(make_bridge(repo).app).post("/agents", json={"title": "runner"})
    monkeypatch.setattr("shutil.which", lambda _name, **_kwargs: None)

    restarted = make_bridge(repo)
    with TestClient(restarted.app) as live:
        body = live.get("/agents").json()

    assert body["agents"][0]["status"] == "stopped"
    assert body["agents"][0]["pid"] is None


def test_a_recorded_session_id_resumes_instead_of_starting_fresh(
    repo, tmp_path, monkeypatch, make_bridge
):
    first = make_bridge(repo)
    TestClient(first.app).post("/agents", json={"title": "runner"})
    first.agent_manager.get("runner").session_id = "abc123"
    first.agent_manager.save()
    _stub_claude(tmp_path / "bin")
    monkeypatch.setenv("PATH", f"{tmp_path / 'bin'}:{os.environ['PATH']}")

    restarted = make_bridge(repo)
    with TestClient(restarted.app):
        argv = restarted.agent_sessions.get("runner").argv

    assert argv[-2:] == ["--resume", "abc123"]


def test_two_agents_sharing_a_worktree_each_auto_start_their_own_pty(
    repo, tmp_path, monkeypatch, make_bridge
):
    test_client = TestClient(make_bridge(repo).app)
    target = test_client.post("/agents", json={"title": "refund flow"}).json()
    test_client.post("/agents", json={"title": "helper", "attach_to": target["id"]})
    _stub_claude(tmp_path / "bin")
    monkeypatch.setenv("PATH", f"{tmp_path / 'bin'}:{os.environ['PATH']}")

    restarted = make_bridge(repo)
    with TestClient(restarted.app):
        target_running = restarted.agent_sessions.is_running("refund-flow")
        helper_running = restarted.agent_sessions.is_running("helper")

    assert target_running
    assert helper_running
