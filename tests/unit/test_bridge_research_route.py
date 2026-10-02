"""TestClient coverage for /repos/{id}/research{,-search} -- degrade, cache, read-only guard."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge import skill_agent

pytestmark = pytest.mark.usefixtures("bridge")


@pytest.fixture(autouse=True)
def _no_voyage_key(monkeypatch):
    monkeypatch.setenv("VOYAGE_API_KEY", "")


def test_degraded_answer_returns_immediately_with_no_subprocess(bridge, monkeypatch):
    def _fail_if_spawned(*_args, **_kwargs):
        raise AssertionError("degraded mode must never spawn claude")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fail_if_spawned)

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/research", params={"q": "billing invoice"})

    body = response.json()
    assert body["state"] == "done"
    assert body["answer"]["degraded"] is True
    assert body["answer"]["citations"]


def test_no_matches_reports_no_relevant_match_rather_than_an_error(bridge):
    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/research", params={"q": "zzz nonexistent qqq"})

    body = response.json()
    assert body["state"] == "done"
    assert body["answer"]["citations"] == []
    assert "no relevant match" in body["answer"]["answer"].lower()


def test_repeated_identical_question_returns_the_cached_answer(bridge):
    with TestClient(bridge.app) as client:
        first = client.post("/repos/default/research", params={"q": "billing invoice"}).json()
        second = client.post("/repos/default/research", params={"q": "billing invoice"}).json()

    assert first["job_key"] == second["job_key"]
    assert first["answer"] == second["answer"]


def test_get_before_any_question_asked_defaults_to_idle(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/research/main:never-asked")

    assert response.json()["state"] == "idle"
    assert response.json()["answer"] is None


def test_post_is_refused_for_a_read_only_workspace(bridge):
    bridge.registry.register("pr-12", bridge.repo, read_only=True)

    with TestClient(bridge.app) as client:
        response = client.post("/repos/pr-12/research", params={"q": "billing invoice"})

    assert response.status_code == 409


def test_get_is_allowed_for_a_read_only_workspace(bridge):
    bridge.registry.register("pr-12", bridge.repo, read_only=True)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/pr-12/research/pr-12:whatever")

    assert response.status_code == 200


def test_search_returns_raw_hits_with_no_subprocess(bridge, monkeypatch):
    def _fail_if_spawned(*_args, **_kwargs):
        raise AssertionError("research-search must never spawn claude")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fail_if_spawned)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/research-search", params={"q": "billing invoice"})

    body = response.json()
    assert response.status_code == 200
    assert body["semantic"] is False
    assert "answer" not in body
    assert "job_key" not in body
    for hit in body["hits"]:
        assert {"node_id", "score", "summary_text", "path", "symbol"} <= hit.keys()


def test_search_is_allowed_for_a_read_only_workspace(bridge):
    bridge.registry.register("pr-12", bridge.repo, read_only=True)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/pr-12/research-search", params={"q": "billing invoice"})

    assert response.status_code == 200


def test_missing_claude_binary_reports_error_when_a_provider_is_configured(bridge, monkeypatch):
    monkeypatch.setenv("VOYAGE_API_KEY", "test-key")
    index_path = bridge.repo / ".codechroma" / "research-index.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(
        '{"fingerprint": "x", "entries": [{"node_id": "unused", "embedding": [1.0]}]}'
    )
    monkeypatch.setattr(
        "codechroma.research.search.embeddings_provider_from_env", lambda: object()
    )
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: None)
    monkeypatch.setattr(
        "codechroma.bridge.routes.research.find_hits",
        lambda *_args, **_kwargs: ([], True),
    )

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/research", params={"q": "billing invoice"})

    assert response.json()["state"] == "error"
