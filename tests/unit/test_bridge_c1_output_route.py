"""TestClient coverage for the C1 progress-feed routes and their live broadcast."""

import asyncio
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.unit.fake_claude import fake_claude_exec

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"

_TOOL_USE = {"type": "tool_use", "name": "Glob", "input": {"pattern": "**/*.py"}}


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


@pytest.fixture
def server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    yield make_bridge(repo)


@pytest.mark.parametrize(
    "path",
    ["/repos/default/c1/output", "/repos/default/impact-changes/output"],
    ids=["diagram", "review"],
)
def test_the_feed_is_empty_before_any_run(server_module, path):
    with TestClient(server_module.app) as client:
        response = client.get(path)

    assert response.status_code == 200
    assert response.json() == {"lines": []}


def test_the_feed_serves_the_lines_a_run_has_rendered_so_far(server_module):
    agent = server_module.services.skill_agents["c1"]
    agent.output["main"] = ["⏺ Read(app.py)", "⏺ Write(.codechroma/c1.json)"]

    with TestClient(server_module.app) as client:
        response = client.get("/repos/main/c1/output")

    assert response.json() == {"lines": ["⏺ Read(app.py)", "⏺ Write(.codechroma/c1.json)"]}


def test_generating_pushes_the_runs_progress_over_the_events_socket(server_module, monkeypatch):
    events = [{"type": "assistant", "message": {"content": [_TOOL_USE]}}]
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(events=events))

    with TestClient(server_module.app) as client:
        with client.websocket_connect("/repos/main/events") as websocket:
            client.post("/repos/main/c1/generate")
            messages = [websocket.receive_json(), websocket.receive_json()]

    assert {"type": "c1-status", "state": "generating", "error": None} in messages
    assert {"type": "c1-output", "lines": ["⏺ Glob(**/*.py)"]} in messages
