"""Capability table, api/anthropic CLI resolution and keyed-claude quick calls (plan 023)."""

import pytest

from codechroma.context import llm_provider
from codechroma.llm.call_site_settings import Assignment
from codechroma.llm.providers_store import Capabilities, Provider, capabilities
from codechroma.llm.resolve_cli import resolve_cli


@pytest.mark.parametrize(
    ("provider", "agents", "quick"),
    [
        (Provider("p", "c", "cli", adapter="claude"), True, False),
        (Provider("p", "c", "cli", adapter="claude", api_key="k"), True, True),
        (Provider("p", "c", "cli", adapter="claude", api_key_path="/k"), True, True),
        (Provider("p", "c", "cli", adapter="codex"), True, False),
        (Provider("p", "c", "cli", adapter="kimi-cli"), True, False),
        (Provider("p", "a", "api", transport="anthropic", api_key="k"), True, True),
        (Provider("p", "g", "api", transport="gemini", api_key="k"), False, True),
        (Provider("p", "o", "api", transport="openai-compatible", is_local=True), False, True),
    ],
)
def test_capability_table(provider, agents, quick):
    assert capabilities(provider) == Capabilities(agents, quick)


def _assign(monkeypatch, provider, model="sonnet"):
    monkeypatch.setattr(
        "codechroma.llm.resolve_cli.load_assignment",
        lambda _id: Assignment("x", provider.id, model, "cli"),
    )
    monkeypatch.setattr("codechroma.llm.resolve_cli.find_provider", lambda _id: provider)


def test_anthropic_api_provider_runs_claude_with_its_key_as_api_key(monkeypatch):
    provider = Provider("p", "a", "api", transport="anthropic", api_key="sk-secret")
    _assign(monkeypatch, provider)

    resolution = resolve_cli("c1_agent", "haiku")

    assert (resolution.adapter_key, resolution.binary, resolution.model) == (
        "claude", "claude", "sonnet")
    assert resolution.provider_assigned is True
    assert resolution.env_overrides == {
        "ANTHROPIC_API_KEY": "sk-secret",
        "ANTHROPIC_MODEL": "sonnet",
    }


def test_anthropic_api_provider_behind_a_proxy_sends_its_key_as_auth_token(monkeypatch):
    provider = Provider(
        "p", "a", "api", transport="anthropic", api_key="k", base_url="https://proxy.example"
    )
    _assign(monkeypatch, provider)

    resolution = resolve_cli("c1_agent", "haiku")

    assert resolution.env_overrides == {
        "ANTHROPIC_BASE_URL": "https://proxy.example",
        "ANTHROPIC_API_KEY": "",
        "ANTHROPIC_MODEL": "sonnet",
        "ANTHROPIC_AUTH_TOKEN": "k",
    }


def test_build_provider_uses_a_keyed_claude_cli_connection(monkeypatch):
    provider = Provider("p", "c", "cli", adapter="claude", api_key="sk-k", base_url="https://b")
    seen = {}

    def fake(api_key, base_url=None):
        seen.update(api_key=api_key, base_url=base_url)
        return "built"

    monkeypatch.setattr(llm_provider, "find_provider", lambda _id: provider)
    monkeypatch.setattr(llm_provider, "_build_anthropic_provider", fake)

    result = llm_provider.build_provider(Assignment("x", "p", "sonnet", "api"))

    assert result == "built"
    assert seen == {"api_key": "sk-k", "base_url": "https://b"}


def test_build_provider_returns_none_for_an_offline_assignment():
    assert llm_provider.build_provider(Assignment("x", "", "", "offline")) is None
