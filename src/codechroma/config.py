"""Centralized tunable defaults, as pydantic models — one place to see and override every limit,
timeout, and model name that used to live as a bare module-level constant next to the code it
configured. Each nested model's docstring names the module it replaced; construct your own
`Settings(...)` to override anything, `settings` below is just the process-wide default.
"""

from __future__ import annotations

import os
from functools import cache

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict


@cache
def load_env_once() -> None:
    """Reads `.env` on the first call only -- every *_from_env() runs on each analyze/reanalyze."""
    load_dotenv()


class _Config(BaseModel):
    model_config = ConfigDict(frozen=True)


class StructureConfig(_Config):
    """context/structure.py: the folder/file tree an AI assistant walks to author a diagram."""

    summary_chars: int = 160
    default_depth: int = 2
    default_max_children: int = 40
    default_max_nodes: int = 300
    max_depth: int = 5
    max_children: int = 200
    max_nodes: int = 1000


class ContextDigestConfig(_Config):
    """context/digest.py: the C1 diagram's project digest."""

    readme_excerpt_chars: int = 1500


class DependencyDigestConfig(_Config):
    """dependencies/digest.py: the persisted file -> class -> function dependency digest."""

    max_callees_per_symbol: int = 12
    max_callers_per_symbol: int = 12
    max_imports_per_file: int = 20
    trivial_max_body_lines: int = 2
    max_detailed_files: int = 500
    max_total_symbol_entries: int = 6000


class AnthropicClientConfig(_Config):
    """context/llm_provider.py: the shared Claude call every one-shot generator uses."""

    request_timeout_seconds: float = 30.0


class AISummarizerConfig(_Config):
    """summarize/ai_summarizer.py"""

    model: str = "claude-3-5-haiku-latest"
    max_tokens: int = 200


class PatternsGeneratorConfig(_Config):
    """context/patterns_generator.py"""

    model: str = "claude-haiku-4-5"
    max_tokens: int = 2000


class GitConfig(_Config):
    """bridge/git_cmd.py + bridge/git_long.py"""

    short_timeout_seconds: int = 10
    long_timeout_seconds: int = 120


class SkillAgentConfig(_Config):
    """bridge/skill_agent.py: the shared headless `claude -p` runner."""

    output_tail_chars: int = 500
    output_lines: int = 300
    flush_interval_seconds: float = 0.15
    stream_limit_bytes: int = 4 * 1024 * 1024


class SkillAgentTimeoutsConfig(_Config):
    """bridge/{c1,patterns,impact_review,epic-brief,custom_diagram,canvas_chat,wiki_general,wiki_general_update}_agent."""

    model: str = "haiku"
    default_timeout_seconds: int = 600
    timeout_seconds: dict[str, int] = {
        "c1": 600,
        "patterns": 600,
        "impact-changes": 300,
        "epic-brief": 300,
        "custom": 600,
        "canvas-chat": 180,
        "wiki-general": 3600,
        "wiki-general-update": 300,
    }

    def seconds_for(self, kind: str) -> int:
        return self.timeout_seconds.get(kind, self.default_timeout_seconds)


class BridgeAppConfig(_Config):
    """bridge/app.py"""

    status_poll_seconds: float = 0.25


class WorkspacesConfig(_Config):
    """bridge/workspaces.py"""

    idle_unload_seconds: int = 600


class PRWorkspacesConfig(_Config):
    """bridge/prs/manager.py"""

    max_pr_workspaces: int = 3


class AgentsConfig(_Config):
    """bridge/agents/manager.py"""

    max_agents: int = 5


class WorktreeConfig(_Config):
    """bridge/agents/worktree.py"""

    max_slug_length: int = 48
    max_submodule_depth: int = 5


class TranscriptsConfig(_Config):
    """bridge/agents/transcripts.py"""

    max_scanned_transcripts: int = 500
    head_lines: int = 12


class AgentStatusConfig(_Config):
    """bridge/agents/status.py"""

    hysteresis_seconds: float = 0.25
    min_emit_interval_seconds: float = 0.25
    default_tail_lines: int = 8


class PublishConfig(_Config):
    """bridge/agents/publish.py"""

    gh_timeout_seconds: int = 60
    commit_message_model: str = "haiku"
    commit_message_timeout_seconds: int = 30
    max_commit_message_attempts: int = 2
    diff_char_limit: int = 20_000


