"""TestClient coverage for the /llm/providers and /llm/call-sites routes (llm_settings.py)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from codechroma.bridge.routes.llm_settings import router
from codechroma.llm.call_sites import CALL_SITES, GROUPS, HIDDEN_GROUPS


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A minimal app with just the llm_settings router and isolated store files."""
    monkeypatch.setenv("codechroma_LLM_PROVIDERS_FILE", str(tmp_path / "providers.json"))
    monkeypatch.setenv("codechroma_LLM_CALL_SITE_SETTINGS_FILE", str(tmp_path / "call-sites.json"))
    monkeypatch.setenv("codechroma_ASSISTANT_SETTINGS_FILE", str(tmp_path / "assistant.json"))
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _make_api_provider(client, is_local=True):
    response = client.post("/llm/providers", json={
        "label": "Local", "kind": "api", "transport": "openai-compatible",
        "base_url": "http://localhost:11434/v1", "is_local": is_local,
    })
    assert response.status_code == 201
    return response.json()


def _make_cli_provider(client):
    response = client.post("/llm/providers", json={
        "label": "Claude CLI", "kind": "cli", "adapter": "claude",
    })
    assert response.status_code == 201
    return response.json()


def test_list_providers_starts_empty(client):
    assert client.get("/llm/providers").json() == []


def test_create_provider_masks_key(client):
    response = client.post("/llm/providers", json={
        "label": "Anthropic", "kind": "api", "transport": "anthropic", "api_key": "sk-secret",
    })

    assert response.status_code == 201
    body = response.json()
    assert body["api_key_set"] is True
    assert "api_key" not in body
    assert "sk-secret" not in response.text


def test_create_provider_validation_failure_is_400(client):
    response = client.post("/llm/providers", json={"label": "", "kind": "cli"})

    assert response.status_code == 400


def test_update_unknown_provider_is_404(client):
    response = client.put(
        "/llm/providers/nope", json={"label": "x", "kind": "cli", "adapter": "claude"}
    )

    assert response.status_code == 404


def test_update_provider_roundtrips(client):
    created = _make_api_provider(client)

    response = client.put(f"/llm/providers/{created['id']}", json={
        "label": "renamed", "kind": "api", "transport": "openai-compatible",
        "base_url": "http://localhost:11434/v1", "is_local": True,
    })

    assert response.status_code == 200
    assert response.json()["label"] == "renamed"


def test_delete_unknown_provider_is_404(client):
    assert client.delete("/llm/providers/nope").status_code == 404


def test_delete_provider_succeeds(client):
    created = _make_api_provider(client)

    response = client.delete(f"/llm/providers/{created['id']}")

    assert response.status_code == 204
    assert client.get("/llm/providers").json() == []


def test_delete_blocked_provider_is_409(client):
    created = _make_api_provider(client)
    client.put("/llm/call-sites/ai_summarizer", json={
        "provider_id": created["id"], "model": "llama3", "mode": "api",
    })

    response = client.delete(f"/llm/providers/{created['id']}")

    assert response.status_code == 409
    assert "ai_summarizer" in response.json()["detail"]["blocking_call_sites"]


def test_delete_blocked_provider_via_group_is_409(client):
    created = _make_cli_provider(client)
    client.put("/llm/call-site-groups/diagrams", json={
        "provider_id": created["id"], "model": "m",
    })

    response = client.delete(f"/llm/providers/{created['id']}")

    assert response.status_code == 409
    blocking = response.json()["detail"]["blocking_call_sites"]
    assert set(GROUPS["diagrams"].members).issubset(set(blocking))


def test_test_unknown_provider_is_404(client):
    assert client.post("/llm/providers/nope/test").status_code == 404


def test_test_cli_provider_reports_found_or_not(client):
    created = _make_cli_provider(client)

    response = client.post(f"/llm/providers/{created['id']}/test")

    assert response.status_code == 200
    assert response.json()["provider_id"] == created["id"]
    assert isinstance(response.json()["ok"], bool)


