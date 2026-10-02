"""Renders one `claude -p --output-format stream-json` event into readable progress lines.

A headless skill run is minutes long, so the canvas shows what the agent is doing as it happens. The
stream carries far more than that: hook lifecycle events, an init manifest, a `thinking_tokens`
event every few tokens, rate-limit notices. So this whitelists the handful of event shapes worth
showing rather than filtering noise out — an unrecognized event renders nothing, which keeps a CLI
change from flooding the feed with internals. Reasoning content blocks are shown collapsed to one
line (they fire often), so the feed reads as thinking plus tools, not just tools. `text_lines`/
`flatten` are plain string-shaping helpers with nothing Claude-specific about them, so
`llm/cli_adapters.py`'s other adapters import them too rather than re-implementing the same logic.
"""

from __future__ import annotations

from pathlib import Path

_MAX_ARG = 100
_MAX_ERROR = 100
_MAX_THINK = 200

# The first of these present in a tool's input is the one worth showing beside its name.
_ARG_KEYS = ("file_path", "pattern", "command", "path", "url", "description")


def render_event(event: object, repo_root: Path) -> list[str]:
    """Progress lines for one stream-json event; empty for anything not worth showing."""
    if not isinstance(event, dict):
        return []
    kind = event.get("type")
    if kind == "assistant":
        return _render_assistant(event, repo_root)
    if kind == "user":
        return _render_user(event)
    if kind == "result":
        return _render_result(event)
    return []


def _render_assistant(event: dict, repo_root: Path) -> list[str]:
    lines: list[str] = []
    for block in _content_blocks(event):
        if block.get("type") == "text":
            lines.extend(text_lines(block.get("text")))
        elif block.get("type") == "tool_use":
            lines.append(_tool_line(block, repo_root))
        elif block.get("type") == "thinking":
            text = block.get("thinking")
            if isinstance(text, str) and text.strip():
                lines.append(flatten(text, _MAX_THINK))
    return lines


def _render_user(event: dict) -> list[str]:
    """Only failures: a successful tool result is bulk the tool_use line already accounted for."""
    lines = []
    for block in _content_blocks(event):
        if block.get("type") == "tool_result" and block.get("is_error"):
            lines.append(f"  ↳ error: {flatten(_result_text(block), _MAX_ERROR)}")
    return lines


def _render_result(event: dict) -> list[str]:
    if event.get("is_error"):
        # `result` (e.g. "API Error: ...") is the readable cause; `subtype` alone can say "success".
        message = event.get("result")
        text = flatten(message, _MAX_ERROR) if isinstance(message, str) and message.strip() else ""
        return [f"✗ {text or event.get('subtype') or 'failed'}"]
    duration = event.get("duration_api_ms")
    if not isinstance(duration, int | float):
        return ["✓ done"]
    return [f"✓ done in {round(duration / 1000)}s"]


def _content_blocks(event: dict) -> list[dict]:
    message = event.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if not isinstance(content, list):
        return []
    return [block for block in content if isinstance(block, dict)]


def text_lines(text: object) -> list[str]:
    """Kept multi-line: an agent's own prose is the one place line breaks carry meaning."""
    if not isinstance(text, str):
        return []
    return [stripped for line in text.strip().splitlines() if (stripped := line.rstrip())]


def _tool_line(block: dict, repo_root: Path) -> str:
    name = str(block.get("name") or "tool")
    tool_input = block.get("input")
    arg = _tool_arg(tool_input, repo_root) if isinstance(tool_input, dict) else ""
    return f"⏺ {name}({arg})" if arg else f"⏺ {name}"


def _tool_arg(tool_input: dict, repo_root: Path) -> str:
    for key in _ARG_KEYS:
        value = tool_input.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        return flatten(_relativize(value, repo_root) if key == "file_path" else value, _MAX_ARG)
    return ""


def _relativize(value: str, repo_root: Path) -> str:
    """Absolute paths are what the agent actually sends, and they're mostly the repo root twice."""
    try:
        return str(Path(value).relative_to(repo_root))
    except ValueError:
        return value


def flatten(value: str, limit: int) -> str:
    """One line, bounded: a heredoc Bash command or a stack trace must not reshape the feed."""
    collapsed = " ".join(value.split())
    return collapsed if len(collapsed) <= limit else collapsed[: limit - 1] + "…"


def _result_text(block: dict) -> str:
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [part.get("text", "") for part in content if isinstance(part, dict)]
        return " ".join(part for part in parts if part)
    return "failed"
