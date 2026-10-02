"""Unit tests for the CLI adapters' argv building and output-line parsing (llm/cli_adapters.py)."""

from pathlib import Path

import pytest

from codechroma.llm.cli_adapters import CLI_ADAPTERS, ClaudeAdapter, CodexAdapter, KimiAdapter


@pytest.mark.parametrize(
    ("key", "cls"),
    [("claude", ClaudeAdapter), ("codex", CodexAdapter), ("kimi-cli", KimiAdapter)],
)
def test_registry_has_the_expected_adapter(key, cls):
    assert isinstance(CLI_ADAPTERS[key], cls)


@pytest.mark.parametrize("cls", [ClaudeAdapter, CodexAdapter, KimiAdapter])
def test_parse_line_ignores_malformed_json_for_every_adapter(cls, tmp_path: Path):
    assert cls().parse_line("not json", tmp_path) == []


def test_build_argv_matches_todays_claude_shape(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    argv = ClaudeAdapter().build_argv("claude", "do the thing", "claude-haiku-4-5")

    assert argv == [
        "claude",
        "-p",
        "do the thing",
        "--model",
        "claude-haiku-4-5",
        "--permission-mode",
        "bypassPermissions",
        "--output-format",
        "stream-json",
        "--verbose",
    ]


def test_build_argv_adds_bare_only_when_an_api_key_is_set(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    argv = ClaudeAdapter().build_argv("claude", "do the thing", "claude-haiku-4-5")

    assert "--bare" in argv


def test_build_argv_omits_bare_without_an_api_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    argv = ClaudeAdapter().build_argv("claude", "do the thing", "claude-haiku-4-5")

    assert "--bare" not in argv


def test_build_argv_omits_bare_for_an_auth_token_alone(monkeypatch):
    """--bare only accepts ANTHROPIC_API_KEY/apiKeyHelper; an AUTH_TOKEN-only proxy must skip it."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    argv = ClaudeAdapter().build_argv(
        "claude", "do the thing", "claude-haiku-4-5", env={"ANTHROPIC_AUTH_TOKEN": "sk-proxy"}
    )

    assert "--bare" not in argv


def test_build_argv_prefers_the_resolved_env_over_the_process_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-process-key")

    argv = ClaudeAdapter().build_argv(
        "claude", "do the thing", "claude-haiku-4-5", env={"ANTHROPIC_API_KEY": ""}
    )

    assert "--bare" not in argv


def test_build_argv_honors_a_custom_binary(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    argv = ClaudeAdapter().build_argv("codex", "prompt", "gpt-5")

    assert argv[0] == "codex"


def test_parse_line_renders_a_result_event(tmp_path: Path):
    raw = '{"type": "result", "is_error": false, "duration_api_ms": 2000}'

    lines = ClaudeAdapter().parse_line(raw, tmp_path)

    assert lines == ["✓ done in 2s"]


def test_parse_line_ignores_unrecognized_event_type(tmp_path: Path):
    assert ClaudeAdapter().parse_line('{"type": "system"}', tmp_path) == []


def test_codex_build_argv_runs_unattended():
    argv = CodexAdapter().build_argv("codex", "do the thing", "gpt-5.6")

    assert argv == [
        "codex",
        "exec",
        "--model",
        "gpt-5.6",
        "--sandbox",
        "workspace-write",
        "--json",
        "do the thing",
    ]


def test_codex_parse_line_renders_agent_message(tmp_path: Path):
    raw = '{"type": "item.completed", "item": {"type": "agent_message", "text": "hello"}}'

    lines = CodexAdapter().parse_line(raw, tmp_path)

    assert lines == ["hello"]


def test_codex_parse_line_renders_a_tool_item(tmp_path: Path):
    raw = '{"type": "item.completed", "item": {"type": "command_execution"}}'

    lines = CodexAdapter().parse_line(raw, tmp_path)

    assert lines == ["⏺ command_execution"]


def test_codex_parse_line_renders_turn_completed(tmp_path: Path):
    assert CodexAdapter().parse_line('{"type": "turn.completed"}', tmp_path) == ["✓ done"]


def test_codex_parse_line_renders_turn_failed(tmp_path: Path):
    raw = '{"type": "turn.failed", "message": "boom"}'

    assert CodexAdapter().parse_line(raw, tmp_path) == ["✗ boom"]


def test_codex_parse_line_renders_an_item_error(tmp_path: Path):
    """Observed from a real `codex exec --json` run: a non-fatal warning mid-turn."""
    raw = (
        '{"type": "item.completed", "item": {"type": "error", '
        '"message": "Model metadata not found."}}'
    )

    lines = CodexAdapter().parse_line(raw, tmp_path)

    assert lines == ["  ↳ error: Model metadata not found."]


def test_codex_parse_line_ignores_unrecognized_event_type(tmp_path: Path):
    assert CodexAdapter().parse_line('{"type": "thread.started"}', tmp_path) == []


def test_kimi_build_argv_runs_unattended():
    argv = KimiAdapter().build_argv("kimi", "do the thing", "kimi-k2")

    assert argv == [
        "kimi",
        "--prompt",
        "do the thing",
        "--model",
        "kimi-k2",
        "--output-format",
        "stream-json",
    ]


def test_kimi_parse_line_renders_assistant_text(tmp_path: Path):
    raw = '{"role": "assistant", "content": "hello"}'

    assert KimiAdapter().parse_line(raw, tmp_path) == ["hello"]


def test_kimi_parse_line_renders_a_tool_call(tmp_path: Path):
    raw = '{"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "grep"}}]}'

    assert KimiAdapter().parse_line(raw, tmp_path) == ["⏺ grep"]


def test_kimi_parse_line_renders_a_tool_error(tmp_path: Path):
    raw = '{"role": "tool", "is_error": true, "content": "not found"}'

    assert KimiAdapter().parse_line(raw, tmp_path) == ["  ↳ error: not found"]


def test_kimi_parse_line_ignores_a_successful_tool_result(tmp_path: Path):
    raw = '{"role": "tool", "content": "ok"}'

    assert KimiAdapter().parse_line(raw, tmp_path) == []

