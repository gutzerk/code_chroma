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


_RENDER_CASES = [
    (_assistant(_tool_use("Write", file_path="/elsewhere/notes.md")),
     ["⏺ Write(/elsewhere/notes.md)"]),
    (_assistant(_tool_use("Bash", command="python check.py \\\n  --strict\n")),
     ["⏺ Bash(python check.py \\ --strict)"]),
    (_assistant(_tool_use("Bash", command="x" * 500)), [f"⏺ Bash({'x' * 99}…)"]),
    (_assistant({"type": "text", "text": "Mapping the boundary.\n\n\nThen the pillars.\n"}),
     ["Mapping the boundary.", "Then the pillars."]),
    (_assistant({"type": "thinking", "thinking": "let me consider the layering"}),
     ["let me consider the layering"]),
    (_assistant({"type": "thinking", "thinking": "x" * 500}), [f"{'x' * 199}…"]),
    (_assistant({"type": "thinking", "thinking": "   "}), []),
    (_user({"type": "tool_result", "tool_use_id": "x", "content": "1\thello"}), []),
    (_user({"type": "tool_result", "is_error": True, "content": "Traceback...\nboom"}),
     ["  ↳ error: Traceback... boom"]),
    (_user({"type": "tool_result", "is_error": True,
            "content": [{"type": "text", "text": "no such file"}]}),
     ["  ↳ error: no such file"]),
    ({"type": "result", "is_error": False, "duration_api_ms": 5279}, ["✓ done in 5s"]),
    ({"type": "result", "is_error": False}, ["✓ done"]),
    ({"type": "result", "is_error": True, "subtype": "error_max_turns"}, ["✗ error_max_turns"]),
    ({"type": "result", "is_error": True, "subtype": "success",
      "result": "API Error: SSL certificate verification failed"},
     ["✗ API Error: SSL certificate verification failed"]),
]


@pytest.mark.parametrize(("event", "expected"), _RENDER_CASES)
def test_render_event_formats_each_event_kind(event, expected):
    assert render_event(event, REPO) == expected


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