def test_test_cli_provider_with_base_url_probes_the_endpoint(client, monkeypatch):
    response = client.post("/llm/providers", json={
        "label": "Claude CLI", "kind": "cli", "adapter": "claude",
        "base_url": "https://proxy.example",
    })
    created = response.json()
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda binary, **_kwargs: "/usr/bin/claude"
    )
    monkeypatch.setattr(
        "codechroma.bridge.routes.llm_settings.model_catalog.fetch_models",
        lambda provider: {"supported": True, "models": [], "error": "connection refused"},
    )

    response = client.post(f"/llm/providers/{created['id']}/test")

    body = response.json()
    assert body["ok"] is False
    assert "connection refused" in body["error"]


def test_test_openai_compatible_provider_without_test_model_is_a_clear_failure(client):
    created = _make_api_provider(client)

    response = client.post(f"/llm/providers/{created['id']}/test")

    body = response.json()
    assert body["ok"] is False
    assert "test model" in body["error"]


def test_test_openai_compatible_provider_with_test_model_attempts_the_call(client, monkeypatch):
    created = _make_api_provider(client)
    client.put(f"/llm/providers/{created['id']}", json={**created, "test_model": "llama3"})
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["model"] = json["model"]
        captured["verify"] = verify
        raise ConnectionError("boom")

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    response = client.post(f"/llm/providers/{created['id']}/test")

    assert captured["model"] == "llama3"
    assert captured["verify"] is True
    assert response.json()["ok"] is False
    assert "test model" not in response.json()["error"]


def test_test_gemini_provider_uses_the_gemini_probe_model(client, monkeypatch):
    created = client.post("/llm/providers", json={
        "label": "Gemini", "kind": "api", "transport": "gemini", "api_key": "g-key",
    }).json()
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["url"] = url
        captured["verify"] = verify
        raise ConnectionError("boom")

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    response = client.post(f"/llm/providers/{created['id']}/test")

    # The probe model is embedded in the endpoint path: .../models/<model>:generateContent.
    assert captured["url"].split("/v1beta/models/")[1].split(":")[0] == "gemini-2.5-flash"
    assert captured["verify"] is True
    assert response.json()["ok"] is False


def test_test_provider_forwards_verify_ssl_false_for_a_self_signed_endpoint(client, monkeypatch):
    created = _make_api_provider(client)
    client.put(f"/llm/providers/{created['id']}", json={
        **created, "test_model": "llama3", "verify_ssl": False,
    })
    captured = {}

    def fake_post(url, json, headers, timeout, verify=True):
        captured["verify"] = verify
        raise ConnectionError("boom")

    monkeypatch.setattr("codechroma.context.llm_provider.httpx.post", fake_post)

    client.post(f"/llm/providers/{created['id']}/test")

    assert captured["verify"] is False


def test_get_provider_models_unknown_provider_is_404(client):
    assert client.get("/llm/providers/nope/models").status_code == 404


def test_get_provider_models_delegates_to_model_catalog(client, monkeypatch):
    created = _make_api_provider(client)
    captured = {}

    def fake_fetch_models(provider):
        captured["provider_id"] = provider.id
        return {"supported": True, "models": [{"id": "llama3", "label": None}], "error": None}

    monkeypatch.setattr(
        "codechroma.bridge.routes.llm_settings.model_catalog.fetch_models", fake_fetch_models
    )

    response = client.get(f"/llm/providers/{created['id']}/models")

    assert response.status_code == 200
    assert captured["provider_id"] == created["id"]
    assert response.json() == {
        "supported": True, "models": [{"id": "llama3", "label": None}], "error": None,
    }


def test_test_provider_draft_validation_failure_is_400(client):
    response = client.post("/llm/providers/test", json={"label": "", "kind": "cli"})

    assert response.status_code == 400


def test_test_provider_draft_cli_reports_found_or_not(client):
    response = client.post(
        "/llm/providers/test", json={"label": "Claude CLI", "kind": "cli", "adapter": "claude"}
    )

    assert response.status_code == 200
    assert response.json()["provider_id"] is None
    assert isinstance(response.json()["ok"], bool)


