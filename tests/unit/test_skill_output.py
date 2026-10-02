"""Unit tests for render_event, which turns one stream-json event into progress lines."""

from pathlib import Path

import pytest

from codechroma.bridge.skill_output import render_event

REPO = Path("/repo")


def _assistant(*blocks):
    return {"type": "assistant", "message": {"content": list(blocks)}}


def _user(*blocks):
    return {"type": "user", "message": {"content": list(blocks)}}


def _tool_use(name, **tool_input):
    return {"type": "tool_use", "name": name, "input": tool_input}


def test_a_tool_call_renders_as_its_name_and_first_useful_argument():
    event = _assistant(_tool_use("Read", file_path="/repo/src/engine.py"))

    assert render_event(event, REPO) == ["⏺ Read(src/engine.py)"]


@pytest.mark.parametrize(
    ("tool_input", "expected"),
    [
        ({"pattern": "def analyze"}, "⏺ Grep(def analyze)"),
        ({"command": "python check_c1.py"}, "⏺ Grep(python check_c1.py)"),
        ({"path": "src/codechroma"}, "⏺ Grep(src/codechroma)"),
        ({"url": "http://localhost:8000/c1"}, "⏺ Grep(http://localhost:8000/c1)"),
        ({"description": "map the pillars"}, "⏺ Grep(map the pillars)"),
        ({"unknown_key": "ignored"}, "⏺ Grep"),
    ],
    ids=["pattern", "command", "path", "url", "description", "nothing-recognized"],
)
def test_the_argument_shown_is_the_first_recognized_input_key(tool_input, expected):
    event = _assistant(_tool_use("Grep", **tool_input))

    assert render_event(event, REPO) == [expected]


def test_a_path_outside_the_repo_is_left_absolute():
    event = _assistant(_tool_use("Write", file_path="/elsewhere/notes.md"))

    assert render_event(event, REPO) == ["⏺ Write(/elsewhere/notes.md)"]


def test_a_multiline_argument_collapses_to_one_bounded_line():
    event = _assistant(_tool_use("Bash", command="python check.py \\\n  --strict\n"))

    assert render_event(event, REPO) == ["⏺ Bash(python check.py \\ --strict)"]


def test_an_overlong_argument_is_truncated_with_an_ellipsis():
    event = _assistant(_tool_use("Bash", command="x" * 500))

    assert render_event(event, REPO) == [f"⏺ Bash({'x' * 99}…)"]


def test_assistant_prose_keeps_its_line_breaks_but_drops_blank_runs():
    event = _assistant({"type": "text", "text": "Mapping the boundary.\n\n\nThen the pillars.\n"})

    assert render_event(event, REPO) == ["Mapping the boundary.", "Then the pillars."]


def test_a_thinking_block_renders_collapsed_to_one_line():
    event = _assistant({"type": "thinking", "thinking": "let me consider the layering"})

    assert render_event(event, REPO) == ["let me consider the layering"]


def test_an_overlong_thinking_block_is_truncated_with_an_ellipsis():
    event = _assistant({"type": "thinking", "thinking": "x" * 500})

    assert render_event(event, REPO) == [f"{'x' * 199}…"]


def test_blank_or_missing_thinking_renders_nothing():
    event = _assistant({"type": "thinking", "thinking": "   "})

    assert render_event(event, REPO) == []


def test_a_successful_tool_result_is_not_repeated_in_the_feed():
    event = _user({"type": "tool_result", "tool_use_id": "x", "content": "1\thello"})

    assert render_event(event, REPO) == []


def test_a_failed_tool_result_is_reported_as_one_indented_line():
    event = _user({"type": "tool_result", "is_error": True, "content": "Traceback...\nboom"})

    assert render_event(event, REPO) == ["  ↳ error: Traceback... boom"]


def test_a_failed_tool_result_reads_text_out_of_block_content():
    blocks = [{"type": "text", "text": "no such file"}]
    event = _user({"type": "tool_result", "is_error": True, "content": blocks})

    assert render_event(event, REPO) == ["  ↳ error: no such file"]


def test_the_final_result_reports_how_long_the_run_took():
    event = {"type": "result", "is_error": False, "duration_api_ms": 5279}

    assert render_event(event, REPO) == ["✓ done in 5s"]


def test_a_result_without_a_duration_still_reports_completion():
    event = {"type": "result", "is_error": False}

    assert render_event(event, REPO) == ["✓ done"]


def test_a_failed_result_names_its_subtype_when_there_is_no_readable_message():
    event = {"type": "result", "is_error": True, "subtype": "error_max_turns"}

    assert render_event(event, REPO) == ["✗ error_max_turns"]


def test_a_failed_result_prefers_its_readable_message_over_subtype():
    event = {
        "type": "result", "is_error": True, "subtype": "success",
        "result": "API Error: SSL certificate verification failed",
    }

    assert render_event(event, REPO) == ["✗ API Error: SSL certificate verification failed"]


@pytest.mark.parametrize(
    "event",
    [
        {"type": "system", "subtype": "thinking_tokens", "estimated_tokens": 42},
        {"type": "system", "subtype": "init", "tools": ["Bash"]},
        {"type": "system", "subtype": "hook_started", "hook_name": "SessionStart"},
        {"type": "rate_limit_event", "rate_limit_info": {"status": "allowed"}},
        {"type": "stream_event", "event": {}},
    ],
    ids=["thinking-tokens", "init", "hook", "rate-limit", "unknown-type"],
)
def test_the_noise_the_cli_emits_renders_nothing(event):
    assert render_event(event, REPO) == []


@pytest.mark.parametrize(
    "event",
    [
        "not-a-dict",
        None,
        {},
        {"type": "assistant"},
        {"type": "assistant", "message": "not-a-dict"},
        {"type": "assistant", "message": {"content": ["not-a-block"]}},
        {"type": "user", "message": {"content": None}},
    ],
    ids=["string", "none", "empty", "no-message", "bad-message", "bad-block", "no-content"],
)
def test_a_malformed_event_renders_nothing_rather_than_raising(event):
    assert render_event(event, REPO) == []


def test_string_message_content_is_treated_as_text():
    event = {"type": "assistant", "message": {"content": "Done mapping."}}

    assert render_event(event, REPO) == ["Done mapping."]
