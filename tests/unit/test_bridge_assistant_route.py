"""TestClient coverage for the /assistant/settings routes (routes/assistant.py)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from codechroma.bridge.routes.assistant import router


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A minimal app with just the assistant router and an isolated settings file."""
    monkeypatch.setenv("codechroma_ASSISTANT_SETTINGS_FILE", str(tmp_path / "settings.json"))
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_get_returns_defaults(client):
    response = client.get("/assistant/settings")

    assert response.status_code == 200
    body = response.json()
    assert body["cli"] == "claude"
    assert body["api_key_set"] is False
    assert "api_key" not in body


def test_put_saves_and_get_roundtrips(client):
    response = client.put("/assistant/settings", json={
        "cli": "codex",
        "model": "gpt-5",
        "api_key": "sk-secret",
        "instruction": "explain changes",
    })

    assert response.status_code == 200
    assert response.json()["cli"] == "codex"
    assert response.json()["api_key_set"] is True

    masked = client.get("/assistant/settings").json()
    assert masked["cli"] == "codex"
    assert masked["model"] == "gpt-5"
    assert masked["instruction"] == "explain changes"
    assert masked["api_key_set"] is True


def test_get_never_returns_raw_key(client):
    client.put("/assistant/settings", json={"cli": "claude", "api_key": "sk-super-secret"})

    response = client.get("/assistant/settings")

    assert "sk-super-secret" not in response.text


def test_put_rejects_both_key_and_path(client):
    response = client.put(
        "/assistant/settings",
        json={"cli": "claude", "api_key": "sk-x", "api_key_path": "/tmp/creds"},
    )

    assert response.status_code == 400


def test_put_rejects_slash_in_cli(client):
    response = client.put("/assistant/settings", json={"cli": "/usr/bin/claude"})

    assert response.status_code == 400


def test_put_allows_file_path_as_credential(client):
    payload = {"cli": "claude", "api_key_path": "/tmp/creds"}
    response = client.put("/assistant/settings", json=payload)

    assert response.status_code == 200
    assert response.json()["api_key_path"] == "/tmp/creds"
    assert response.json()["api_key_set"] is False


def test_masked_get_roundtrips_through_put(client):
    """A GET payload (masked, with api_key_set) must be re-saveable without error."""
    client.put("/assistant/settings", json={"cli": "codex", "api_key": "sk-x"})
    masked = client.get("/assistant/settings").json()

    response = client.put("/assistant/settings", json=masked)

    assert response.status_code == 200


def test_probe_reports_no_key_when_none_configured(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    response = client.post("/assistant/settings/test")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["auth_source"] == "none"
    assert "no API key" in body["error"]


def test_probe_fails_closed_when_call_errors(client, monkeypatch):
    client.put("/assistant/settings", json={"cli": "claude", "api_key": "sk-x"})

    class _Fail:
        def complete(self, **_: object) -> str:
            raise RuntimeError("401 unauthorized")

    monkeypatch.setattr(
        "codechroma.bridge.routes.assistant.provider_from_env", lambda: _Fail()
    )

    response = client.post("/assistant/settings/test")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "401 unauthorized" in body["error"]


def test_probe_reports_ok_on_success(client, monkeypatch):
    client.put("/assistant/settings", json={"cli": "claude", "api_key": "sk-x"})

    class _Ok:
        def complete(self, **_: object) -> str:
            return "ok"

    monkeypatch.setattr(
        "codechroma.bridge.routes.assistant.provider_from_env", lambda: _Ok()
    )

    response = client.post("/assistant/settings/test")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["auth_source"] == "settings"
