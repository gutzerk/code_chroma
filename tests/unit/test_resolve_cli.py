"""061: the shared `llm.resolve_cli` — assignment → provider → adapter → binary/model/env.

Unit-store isolation comes from tests/unit/conftest.py's autouse fixture, so these never touch a
real provider/call-site store.
"""

from __future__ import annotations

from codechroma.llm.call_site_settings import save_group_assignment
from codechroma.llm.providers_store import create_provider


def _save_agent_group(tmp_path, monkeypatch, **provider_kwargs):
    provider = create_provider({
        "label": "Agent window provider", "kind": "cli", "adapter": "claude", **provider_kwargs,
    })
    save_group_assignment("agents", {"provider_id": provider.id, "model": "claude-opus"})
    return provider


def test_no_assignment_falls_back_to_effective_cli(tmp_path, monkeypatch):
    """An unassigned `parallel_agents` group resolves to `effective_cli` via the claude adapter."""
    # The assistant's cli choice, not the default "claude", is what the fallback honors.
    from codechroma.assistant import save_assistant_settings
    from codechroma.llm.resolve_cli import resolve_cli
    save_assistant_settings({"cli": "codex"})

    adapter_key, binary, model, env = resolve_cli("parallel_agents", "haiku")

    assert adapter_key == "claude"
    assert binary == "codex"
    assert model == "haiku"
    assert env == {}


def test_group_assignment_resolves_to_the_provider_adapter(tmp_path, monkeypatch):
    """An assigned `agents` group launches that cli provider's binary plus its env overrides."""
    from codechroma.llm.resolve_cli import resolve_cli

    _save_agent_group(
        tmp_path, monkeypatch, base_url="https://proxy.example.com", api_key="sk-proxy"
    )

    adapter_key, binary, model, env = resolve_cli("parallel_agents", "haiku")

    assert adapter_key == "claude"
    assert binary == "claude"
    assert model == "claude-opus"
    assert env == {
        "ANTHROPIC_BASE_URL": "https://proxy.example.com",
        "ANTHROPIC_API_KEY": "",
        "ANTHROPIC_MODEL": "claude-opus",
        "ANTHROPIC_AUTH_TOKEN": "sk-proxy",
    }


def test_non_cli_kind_provider_falls_back(tmp_path, monkeypatch):
    """An api-kind provider assigned to the group is ignored (agentic groups are cli-only)."""
    from codechroma.llm.resolve_cli import resolve_cli

    create_provider({
        "label": "Direct API", "kind": "api", "transport": "anthropic", "api_key": "sk-ant-x",
    })

    adapter_key, binary, _model, _env = resolve_cli("parallel_agents", "haiku")

    assert adapter_key == "claude"
    assert binary == "claude"


def test_unknown_call_site_also_falls_back(tmp_path, monkeypatch):
    """Even a call site with no group and no row resolves to the effective default."""
    from codechroma.llm.resolve_cli import resolve_cli

    adapter_key, binary, _model, _env = resolve_cli("nonexistent_site", "haiku")

    assert adapter_key == "claude"
    assert binary == "claude"
