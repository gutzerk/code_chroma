"""Unit tests for the CLI adapters' argv building and output-line parsing (llm/cli_adapters.py)."""

from pathlib import Path

import pytest

from codechroma.llm.cli_adapters import (
    CLI_ADAPTERS,
    ClaudeAdapter,
    CodexAdapter,
    GeminiAdapter,
    KimiAdapter,
)


@pytest.mark.parametrize(
    ("key", "cls"),
    [
        ("claude", ClaudeAdapter),
        ("codex", CodexAdapter),
        ("kimi-cli", KimiAdapter),
        ("gemini", GeminiAdapter),
    ],
)
def test_registry_has_the_expected_adapter(key, cls):
    assert isinstance(CLI_ADAPTERS[key], cls)


@pytest.mark.parametrize("cls", [ClaudeAdapter, CodexAdapter, KimiAdapter, GeminiAdapter])
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


@pytest.mark.parametrize(
    ("process_key", "env", "bare"),
    [
        ("sk-ant-test", None, True),
        ("", None, False),
        ("", {"ANTHROPIC_AUTH_TOKEN": "sk-proxy"}, False),
        ("sk-ant-process-key", {"ANTHROPIC_API_KEY": ""}, False),
    ],
    ids=["api-key", "no-key", "auth-token-only", "resolved-env-wins"],
)
def test_claude_build_argv_adds_bare_only_for_an_api_key(monkeypatch, process_key, env, bare):
    monkeypatch.setenv("ANTHROPIC_API_KEY", process_key)

    argv = ClaudeAdapter().build_argv("claude", "do the thing", "m", env=env)

    assert ("--bare" in argv) is bare


def test_build_argv_honors_a_custom_binary(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    argv = ClaudeAdapter().build_argv("codex", "prompt", "gpt-5")

    assert argv[0] == "codex"


@pytest.mark.parametrize(
    ("adapter", "binary", "model", "expected"),
    [
        (CodexAdapter, "codex", "gpt-5.6",
         ["codex", "exec", "--model", "gpt-5.6", "--sandbox", "workspace-write", "--json",
          "do the thing"]),
        (KimiAdapter, "kimi", "kimi-k2",
         ["kimi", "--prompt", "do the thing", "--model", "kimi-k2", "--output-format",
          "stream-json"]),
        (GeminiAdapter, "gemini", "gemini-2.5-pro",
         ["gemini", "--prompt", "do the thing", "--model", "gemini-2.5-pro", "--yolo",
          "--output-format", "stream-json"]),
    ],
)
def test_build_argv_runs_unattended(adapter, binary, model, expected):
    assert adapter().build_argv(binary, "do the thing", model) == expected


@pytest.mark.parametrize(
    ("cls", "raw", "expected"),
    [
        (ClaudeAdapter, '{"type": "result", "is_error": false, "duration_api_ms": 2000}',
         ["✓ done in 2s"]),
        (ClaudeAdapter, '{"type": "system"}', []),
        (CodexAdapter,
         '{"type": "item.completed", "item": {"type": "agent_message", "text": "hello"}}',
         ["hello"]),
        (CodexAdapter,
         '{"type": "item.completed", "item": {"type": "command_execution"}}',
         ["⏺ command_execution"]),
        (CodexAdapter, '{"type": "turn.completed"}', ["✓ done"]),
        (CodexAdapter, '{"type": "turn.failed", "message": "boom"}', ["✗ boom"]),
        (CodexAdapter,
         '{"type": "item.completed", "item": {"type": "error", "message": "Model metadata."}}',
         ["  ↳ error: Model metadata."]),
        (CodexAdapter, '{"type": "thread.started"}', []),
        (KimiAdapter, '{"role": "assistant", "content": "hello"}', ["hello"]),
        (KimiAdapter,
         '{"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "grep"}}]}',
         ["⏺ grep"]),
        (KimiAdapter, '{"role": "tool", "is_error": true, "content": "not found"}',
         ["  ↳ error: not found"]),
        (KimiAdapter, '{"role": "tool", "content": "ok"}', []),
        (GeminiAdapter, '{"type": "message", "role": "assistant", "content": "hello"}',
         ["hello"]),
        (GeminiAdapter, '{"type": "message", "role": "user", "content": "hi"}', []),
        (GeminiAdapter, '{"type": "tool_use", "tool_name": "read_file"}', ["⏺ read_file"]),
        (GeminiAdapter,
         '{"type": "tool_result", "status": "error", "error": {"message": "nope"}}',
         ["  ↳ error: nope"]),
        (GeminiAdapter, '{"type": "result", "status": "success"}', ["✓ done"]),
        (GeminiAdapter, '{"type": "result", "status": "error"}', ["✗ failed"]),
        (GeminiAdapter, '{"type": "init"}', []),
    ],
)
def test_parse_line_renders_events(cls, raw, expected, tmp_path: Path):
    assert cls().parse_line(raw, tmp_path) == expected
