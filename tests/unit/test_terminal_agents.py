"""061: `terminal.agents`' provider-routed `agent` kind and the merge-ready env overrides.

The `claude`/`shell` rows are pinned byte-for-byte by test_terminal_server.py's FR-012 assertion;
these tests cover the new `agent` kind's resolution and the env it returns for the caller to merge.
"""

from __future__ import annotations

from codechroma.llm.call_site_settings import save_group_assignment
from codechroma.llm.providers_store import create_provider


def _assign_agents_group(**provider_kwargs):
    provider = create_provider({
        "label": "Agent window provider", "kind": "cli", "adapter": "claude", **provider_kwargs,
    })
    save_group_assignment("agents", {"provider_id": provider.id, "model": "claude-opus"})
    return provider


def test_agent_kind_with_no_assignment_launches_effective_cli():
    from codechroma.assistant import save_assistant_settings
    from codechroma.terminal.agents import agent_cli

    save_assistant_settings({"cli": "codex"})

    argv, env = agent_cli("agent")

    assert argv[0] == "codex"
    assert env == {}


def test_agent_kind_routes_to_an_assigned_cli_provider_binary():
    from codechroma.terminal.agents import agent_cli

    _assign_agents_group(base_url="https://proxy.example.com", api_key="sk-proxy")

    argv, env = agent_cli("agent")

    assert argv[0] == "claude"
    assert env["ANTHROPIC_BASE_URL"] == "https://proxy.example.com"
    assert env["ANTHROPIC_AUTH_TOKEN"] == "sk-proxy"


def test_agent_kind_carries_a_first_message_and_resume():
    from codechroma.terminal.agents import agent_cli

    argv, _env = agent_cli("agent", initial_prompt="make a diagram")

    assert argv == ["claude", "make a diagram"]

    resumed, _env = agent_cli("agent", resume_session_id="abc123")

    assert resumed == ["claude", "--resume", "abc123"]


def test_agent_kind_unknown_assigns_nothing_to_a_fixed_shell():
    from codechroma.terminal.agents import agent_cli

    assert agent_cli("shell") is not None
    argv, env = agent_cli("shell")

    assert argv[0]  # the real login-shell binary
    assert env == {}


def test_claude_kind_still_ignores_the_provider_store():
    """FR-012: a plain `claude` record never consults the providers store, even when set."""
    from codechroma.assistant import save_assistant_settings
    from codechroma.terminal.agents import agent_cli

    _assign_agents_group(base_url="https://proxy.example.com", api_key="sk-proxy")
    save_assistant_settings({"cli": "claude"})

    argv, env = agent_cli("claude")

    assert argv == ["claude"]
    assert env == {}
