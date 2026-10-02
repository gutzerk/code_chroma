"""Unit tests for the cross-project assistant settings store (src/codechroma/assistant.py)."""

from codechroma.assistant import (
    assistant_settings_path,
    from_payload,
    load_assistant_settings,
    save_assistant_settings,
    validate,
)
from codechroma.io import load_json


def test_defaults_when_nothing_saved(tmp_path, monkeypatch):
    monkeypatch.setenv("codechroma_ASSISTANT_SETTINGS_FILE", str(tmp_path / "settings.json"))

    settings = load_assistant_settings()

    assert settings.cli == "claude"
    assert settings.model is None
    assert settings.instruction == ""
    assert not settings.has_key


def test_assistant_settings_path_honors_env(tmp_path, monkeypatch):
    monkeypatch.setenv("codechroma_ASSISTANT_SETTINGS_FILE", str(tmp_path / "here.json"))

    assert assistant_settings_path() == tmp_path / "here.json"


def test_save_then_load_roundtrips(tmp_path, monkeypatch):
    monkeypatch.setenv("codechroma_ASSISTANT_SETTINGS_FILE", str(tmp_path / "settings.json"))

    save_assistant_settings({
        "cli": "codex",
        "model": "gpt-5",
        "api_key": "sk-secret",
        "instruction": "put the model in config.py",
    })

    loaded = load_assistant_settings()
    assert loaded.cli == "codex"
    assert loaded.model == "gpt-5"
    assert loaded.api_key == "sk-secret"
    assert loaded.instruction == "put the model in config.py"


def test_save_persists_to_disk(tmp_path, monkeypatch):
    monkeypatch.setenv("codechroma_ASSISTANT_SETTINGS_FILE", str(tmp_path / "settings.json"))

    save_assistant_settings({"cli": "codex", "api_key_path": "/tmp/creds"})

    on_disk = load_json(tmp_path / "settings.json")
    assert on_disk["cli"] == "codex"
    assert on_disk["api_key_path"] == "/tmp/creds"


def test_masked_payload_hides_raw_key(tmp_path, monkeypatch):
    monkeypatch.setenv("codechroma_ASSISTANT_SETTINGS_FILE", str(tmp_path / "settings.json"))
    save_assistant_settings({"cli": "claude", "api_key": "sk-hunter2", "api_key_path": None})

    masked = load_assistant_settings().masked()

    assert masked["api_key_set"] is True
    assert "api_key" not in masked
    assert masked["cli"] == "claude"


def test_validate_rejects_both_key_and_path():
    problems = validate({"cli": "claude", "api_key": "sk-x", "api_key_path": "/tmp/creds"})

    assert any("OR" in p for p in problems)


def test_validate_rejects_slash_in_cli():
    assert validate({"cli": "/usr/bin/claude"})
    assert not validate({"cli": "codex"})


def test_from_payload_ignores_invalid_fields():
    settings = from_payload({"cli": 42, "model": "", "api_key": 7, "junk": True})

    assert settings.cli == "claude"
    assert settings.model is None
    assert settings.api_key is None


def test_key_source_reports_settings_file_and_env(tmp_path, monkeypatch):
    from codechroma.context.llm_provider import key_source

    monkeypatch.setenv("codechroma_ASSISTANT_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    assert key_source() == "none"

    save_assistant_settings({"cli": "claude", "api_key": "sk-x", "api_key_path": None})
    assert key_source() == "settings"

    save_assistant_settings({"cli": "claude", "api_key_path": "/tmp/creds"})
    assert key_source() == "file"

    save_assistant_settings({"cli": "claude"})
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-env")
    assert key_source() == "env"
