"""TestClient coverage for the C1 progress-feed routes and their live broadcast."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from tests.conftest import copy_sample_repo
from tests.unit.fake_claude import fake_claude_exec

_TOOL_USE = {"type": "tool_use", "name": "Glob", "input": {"pattern": "**/*.py"}}


@pytest.fixture
def server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    copy_sample_repo(repo)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    yield make_bridge(repo)


@pytest.mark.parametrize(
    "path",
    ["/repos/default/system-context/output", "/repos/default/impact-changes/output"],
    ids=["diagram", "review"],
)
def test_the_feed_is_empty_before_any_run(server_module, path):
    with TestClient(server_module.app) as client:
        response = client.get(path)

    assert response.status_code == 200
    assert response.json() == {"lines": []}


def test_the_feed_serves_the_lines_a_run_has_rendered_so_far(server_module):
    agent = server_module.services.skill_agents["system-context"]
    agent.output["main"] = ["⏺ Read(app.py)", "⏺ Write(.codechroma/c1.json)"]

    with TestClient(server_module.app) as client:
        response = client.get("/repos/main/system-context/output")

    assert response.json() == {"lines": ["⏺ Read(app.py)", "⏺ Write(.codechroma/c1.json)"]}


def test_generating_pushes_the_runs_progress_over_the_events_socket(server_module, monkeypatch):
    events = [{"type": "assistant", "message": {"content": [_TOOL_USE]}}]
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(events=events))

    with TestClient(server_module.app) as client:
        with client.websocket_connect("/repos/main/events") as websocket:
            client.post("/repos/main/system-context/generate")
            messages = [websocket.receive_json(), websocket.receive_json()]

    assert {"type": "system-context-status", "state": "generating", "error": None} in messages
    assert {"type": "system-context-output", "lines": ["⏺ Glob(**/*.py)"]} in messages
