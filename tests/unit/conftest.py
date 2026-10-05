"""Shared fixtures for tests/unit/ -- keeps every test off this machine's real settings files."""

import pytest


@pytest.fixture(autouse=True)
def _isolate_codechroma_settings(tmp_path, monkeypatch):
    """Points every settings/provider store at a scratch dir, never the developer's real one."""
    monkeypatch.setenv("codechroma_RUNTIME_SETTINGS_FILE", str(tmp_path / "runtime.json"))
    monkeypatch.setenv("codechroma_ASSISTANT_SETTINGS_FILE", str(tmp_path / "assistant.json"))
    monkeypatch.setenv("codechroma_LLM_PROVIDERS_FILE", str(tmp_path / "llm-providers.json"))
    monkeypatch.setenv(
        "codechroma_LLM_CALL_SITE_SETTINGS_FILE", str(tmp_path / "llm-call-site-settings.json")
    )
