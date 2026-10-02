"""Shared CLI resolution for agentic call sites and provider-routed agent windows.

One function is the single source of the assignment -> provider -> adapter -> binary/model/env
algorithm that `SkillAgent.resolve_cli` used to own in isolation. Both the headless skill path
(`bridge/skill_agent.py`) and the interactive agent-window path (`terminal/agents.py`) call it, so
after a provider change they can never drift apart. The rule is unchanged from skill_agent's: an
assigned `kind="cli"` provider whose adapter is known launches that binary; otherwise the caller
falls back to the assistant settings' `effective_cli` via the default claude adapter (FR-009 --
additive, never a required migration).
"""

from __future__ import annotations

from codechroma.assistant import load_assistant_settings
from codechroma.context.llm_provider import resolve_provider_key
from codechroma.llm.call_site_settings import load_assignment
from codechroma.llm.cli_adapters import CLI_ADAPTERS
from codechroma.llm.providers_store import Provider, find_provider

# (adapter_key, binary, model, env_overrides) -- the shape every consumer turns back into a launch.
ClResolved = tuple[str, str, str, dict[str, str]]


def _cli_env_overrides(provider: Provider, model: str) -> dict[str, str]:
    """Only "claude" providers with a base_url get env vars -- doesn't affect `--bare`'s check."""
    if provider.adapter != "claude" or not provider.base_url:
        return {}
    # AUTH_TOKEN not API_KEY (API_KEY wins precedence); ANTHROPIC_MODEL not --model (CLI rejects it)
    overrides = {
        "ANTHROPIC_BASE_URL": provider.base_url,
        "ANTHROPIC_API_KEY": "",
        "ANTHROPIC_MODEL": model,
    }
    key = resolve_provider_key(provider)
    if key:
        overrides["ANTHROPIC_AUTH_TOKEN"] = key
    if not provider.verify_ssl:
        # claude is a Node/Bun binary; this is its cert-verification escape hatch, not ours to skip.
        overrides["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    return overrides


def resolve_cli(call_site_id: str, default_model: str) -> ClResolved:
    """(adapter_key, binary, model, env_overrides): the call site's assignment, else the default."""
    assignment = load_assignment(call_site_id)
    if assignment is not None and assignment.mode == "cli":
        provider = find_provider(assignment.provider_id)
        if provider is not None and provider.kind == "cli" and provider.adapter in CLI_ADAPTERS:
            return (
                provider.adapter,
                provider.adapter,
                assignment.model,
                _cli_env_overrides(provider, assignment.model),
            )
    assistant = load_assistant_settings()
    model = assistant.model if assistant.model else default_model
    return "claude", assistant.effective_cli, model, {}