def test_test_provider_draft_does_not_persist_anything(client):
    response = client.post(
        "/llm/providers/test", json={"label": "Claude CLI", "kind": "cli", "adapter": "claude"}
    )

    assert response.status_code == 200
    assert client.get("/llm/providers").json() == []


@pytest.mark.parametrize(
    ("fetch_result", "expect_ok", "expect_fragment"),
    [
        (
            {"supported": True, "models": [], "error": "connection refused"},
            False, "connection refused",
        ),
        ({"supported": True, "models": [{"id": "m", "label": None}], "error": None}, True, None),
    ],
)
def test_test_provider_draft_cli_claude_with_base_url_probes_the_endpoint(
    client, monkeypatch, fetch_result, expect_ok, expect_fragment
):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda binary, **_kwargs: "/usr/bin/claude"
    )
    monkeypatch.setattr(
        "codechroma.bridge.routes.llm_settings.model_catalog.fetch_models",
        lambda provider: fetch_result,
    )
    response = client.post("/llm/providers/test", json={
        "label": "Claude CLI", "kind": "cli", "adapter": "claude", "base_url": "https://proxy.example",
    })

    body = response.json()
    assert body["ok"] is expect_ok
    if expect_fragment:
        assert expect_fragment in body["error"]


def test_test_provider_draft_openai_compatible_without_test_model_is_a_clear_failure(client):
    response = client.post("/llm/providers/test", json={
        "label": "Local", "kind": "api", "transport": "openai-compatible",
        "base_url": "http://localhost:11434/v1", "is_local": True,
    })

    body = response.json()
    assert body["ok"] is False
    assert "test model" in body["error"]


def test_list_call_sites_covers_every_catalog_id_exactly_once(client):
    response = client.get("/llm/call-sites")

    assert response.status_code == 200
    body = response.json()
    simple_ids = [entry["id"] for entry in body["simple"]]
    grouped_ids = [member["id"] for group in body["groups"] for member in group["members"]]
    # The `agents` group is tab-hidden but still owns its call sites, so include its members to
    # reach "every catalog id exactly once".
    hidden_members = [
        CALL_SITES[member].id
        for group in GROUPS.values()
        if group.id in HIDDEN_GROUPS
        for member in group.members
    ]
    all_ids = simple_ids + grouped_ids + hidden_members
    assert sorted(all_ids) == sorted(CALL_SITES)
    assert len(all_ids) == len(set(all_ids)) == len(CALL_SITES)


def test_list_call_sites_groups_exclude_hidden(client):
    response = client.get("/llm/call-sites")

    group_ids = {group["id"] for group in response.json()["groups"]}
    assert group_ids == set(GROUPS) - set(HIDDEN_GROUPS)


def test_unassigned_call_site_shows_null_assignment(client):
    response = client.get("/llm/call-sites")

    entry = next(e for e in response.json()["simple"] if e["id"] == "ai_summarizer")
    assert entry["assignment"] is None


def test_unassigned_group_shows_null_assignment(client):
    response = client.get("/llm/call-sites")

    entry = next(g for g in response.json()["groups"] if g["id"] == "diagrams")
    assert entry["assignment"] is None


def test_unassigned_group_reports_cli_available_when_default_claude_is_on_path(client, monkeypatch):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda binary, **_kwargs: "/usr/bin/claude"
    )

    entry = next(g for g in client.get("/llm/call-sites").json()["groups"] if g["id"] == "diagrams")

    assert entry["cli_available"] is True


def test_unassigned_group_reports_cli_unavailable_when_claude_is_missing(client, monkeypatch):
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda binary, **_kwargs: None)

    entry = next(g for g in client.get("/llm/call-sites").json()["groups"] if g["id"] == "diagrams")

    assert entry["cli_available"] is False


def test_assigned_group_reports_cli_available_from_its_own_provider_adapter(client, monkeypatch):
    created = _make_cli_provider(client)
    client.put("/llm/call-site-groups/diagrams", json={"provider_id": created["id"], "model": "m"})
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which",
        lambda binary, **_kwargs: "/usr/bin/claude" if binary == "claude" else None,
    )

    entry = next(g for g in client.get("/llm/call-sites").json()["groups"] if g["id"] == "diagrams")

    assert entry["cli_available"] is True


