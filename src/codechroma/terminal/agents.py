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
from pathlib import Path

from codechroma.assistant import DEFAULT_CLI, load_assistant_settings
from codechroma.bridge.agents.session_ownership import FILE_ENV, INITIAL_ID_ENV, hook_settings
from codechroma.bridge.resources import resource_path
from codechroma.config import settings
from codechroma.llm.cli_adapters import CLI_ADAPTERS
from codechroma.questions.launch import McpEndpoint

CLASSIC_RENDERER_ENV = "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN"

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
    mcp: McpEndpoint | None = None, new_session_id: str | None = None,
    session_tracking_file: Path | None = None, workdir: Path | None = None,
) -> tuple[list[str], dict[str, str]] | None:
    """Return an allow-listed agent's argv and provider environment, or None."""
    if agent == "agent":
        from codechroma.llm.resolve_cli import resolve_cli

        resolution = resolve_cli(AGENT_CALL_SITE, _default_model())
        is_claude = resolution.adapter_key == "claude" and (
            resolution.provider_assigned or resolution.binary == DEFAULT_CLI
        )
        # The claude adapter behind a stand-in binary is not the real CLI, so it gets no MCP server.
        stand_in = resolution.adapter_key == "claude" and not is_claude
        adapter = None if stand_in else resolution.adapter_key
        mcp_args, mcp_env = _mcp_registration(adapter, mcp, workdir)
        return [
            resolution.binary,
            *_model_args(resolution),
            *_tracking_args(is_claude, session_tracking_file),
            *_instruction_args(is_claude),
            *mcp_args,
            *_codechroma_plugin_args(is_claude),
            *_new_session_args(is_claude, resume_session_id, new_session_id),
            *_resume_prompt(resume_session_id, initial_prompt),
        ], {
            **resolution.env_overrides, **mcp_env,
            **_tracking_env(is_claude, session_tracking_file, resume_session_id or new_session_id),
            **_renderer_env(is_claude),
        }
    argv_entry = ALLOWED_AGENTS.get(agent)
    if argv_entry is None:
        return None
    if agent == "claude":
        # Keep the default binary unless the user pointed the assistant at something else.
        binary = load_assistant_settings().effective_cli
        is_claude = binary == DEFAULT_CLI
        mcp_args, mcp_env = _mcp_registration("claude" if is_claude else None, mcp, workdir)
        return [
            binary,
            *_tracking_args(is_claude, session_tracking_file),
            *_instruction_args(is_claude),
            *mcp_args,
            *_codechroma_plugin_args(is_claude),
            *_new_session_args(is_claude, resume_session_id, new_session_id),
            *_resume_prompt(resume_session_id, initial_prompt),
        ], {
            **mcp_env,
            **_tracking_env(is_claude, session_tracking_file, resume_session_id or new_session_id),
            **_renderer_env(is_claude),
        }
    # Generic kinds (e.g. shell): a resume still appends the flag; a first message never does.
    if resume_session_id:
        return [*argv_entry, RESUME_FLAG, resume_session_id], {}
    return list(argv_entry), {}


def resolved_cli_for(kind: str, argv: list[str]) -> str:
    """The label to persist on `AgentRecord.resolved_cli` -- only `agent` windows report one."""
    return argv[0] if kind == "agent" else ""


def _model_args(resolution) -> list[str]:
    """`--model` for an assigned provider's model; omitted when unassigned or in ANTHROPIC_MODEL."""
    if not resolution.provider_assigned or "ANTHROPIC_MODEL" in resolution.env_overrides:
        return []
    return ["--model", resolution.model] if resolution.model else []


def _tracking_args(is_claude: bool, file: Path | None) -> list[str]:
    return ["--settings", hook_settings()] if is_claude and file is not None else []


def _renderer_env(is_claude: bool) -> dict[str, str]:
    """Force claude's classic renderer: a fullscreen TUI leaves xterm no scrollback to scroll."""
    return {CLASSIC_RENDERER_ENV: "1"} if is_claude else {}


def _tracking_env(is_claude: bool, file: Path | None, session_id: str | None) -> dict[str, str]:
    if not is_claude or file is None:
        return {}
    return {FILE_ENV: str(file), INITIAL_ID_ENV: session_id or ""}


def _codechroma_plugin_args(is_claude: bool) -> list[str]:
    """Load CodeChroma skills for this Claude Code process without changing its project."""
    if not is_claude:
        return []
    return ["--plugin-dir", str(resource_path("skills").parent)]


def _instruction_args(is_claude: bool) -> list[str]:
    """The saved agent-window instruction as claude system-prompt args; empty when unset."""
    text = load_assistant_settings().instruction.strip()
    return ["--append-system-prompt", text] if is_claude and text else []


def _mcp_registration(
    adapter: str | None, mcp: McpEndpoint | None, workdir: Path | None
) -> tuple[list[str], dict[str, str]]:
    """Argv and env that register the CodeChroma MCP server with this CLI; empty when it can't."""
    cli = CLI_ADAPTERS.get(adapter) if adapter is not None else None
    if cli is None or mcp is None:
        return [], {}
    registration = cli.mcp_registration(mcp, workdir)
    if registration is None:
        return [], {}
    args, env = registration
    return args, {**mcp.env(), **env}


def _resume_prompt(resume_session_id: str | None, initial_prompt: str | None) -> list[str]:
    """Tail argv: resume wins over a first message; both only apply to claude-like kinds."""
    if resume_session_id:
        return [RESUME_FLAG, resume_session_id]
    if initial_prompt:
        return [initial_prompt]
    return []


def _new_session_args(
    is_claude: bool, resume_session_id: str | None, new_session_id: str | None
) -> list[str]:
    """Pins a fresh Claude conversation to an id the bridge can persist before another terminal."""
    if is_claude and not resume_session_id and new_session_id:
        return ["--session-id", new_session_id]
    return []
