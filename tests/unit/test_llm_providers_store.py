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


@pytest.fixture(autouse=True)
def _isolated_store(tmp_path, monkeypatch):
    monkeypatch.setenv("codechroma_LLM_PROVIDERS_FILE", str(tmp_path / "providers.json"))


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


def test_create_cli_provider():
    created = create_provider({"label": "Claude CLI", "kind": "cli", "adapter": "claude"})

    assert created.kind == "cli"
    assert created.adapter == "claude"


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


def test_validate_accepts_cli_provider_with_base_url_and_key():
    problems = validate({
        "label": "Claude via proxy",
        "kind": "cli",
        "adapter": "claude",
        "base_url": "https://proxy.example.com",
        "api_key": "sk-proxy",
    })

    assert problems == []


def test_validate_rejects_cli_provider_with_blank_base_url():
    problems = validate({"label": "x", "kind": "cli", "adapter": "claude", "base_url": "   "})

    assert any("base_url" in p for p in problems)


def test_validate_rejects_a_non_claude_cli_provider_with_a_base_url():
    problems = validate({
        "label": "x", "kind": "cli", "adapter": "codex", "base_url": "https://proxy.example.com",
    })

    assert any("claude adapter" in p for p in problems)


def test_validate_rejects_cli_provider_with_both_key_and_path():
    problems = validate({
        "label": "x",
        "kind": "cli",
        "adapter": "claude",
        "api_key": "sk-x",
        "api_key_path": "/tmp/creds",
    })

    assert any("OR" in p for p in problems)


def test_draft_from_payload_builds_an_unpersisted_provider():
    draft = draft_from_payload({"label": "Claude CLI", "kind": "cli", "adapter": "claude"})

    assert draft.id == "draft"
    assert draft.adapter == "claude"
    assert load_providers() == {}


def test_validate_rejects_unknown_cli_adapter():
    problems = validate({"label": "x", "kind": "cli", "adapter": "not-a-real-cli"})

    assert problems


def test_validate_rejects_missing_base_url_for_openai_compatible():
    problems = validate({"label": "x", "kind": "api", "transport": "openai-compatible"})

    assert any("base_url" in p for p in problems)


def test_validate_rejects_both_key_and_path():
    problems = validate({
        "label": "x",
        "kind": "api",
        "transport": "anthropic",
        "api_key": "sk-x",
        "api_key_path": "/tmp/creds",
    })

    assert any("OR" in p for p in problems)


def test_validate_requires_credentials_unless_local():
    problems = validate({"label": "x", "kind": "api", "transport": "anthropic"})

    assert problems
    assert not validate({
        "label": "x", "kind": "api", "transport": "anthropic", "is_local": True,
    })


def test_validate_accepts_gemini_transport_with_key():
    assert not validate({"label": "x", "kind": "api", "transport": "gemini", "api_key": "g-key"})


def test_validate_requires_credentials_for_gemini_unless_local():
    problems = validate({"label": "x", "kind": "api", "transport": "gemini"})

    assert problems
    assert not validate({
        "label": "x", "kind": "api", "transport": "gemini", "is_local": True,
    })


def test_validate_rejects_empty_label():
    assert validate({"label": "", "kind": "cli", "adapter": "claude"})


def test_validate_rejects_unknown_kind():
    assert validate({"label": "x", "kind": "bogus"})


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