class AgentsRoutesConfig(_Config):
    """bridge/routes/agents.py"""

    session_id_poll_attempts: int = 10
    session_id_poll_seconds: float = 1.0
    # Fresh-start nudge: polls of the PTY screen awaiting Claude's idle prompt (sessions.py).
    context_inject_attempts: int = 60
    context_inject_interval_seconds: float = 0.5


class TerminalConfig(_Config):
    """terminal/screen_tap.py + terminal/pty_session.py"""

    tap_default_rows: int = 24
    tap_default_cols: int = 80
    pty_default_rows: int = 30
    pty_default_cols: int = 120
    read_chunk_size: int = 4096
    process_cache_seconds: float = 1.0
    # close() escalation: SIGTERM grace before SIGKILL, then the wait that reaps the exit code.
    close_grace_seconds: float = 0.2
    kill_wait_seconds: float = 1.0


class BootstrapConfig(_Config):
    """bridge/agents/bootstrap.py"""

    large_file_bytes: int = 5 * 1024 * 1024


class RequirementsConfig(_Config):
    """requirements/assembler.py + bridge/epics_resolver.py"""

    requirements_source_uri: str = "file://plan/epics"
    delivery_source_uri: str = "file://specs"
    max_items: int = 200
    max_requirements_per_item: int = 50
    max_stage_items: int = 200


class CustomDiagramsConfig(_Config):
    """diagrams/library.py + bridge/routes/custom_diagrams.py: user-authored diagram types."""

    type_id_pattern: str = r"^[a-z0-9][a-z0-9-]{0,63}$"
    max_types: int = 100


class DiagramDiagnosticsConfig(_Config):
    """bridge/diagram_diagnostics.py: how much of a malformed write the canvas is told about."""

    max_reported: int = 20


class WikiGeneratorConfig(_Config):
    """wiki/generator.py: the on-demand docstring wiki export."""

    folder_entry_cap: int = 100


class WikiContextConfig(_Config):
    """bridge/wiki_context.py: the wiki-page bundle a diagram-drawing skill reads first."""

    max_chars: int = 20000


class WikiGeneralContextConfig(_Config):
    """bridge/wiki_general_context.py: the wiki-general bundle a diagram skill reads before that."""

    max_chars: int = 20000


class WikiGeneralPipelineConfig(_Config):
    """bridge/wiki_general_pipeline.py: the deterministic fan-out worker pool (058)."""

    worker_concurrency: int = 6
    job_timeout_seconds: int = 120
    max_retries_per_job: int = 2


class Settings(_Config):
    """The process-wide default for every subsystem's tunables; construct your own to override."""
    windows: bool = os.name == "nt"
    structure: StructureConfig = StructureConfig()
    context_digest: ContextDigestConfig = ContextDigestConfig()
    dependency_digest: DependencyDigestConfig = DependencyDigestConfig()
    anthropic_client: AnthropicClientConfig = AnthropicClientConfig()
    ai_summarizer: AISummarizerConfig = AISummarizerConfig()
    patterns_generator: PatternsGeneratorConfig = PatternsGeneratorConfig()
    git: GitConfig = GitConfig()
    skill_agent: SkillAgentConfig = SkillAgentConfig()
    skill_agent_timeouts: SkillAgentTimeoutsConfig = SkillAgentTimeoutsConfig()
    bridge_app: BridgeAppConfig = BridgeAppConfig()
    workspaces: WorkspacesConfig = WorkspacesConfig()
    pr_workspaces: PRWorkspacesConfig = PRWorkspacesConfig()
    agents: AgentsConfig = AgentsConfig()
    worktree: WorktreeConfig = WorktreeConfig()
    transcripts: TranscriptsConfig = TranscriptsConfig()
    agent_status: AgentStatusConfig = AgentStatusConfig()
    publish: PublishConfig = PublishConfig()
    agents_routes: AgentsRoutesConfig = AgentsRoutesConfig()
    terminal: TerminalConfig = TerminalConfig()
    bootstrap: BootstrapConfig = BootstrapConfig()
    requirements: RequirementsConfig = RequirementsConfig()
    custom_diagrams: CustomDiagramsConfig = CustomDiagramsConfig()
    diagram_diagnostics: DiagramDiagnosticsConfig = DiagramDiagnosticsConfig()
    wiki_generator: WikiGeneratorConfig = WikiGeneratorConfig()
    wiki_context: WikiContextConfig = WikiContextConfig()
    wiki_general_context: WikiGeneralContextConfig = WikiGeneralContextConfig()
    wiki_general_pipeline: WikiGeneralPipelineConfig = WikiGeneralPipelineConfig()


settings = Settings()
