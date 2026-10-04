from fastapi.testclient import TestClient

from codechroma.llm.runtime_env import get_runtime_environment


def test_runtime_settings_round_trip_and_redetect(make_bridge, make_repo):
    client = TestClient(make_bridge(make_repo()).app)
    before = client.get("/runtime/environment").json()
    settings = {"shell": None, "timeout_seconds": 5, "cli_paths": {"claude": "/custom/claude"}}
    response = client.put("/runtime/settings", json=settings)
    assert response.status_code == 200
    assert client.get("/runtime/settings").json() == settings
    assert client.get("/runtime/environment").json()["generation"] > before["generation"]
    generation = get_runtime_environment().snapshot().generation
    assert client.post("/runtime/refresh").json()["generation"] == generation + 1
    diagnostic = client.get("/runtime/cli/claude").json()["resolution"]
    assert diagnostic["failure_reason"].startswith("Configured CLI path")
    assert diagnostic["source"] == "explicit executable path"


def test_runtime_settings_rejects_invalid_timeout(make_bridge, make_repo):
    client = TestClient(make_bridge(make_repo()).app)
    assert client.put("/runtime/settings", json={"timeout_seconds": 0}).status_code == 400


def test_environment_diagnostics_never_disclose_secrets(make_bridge, make_repo, monkeypatch):
    monkeypatch.setenv("SERVICE_SECRET", "must-never-be-returned")
    client = TestClient(make_bridge(make_repo()).app)
    response = client.get("/runtime/environment")
    assert "SERVICE_SECRET" in response.json()["variable_names"]
    assert "must-never-be-returned" not in response.text
    assert client.post("/runtime/focus").status_code == 200
