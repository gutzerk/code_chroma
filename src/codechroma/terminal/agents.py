"""Allow-list of commands the terminal server may spawn, keyed by client-supplied name.

Still an allow-list: the front end names a key, never a command, so it can't ask for any argv.
Membership in `ALLOWED_AGENTS` is authoritative (a test can swap the whole dict to reject things);
the `claude` row also honors the saved assistant-settings `cli` choice, so an agent window launches
the selected binary (e.g. `codex`) while defaulting to `claude` when unset.

The `agent` row is the provider-routed kind (061): `agent_cli` resolves its real argv at launch
through the same provider mechanism skills use (`llm.resolve_cli` under the `parallel_agents` call
site's group assignment), falling back to `effective_cli` exactly when the group is unassigned. A
plain `claude` record keeps FR-012 untouched: it takes the assistant's `effective_cli` directly and
never consults the providers store.
"""

from __future__ import annotations

import os

from codechroma.assistant import DEFAULT_CLI, load_assistant_settings
from codechroma.bridge.resources import resource_path
from codechroma.config import settings

ALLOWED_AGENTS: dict[str, list[str]] = {
    "shell": (
        [os.environ.get("COMSPEC", "cmd.exe")]
        if settings.windows
        else [os.environ.get("SHELL", "/bin/bash"), "-l"]
    ),
    "claude": ["claude"],
    # The `agent` kind's argv is resolved at launch by `agent_cli`, never read from this table.
    "agent": [],
}

# Resuming is the same binary with two extra argv entries, not a second allow-list row.
RESUME_FLAG = "--resume"

# The agentic call site whose group assignment routes every `agent`-kind window (061).
AGENT_CALL_SITE = "parallel_agents"


def _default_model() -> str:
    """The window's fallback model when nothing provider-side pins one — the skill agents' own."""
    return settings.skill_agent_timeouts.model


def agent_cli(
    agent: str, resume_session_id: str | None = None, initial_prompt: str | None = None,
) -> tuple[list[str], dict[str, str]] | None:
    """Return an allow-listed agent's argv and provider environment, or None."""
    if agent == "agent":
        from codechroma.llm.resolve_cli import resolve_cli

        _adapter_key, binary, _model, env = resolve_cli(AGENT_CALL_SITE, _default_model())
        plugin_args = _codechroma_plugin_args(
            _resolved_claude_adapter(_adapter_key, binary)
        )
        return [binary, *plugin_args, *_resume_prompt(resume_session_id, initial_prompt)], env
    argv_entry = ALLOWED_AGENTS.get(agent)
    if argv_entry is None:
        return None
    if agent == "claude":
        # Keep the default binary unless the user pointed the assistant at something else.
        binary = load_assistant_settings().effective_cli
        plugin_args = _codechroma_plugin_args(binary == DEFAULT_CLI)
        return [binary, *plugin_args, *_resume_prompt(resume_session_id, initial_prompt)], {}
    # Generic kinds (e.g. shell): a resume still appends the flag; a first message never does.
    if resume_session_id:
        return [*argv_entry, RESUME_FLAG, resume_session_id], {}
    return list(argv_entry), {}


def resolved_cli_for(kind: str, argv: list[str]) -> str:
    """The label to persist on `AgentRecord.resolved_cli` -- only `agent` windows report one."""
    return argv[0] if kind == "agent" else ""


def _codechroma_plugin_args(is_claude: bool) -> list[str]:
    """Load CodeChroma skills for this Claude Code process without changing its project."""
    if not is_claude:
        return []
    return ["--plugin-dir", str(resource_path("skills").parent)]


def _resolved_claude_adapter(adapter_key: str, binary: str) -> bool:
    """Distinguish a Claude provider wrapper from the unassigned assistant CLI fallback."""
    if adapter_key != "claude":
        return False
    from codechroma.llm.call_site_settings import load_group_assignment
    from codechroma.llm.providers_store import find_provider

    assignment = load_group_assignment("agents")
    provider = find_provider(assignment.provider_id) if assignment is not None else None
    if provider is not None and provider.kind == "cli":
        return provider.adapter == "claude"
    return binary == load_assistant_settings().effective_cli == DEFAULT_CLI


def _resume_prompt(resume_session_id: str | None, initial_prompt: str | None) -> list[str]:
    """Tail argv: resume wins over a first message; both only apply to claude-like kinds."""
    if resume_session_id:
        return [RESUME_FLAG, resume_session_id]
    if initial_prompt:
        return [initial_prompt]
    return []
