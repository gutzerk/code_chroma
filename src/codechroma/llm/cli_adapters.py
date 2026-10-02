"""One argv-building/output-parsing implementation per CLI tool, behind a shared Protocol.

Generalized from `bridge/skill_agent.py`'s previously-hardcoded `_run_claude`: that method assumed
one CLI's flags and one output format. `CLI_ADAPTERS` ships `claude`, `codex`, and `kimi-cli`, each
always run unattended (no approval prompts) with a structured JSONL output format, matching
`ClaudeAdapter`'s `--permission-mode bypassPermissions` / `stream-json` choices -- for Codex that's
just its `exec` subcommand (no interactive-approval flag exists there; there's no TTY to prompt on),
for Kimi it's `--prompt` itself (auto-approves by design, per its own CLI). Codex's event shape is
item-based and Kimi's is chat-message-based -- unrelated to each other or to Claude's content-block
shape -- so each adapter owns its own event-to-lines mapping; only the shape-agnostic line-shaping
helpers (`text_lines`/`flatten`) and output vocabulary (`⏺ name`, `✓ done`, `✗ msg`,
`  ↳ error: msg`) are shared, via `bridge/skill_output.py`. Both adapters' flags were verified
against the real installed `codex`/`kimi` binaries (2026-09-21), not just vendor docs.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Protocol

from codechroma.bridge.skill_output import flatten, render_event, text_lines

_MAX_MESSAGE = 200


class CliAdapter(Protocol):
    def build_argv(
        self, binary: str, prompt: str, model: str, env: dict[str, str] | None = None
    ) -> list[str]: ...

    def parse_line(self, raw: bytes | str, repo_root: Path) -> list[str]: ...


def supports_minimal_context_workers(adapter: CliAdapter) -> bool:
    """Whether `adapter` implements the zero-tool structured-output worker methods."""
    return hasattr(adapter, "build_worker_argv") and hasattr(adapter, "parse_structured_output")


def _parse_json_event(raw: bytes | str) -> dict | None:
    """The one JSON-decode-and-shape-check every adapter's parse_line needs before dispatching."""
    try:
        event = json.loads(raw)
    except ValueError:
        return None
    return event if isinstance(event, dict) else None


class ClaudeAdapter:
    """`claude -p ... --output-format stream-json` -- the shape skill_agent used to build inline."""

    def build_argv(
        self, binary: str, prompt: str, model: str, env: dict[str, str] | None = None
    ) -> list[str]:
        # Empty model: the caller is routing the model via ANTHROPIC_MODEL instead (see below).
        argv = [binary, "-p", prompt, *(["--model", model] if model else [])]
        argv += [
            "--permission-mode",
            "bypassPermissions",
            "--output-format",
            "stream-json",
            "--verbose",
        ]
        # `env` is the actual subprocess env; a provider's overrides can clear os.environ's own key.
        resolved_env = env if env is not None else os.environ
        if resolved_env.get("ANTHROPIC_API_KEY"):
            # --bare cuts discovery/catalog tokens but needs a real key, never OAuth/keychain auth.
            argv.append("--bare")
        return argv

    def parse_line(self, raw: bytes | str, repo_root: Path) -> list[str]:
        event = _parse_json_event(raw)
        return render_event(event, repo_root) if event is not None else []

    def build_worker_argv(self, binary: str, prompt: str, model: str, schema: dict) -> list[str]:
        """A zero-tool, single-shot `claude -p` call for a wiki-general pipeline worker job."""
        argv = [binary, "-p", prompt, *(["--model", model] if model else [])]
        argv += [
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(schema),
            "--safe-mode",
            "--strict-mcp-config",
            "--tools",
            "",
        ]
        return argv

    def parse_structured_output(self, raw: bytes | str) -> dict | None:
        """A worker's JSON envelope -- `structured_output` if present, else parsed `result`."""
        envelope = _parse_json_event(raw)
        if envelope is None or envelope.get("is_error"):
            return None
        structured = envelope.get("structured_output")
        if isinstance(structured, dict):
            return structured
        result = envelope.get("result")
        if not isinstance(result, str):
            return None
        try:
            parsed = json.loads(result)
        except ValueError:
            return None
        return parsed if isinstance(parsed, dict) else None

    def parse_error_message(self, raw: bytes | str) -> str | None:
        """A failed worker envelope's own readable `result` text, if the raw output has one."""
        envelope = _parse_json_event(raw)
        if envelope is None:
            return None
        result = envelope.get("result")
        return result if isinstance(result, str) and result.strip() else None


_CODEX_ITEM_TOOL_TYPES = (
    "command_execution",
    "file_change",
    "mcp_tool_call",
    "web_search",
    "plan_update",
)


class CodexAdapter:
    """`codex exec --json` -- workspace-write sandbox; exec has no interactive approval to skip."""

    def build_argv(
        self, binary: str, prompt: str, model: str, env: dict[str, str] | None = None
    ) -> list[str]:
        return [
            binary,
            "exec",
            "--model",
            model,
            "--sandbox",
            "workspace-write",
            "--json",
            prompt,
        ]

    def parse_line(self, raw: bytes | str, repo_root: Path) -> list[str]:
        event = _parse_json_event(raw)
        if event is None:
            return []
        kind = event.get("type")
        if kind == "item.completed":
            return _render_codex_item(event.get("item"))
        if kind == "turn.completed":
            return ["✓ done"]
        if kind in ("turn.failed", "error"):
            message = str(event.get("message") or event.get("error") or "failed")
            return [f"✗ {flatten(message, _MAX_MESSAGE)}"]
        return []


def _render_codex_item(item: object) -> list[str]:
    if not isinstance(item, dict):
        return []
    item_type = item.get("type")
    if item_type == "agent_message":
        return text_lines(item.get("text"))
    if item_type == "reasoning":
        text = item.get("text")
        return [flatten(text, _MAX_MESSAGE)] if isinstance(text, str) and text.strip() else []
    if item_type == "error":
        message = item.get("message")
        return [f"  ↳ error: {flatten(message, _MAX_MESSAGE)}"] if isinstance(message, str) else []
    if item_type in _CODEX_ITEM_TOOL_TYPES:
        return [f"⏺ {item_type}"]
    return []


class KimiAdapter:
    """`kimi --prompt ... --output-format stream-json` -- --prompt alone runs non-interactively."""

    def build_argv(
        self, binary: str, prompt: str, model: str, env: dict[str, str] | None = None
    ) -> list[str]:
        return [
            binary,
            "--prompt",
            prompt,
            "--model",
            model,
            "--output-format",
            "stream-json",
        ]

    def parse_line(self, raw: bytes | str, repo_root: Path) -> list[str]:
        event = _parse_json_event(raw)
        if event is None:
            return []
        role = event.get("role")
        if role == "assistant":
            return _render_kimi_assistant(event)
        if role == "tool" and event.get("is_error"):
            message = str(event.get("content") or "failed")
            return [f"  ↳ error: {flatten(message, _MAX_MESSAGE)}"]
        return []


def _render_kimi_assistant(event: dict) -> list[str]:
    lines = text_lines(event.get("content"))
    for call in event.get("tool_calls") or []:
        if not isinstance(call, dict):
            continue
        function = call.get("function") if isinstance(call.get("function"), dict) else {}
        name = str(function.get("name") or call.get("name") or "tool")
        lines.append(f"⏺ {name}")
    return lines


CLI_ADAPTERS: dict[str, CliAdapter] = {
    "claude": ClaudeAdapter(),
    "codex": CodexAdapter(),
    "kimi-cli": KimiAdapter(),
}