def test_put_call_site_unknown_id_is_404(client):
    response = client.put("/llm/call-sites/not_real", json={
        "provider_id": "x", "model": "m", "mode": "api",
    })

    assert response.status_code == 404


def test_put_call_site_assigns_and_joins(client):
    created = _make_api_provider(client)

    response = client.put("/llm/call-sites/ai_summarizer", json={
        "provider_id": created["id"], "model": "llama3", "mode": "api",
    })

    assert response.status_code == 200
    body = response.json()
    assert body["assignment"] == {"provider_id": created["id"], "model": "llama3", "mode": "api"}

    listed = next(
        e for e in client.get("/llm/call-sites").json()["simple"] if e["id"] == "ai_summarizer"
    )
    assert listed["assignment"]["provider_id"] == created["id"]


def test_put_call_site_clears_assignment(client):
    created = _make_api_provider(client)
    client.put("/llm/call-sites/ai_summarizer", json={
        "provider_id": created["id"], "model": "llama3", "mode": "api",
    })

    response = client.put("/llm/call-sites/ai_summarizer", json={})

    assert response.status_code == 200
    assert response.json()["assignment"] is None


def test_put_call_site_rejects_agentic_call_site(client):
    created = _make_cli_provider(client)

    response = client.put("/llm/call-sites/epic_brief_agent", json={
        "provider_id": created["id"], "model": "m", "mode": "cli",
    })

    assert response.status_code == 400


def test_put_call_site_group_unknown_id_is_404(client):
    response = client.put("/llm/call-site-groups/not_real", json={
        "provider_id": "x", "model": "m",
    })

    assert response.status_code == 404


def test_put_call_site_group_assigns_and_joins(client):
    created = _make_cli_provider(client)

    response = client.put("/llm/call-site-groups/diagrams", json={
        "provider_id": created["id"], "model": "claude-opus",
    })

    assert response.status_code == 200
    body = response.json()
    assert body["assignment"] == {"provider_id": created["id"], "model": "claude-opus"}
    assert {member["id"] for member in body["members"]} == set(GROUPS["diagrams"].members)

    listed = next(
        g for g in client.get("/llm/call-sites").json()["groups"] if g["id"] == "diagrams"
    )
    assert listed["assignment"]["provider_id"] == created["id"]


def test_put_call_site_group_assignment_covers_every_member(client):
    created = _make_cli_provider(client)
    client.put("/llm/call-site-groups/diagrams", json={
        "provider_id": created["id"], "model": "claude-opus",
    })

    for member in GROUPS["diagrams"].members:
        entry = next(
            g for g in client.get("/llm/call-sites").json()["groups"] if g["id"] == "diagrams"
        )
        assert any(m["id"] == member for m in entry["members"])
        assert entry["assignment"]["provider_id"] == created["id"]


def test_put_call_site_group_clears_assignment(client):
    created = _make_cli_provider(client)
    client.put("/llm/call-site-groups/diagrams", json={
        "provider_id": created["id"], "model": "claude-opus",
    })

    response = client.put("/llm/call-site-groups/diagrams", json={})

    assert response.status_code == 200
    assert response.json()["assignment"] is None


def test_put_call_site_group_rejects_api_provider(client):
    created = _make_api_provider(client)

    response = client.put("/llm/call-site-groups/planning", json={
        "provider_id": created["id"], "model": "m",
    })

    assert response.status_code == 400


def test_put_call_site_rejects_provider_kind_mode_mismatch(client):
    created = _make_api_provider(client)

    response = client.put("/llm/call-sites/ai_summarizer", json={
        "provider_id": created["id"], "model": "m", "mode": "cli",
    })

    assert response.status_code == 400


def test_put_call_site_unknown_provider_is_400(client):
    response = client.put("/llm/call-sites/ai_summarizer", json={
        "provider_id": "nope", "model": "m", "mode": "api",
    })

    assert response.status_code == 400
