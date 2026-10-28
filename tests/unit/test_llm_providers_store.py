"""Unit tests for the provider connections store (src/codechroma/llm/providers_store.py)."""

import pytest

from codechroma.llm.providers_store import (
    create_provider,
    delete_provider,
    draft_from_payload,
    find_provider,
    load_providers,
    update_provider,
    validate,
)


def test_no_providers_when_nothing_saved():
    assert load_providers() == {}


def test_create_then_load_roundtrips():
    created = create_provider({
        "label": "Local Ollama",
        "kind": "api",
        "transport": "openai-compatible",
        "base_url": "http://localhost:11434/v1",
        "is_local": True,
    })

    loaded = load_providers()
    assert loaded[created.id].label == "Local Ollama"
    assert loaded[created.id].base_url == "http://localhost:11434/v1"


def test_create_cli_provider_with_custom_endpoint():
    created = create_provider({
        "label": "Claude via proxy",
        "kind": "cli",
        "adapter": "claude",
        "base_url": "https://proxy.example.com",
        "api_key": "sk-proxy",
    })

    assert created.base_url == "https://proxy.example.com"
    assert created.api_key == "sk-proxy"


def test_draft_from_payload_builds_an_unpersisted_provider():
    draft = draft_from_payload({"label": "Claude CLI", "kind": "cli", "adapter": "claude"})

    assert draft.id == "draft"
    assert draft.adapter == "claude"
    assert load_providers() == {}


_CLI = {"label": "x", "kind": "cli", "adapter": "claude"}
_ANTHROPIC = {"label": "x", "kind": "api", "transport": "anthropic"}
_GEMINI = {"label": "x", "kind": "api", "transport": "gemini"}


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({**_CLI, "base_url": "   "}, "base_url"),
        ({**_CLI, "adapter": "codex", "base_url": "https://p.example.com"}, "claude adapter"),
        ({**_CLI, "api_key": "sk-x", "api_key_path": "/tmp/creds"}, "OR"),
        ({**_ANTHROPIC, "api_key": "sk-x", "api_key_path": "/tmp/creds"}, "OR"),
        ({"label": "x", "kind": "api", "transport": "openai-compatible"}, "base_url"),
        ({**_CLI, "adapter": "not-a-real-cli"}, "adapter must be one of"),
        ({**_CLI, "label": ""}, "label must be"),
        ({"label": "x", "kind": "bogus"}, "kind must be one of"),
    ],
)
def test_validate_rejects_invalid_payloads(payload, expected):
    problems = validate(payload)

    assert problems
    assert any(expected in p for p in problems)


@pytest.mark.parametrize(
    "payload",
    [
        {**_CLI, "base_url": "https://p.example.com", "api_key": "sk-p"},
        {**_ANTHROPIC, "is_local": True},
        {**_GEMINI, "is_local": True},
        {**_GEMINI, "api_key": "g-key"},
    ],
)
def test_validate_accepts_valid_payloads(payload):
    assert validate(payload) == []


def test_masked_output_hides_raw_key():
    created = create_provider({
        "label": "x", "kind": "api", "transport": "anthropic", "api_key": "sk-hunter2",
    })

    masked = created.masked()
    assert masked["api_key_set"] is True
    assert "api_key" not in masked


def test_verify_ssl_defaults_to_true():
    created = create_provider({
        "label": "x", "kind": "api", "transport": "openai-compatible",
        "base_url": "https://x", "is_local": True,
    })

    assert created.verify_ssl is True


def test_verify_ssl_can_be_disabled_for_a_self_signed_endpoint():
    created = create_provider({
        "label": "x", "kind": "api", "transport": "openai-compatible",
        "base_url": "https://x", "is_local": True, "verify_ssl": False,
    })

    assert created.verify_ssl is False
    assert load_providers()[created.id].verify_ssl is False


def test_update_provider_merges_and_persists():
    created = create_provider({"label": "old", "kind": "cli", "adapter": "claude"})

    updated = update_provider(created.id, {"label": "new", "kind": "cli", "adapter": "claude"})

    assert updated.label == "new"
    assert load_providers()[created.id].label == "new"


def test_update_provider_unknown_id_returns_none():
    assert update_provider("nope", {"label": "x"}) is None


def test_update_keeps_stored_key_when_masked_payload_round_trips():
    created = create_provider({
        "label": "x", "kind": "api", "transport": "anthropic", "api_key": "sk-secret",
    })

    masked = created.masked()
    updated = update_provider(created.id, masked)

    assert updated.api_key == "sk-secret"


def test_update_clears_key_on_explicit_null():
    created = create_provider({
        "label": "x", "kind": "api", "transport": "anthropic", "api_key": "sk-secret",
    })

    updated = update_provider(created.id, {
        "label": "x", "kind": "api", "transport": "anthropic", "api_key": None, "is_local": True,
    })

    assert updated.api_key is None


def test_delete_provider_removes_it():
    created = create_provider({"label": "x", "kind": "cli", "adapter": "claude"})

    assert delete_provider(created.id) is True
    assert find_provider(created.id) is None


def test_delete_unknown_provider_returns_false():
    assert delete_provider("nope") is False


def test_create_raises_on_invalid_payload():
    with pytest.raises(ValueError):
        create_provider({"label": "", "kind": "cli"})
