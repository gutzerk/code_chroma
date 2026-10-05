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


def _plugin_args():
    from codechroma.bridge.resources import resource_path

    return ["--plugin-dir", str(resource_path("skills").parent)]


def test_agent_kind_with_no_assignment_launches_effective_cli():
    from codechroma.assistant import save_assistant_settings
    from codechroma.terminal.agents import agent_cli

    save_assistant_settings({"cli": "codex"})

    argv, env = agent_cli("agent")

    assert argv[0] == "codex"
    assert "--plugin-dir" not in argv
    assert env == {}


def test_agent_kind_routes_to_an_assigned_cli_provider_binary():
    from codechroma.terminal.agents import agent_cli

    _assign_agents_group(base_url="https://proxy.example.com", api_key="sk-proxy")

    argv, env = agent_cli("agent")

    assert argv[0] == "claude"
    assert argv[1:3] == _plugin_args()
    assert env["ANTHROPIC_BASE_URL"] == "https://proxy.example.com"
    assert env["ANTHROPIC_AUTH_TOKEN"] == "sk-proxy"


def test_agent_kind_loads_plugin_when_claude_adapter_uses_a_wrapper(monkeypatch):
    from codechroma.bridge.resources import resource_path
    from codechroma.llm import resolve_cli
    from codechroma.llm.resolve_cli import CliResolution
    from codechroma.terminal.agents import agent_cli

    _assign_agents_group()
    monkeypatch.setattr(
        resolve_cli,
        "resolve_cli",
        lambda _call_site, _model: CliResolution(
            adapter_key="claude",
            binary="claude-wrapper",
            model="claude-opus",
            env_overrides={},
            provider_assigned=True,
        ),
    )

    argv, env = agent_cli("agent")

    assert argv == ["claude-wrapper", "--plugin-dir", str(resource_path("skills").parent)]
    assert env == {}


def test_agent_kind_carries_a_first_message_and_resume():
    from codechroma.terminal.agents import agent_cli

    argv, _env = agent_cli("agent", initial_prompt="make a diagram")

    assert argv == ["claude", *_plugin_args(), "make a diagram"]

    resumed, _env = agent_cli("agent", resume_session_id="abc123")

    assert resumed == ["claude", *_plugin_args(), "--resume", "abc123"]


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

    assert argv == ["claude", *_plugin_args()]
    assert env == {}


def test_non_claude_assistant_cli_does_not_receive_claude_plugin_flags():
    from codechroma.assistant import save_assistant_settings
    from codechroma.terminal.agents import agent_cli

    save_assistant_settings({"cli": "codex"})

    argv, env = agent_cli("claude")

    assert argv == ["codex"]
    assert env == {}


def test_runtime_plugin_directory_contains_the_existing_bundled_skills():
    import json
    import re

    from codechroma.bridge.resources import resource_path
    from codechroma.bridge.skill_sync import SKILL_NAMES

    plugin_root = resource_path("skills").parent
    manifest = json.loads(
        (plugin_root / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
    )
    discoverable_commands = set()
    for skill_name in SKILL_NAMES:
        skill_text = (plugin_root / "skills" / skill_name / "SKILL.md").read_text(encoding="utf-8")
        frontmatter = skill_text.split("---", 2)[1]
        declared_name = re.search(r"(?m)^name:\s*(\S+)\s*$", frontmatter)
        assert declared_name is not None
        assert declared_name.group(1) == skill_name
        discoverable_commands.add(f"/{manifest['name']}:{declared_name.group(1)}")

    assert manifest["name"] == "codechroma"
    assert discoverable_commands == {
        "/codechroma:codechroma-draw-diagram",
        "/codechroma:codechroma-review-diagram",
        "/codechroma:codechroma-epic-brief",
        "/codechroma:codechroma-wiki-general-update",
    }


def test_headless_prompts_keep_using_synced_project_skill_commands():
    from pathlib import Path

    prompts = Path(__file__).parents[2] / "src" / "codechroma" / "prompts"
    prompt_skill_names = {
        "c1_agent.yaml": "codechroma-draw-diagram",
        "patterns_agent.yaml": "codechroma-draw-diagram",
        "impact_agent.yaml": "codechroma-draw-diagram",
        "sequence_agent.yaml": "codechroma-draw-diagram",
        "epics_agent.yaml": "codechroma-draw-diagram",
        "impact_review_agent.yaml": "codechroma-review-diagram",
        "epic_brief_agent.yaml": "codechroma-epic-brief",
        "wiki_general_update_agent.yaml": "codechroma-wiki-general-update",
    }

    assert all(
        f"/{skill_name}" in (prompts / prompt_name).read_text(encoding="utf-8")
        for prompt_name, skill_name in prompt_skill_names.items()
    )
