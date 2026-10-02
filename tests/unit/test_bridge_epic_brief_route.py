"""TestClient coverage for POST/GET /repos/{id}/epics/{item_id}/brief -- start, poll, 404, cache."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from codechroma.bridge import epic_brief_agent, skill_agent

FIXTURE_ROOT = Path(__file__).parent.parent / "fixtures" / "requirements_repo"
EPIC_ID = "EP-A-01"


def _with_requirements_fixture(repo: Path) -> None:
    shutil.copytree(FIXTURE_ROOT / "plan", repo / "plan")
    shutil.copytree(FIXTURE_ROOT / "specs", repo / "specs")


def test_starting_a_brief_for_an_unknown_item_id_returns_404(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)

    response = client.post("/repos/main/epics/NOPE/brief")

    assert response.status_code == 404


def test_get_before_any_brief_generated_defaults_to_idle(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)

    response = client.get(f"/repos/main/epics/{EPIC_ID}/brief")

    body = response.json()
    assert body["state"] == "idle"
    assert body["brief"] is None


def test_missing_claude_binary_reports_error(make_bridge, make_repo, monkeypatch):
    repo = make_repo(prepare=_with_requirements_fixture)
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: None)
    client = TestClient(make_bridge(repo).app)

    response = client.post(f"/repos/main/epics/{EPIC_ID}/brief")

    body = response.json()
    assert body["state"] == "error"
    assert "claude" in body["error"]


def test_cached_brief_is_returned_without_re_running_the_skill(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    key = epic_brief_agent.job_key("main", EPIC_ID)
    path = epic_brief_agent.epic_brief_path(repo, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"epic_id": "EP-A-01", "generated_at": "", "scope": []}')
    client = TestClient(make_bridge(repo).app)

    response = client.post(f"/repos/main/epics/{EPIC_ID}/brief")

    body = response.json()
    assert body["state"] == "idle"
    assert body["brief"]["epic_id"] == EPIC_ID


def test_force_true_regenerates_a_cached_brief(
    make_bridge, make_repo, monkeypatch
):
    repo = make_repo(prepare=_with_requirements_fixture)
    key = epic_brief_agent.job_key("main", EPIC_ID)
    path = epic_brief_agent.epic_brief_path(repo, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    # A valid brief is already cached -- the canvas "Regenerate" must bypass it, not echo it back.
    path.write_text('{"epic_id": "EP-A-01", "generated_at": "", "scope": []}')
    client = TestClient(make_bridge(repo).app)
    captured = {}

    async def fake_start(
        self, repo_id, repo_root, on_change, on_output=None, prompt=None, **kwargs
    ):
        captured["prompt"] = prompt
        return {"state": "generating", "error": None}

    monkeypatch.setattr(skill_agent.SkillAgent, "start", fake_start)

    response = client.post(f"/repos/main/epics/{EPIC_ID}/brief?force=true")

    assert response.status_code == 200
    # The skill ran fresh (bundle injected), not the cached brief echoed back.
    assert captured["prompt"] is not None
    assert "tasks_by_stage" in captured["prompt"]


def test_post_is_refused_for_a_read_only_workspace(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    bridge = make_bridge(repo)
    bridge.registry.register("pr-12", repo, read_only=True)
    client = TestClient(bridge.app)

    response = client.post(f"/repos/pr-12/epics/{EPIC_ID}/brief")

    assert response.status_code == 409


def test_cancel_without_a_run_resets_the_brief_job_to_idle(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)

    response = client.post(f"/repos/main/epics/{EPIC_ID}/brief/cancel")

    body = response.json()
    assert body["state"] == "idle"
    assert body["brief"] is None


def test_get_brief_splices_the_real_task_text_in_over_whatever_was_cached(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    key = epic_brief_agent.job_key("main", EPIC_ID)
    path = epic_brief_agent.epic_brief_path(repo, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    scope = [
        {
            "tasks_source": "spec",
            "tasks": [{"id": "T003", "stage": "001-first-story-feature", "text": "mangled ("}],
        }
    ]
    path.write_text(json.dumps({"epic_id": EPIC_ID, "generated_at": "", "scope": scope}))
    client = TestClient(make_bridge(repo).app)

    response = client.get(f"/repos/main/epics/{EPIC_ID}/brief")

    task = response.json()["brief"]["scope"][0]["tasks"][0]
    assert task["text"] == "T003 Implement `resolve_config()` with process-wide caching"


def test_brief_path_route_points_inside_dot_codechroma_epics_briefs(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)

    response = client.get(f"/repos/main/epics/{EPIC_ID}/brief/path")

    body = response.json()
    assert body["brief_path"].endswith(f".codechroma/epics/briefs/{EPIC_ID}.json")


def test_starting_a_brief_injects_the_context_bundle_into_the_agent_prompt(
    make_bridge, make_repo, monkeypatch
):
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)
    captured = {}

    async def fake_start(
        self, repo_id, repo_root, on_change, on_output=None, prompt=None, **kwargs
    ):
        captured["prompt"] = prompt
        return {"state": "generating", "error": None}

    monkeypatch.setattr(skill_agent.SkillAgent, "start", fake_start)

    response = client.post(f"/repos/main/epics/{EPIC_ID}/brief")

    assert response.status_code == 200
    prompt = captured["prompt"]
    assert EPIC_ID in prompt
    assert "tasks_by_stage" in prompt
    assert "has_spec" in prompt
    assert f".codechroma/epics/briefs/{EPIC_ID}.json" in prompt
