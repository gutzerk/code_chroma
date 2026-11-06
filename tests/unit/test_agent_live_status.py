"""Hook-to-status mapping, done/unread, permissions and exit errors (C#: AgentStatusStateTests)."""

from __future__ import annotations

import asyncio
import io
import json
import os
import re
import sys
from datetime import UTC, datetime, timedelta

import pytest

from codechroma.bridge.agents import agent_hook
from codechroma.bridge.agents.live_status import AgentStatusState, hook_target
from codechroma.bridge.agents.session_ownership import hook_document
from codechroma.bridge.agents.sessions import AgentSession

T0 = datetime(2026, 11, 5, 10, 0, 0, tzinfo=UTC)


class _Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        return self.now


def _state() -> tuple[AgentStatusState, _Clock]:
    clock = _Clock()
    return AgentStatusState(clock), clock


def _hook(name: str, tool: str | None = None, tool_input=None, notification=None) -> dict:
    return {
        "hook_event_name": name, "tool_name": tool, "tool_input": tool_input,
        "notification_type": notification,
    }


def test_a_prompt_starts_a_working_turn_with_no_tool_yet():
    state, _ = _state()

    outcome = state.apply_hook(_hook("UserPromptSubmit"))

    snapshot = state.snapshot()
    assert outcome.changed
    assert (snapshot.status, snapshot.activity.tool, snapshot.activity.turn_started_at) == (
        "working", None, T0,
    )


def test_a_tool_call_names_the_tool_and_target_and_keeps_the_turn_start():
    state, clock = _state()
    state.apply_hook(_hook("UserPromptSubmit"))
    clock.now = T0 + timedelta(seconds=30)

    state.apply_hook(_hook("PreToolUse", "Edit", {"file_path": "src/guard/policy.ts"}))

    activity = state.snapshot().activity
    assert (activity.tool, activity.target, activity.turn_started_at) == (
        "Edit", "src/guard/policy.ts", T0,
    )


@pytest.mark.parametrize(
    ("key", "value"), [("command", "npm run e2e"), ("pattern", "TODO"), ("url", "https://x.io")]
)
def test_the_target_falls_back_through_command_pattern_and_url(key, value):
    target = hook_target({key: value})

    assert target == value


def test_a_long_multi_line_command_is_one_line_of_at_most_120_chars():
    target = hook_target({"command": "echo a\n" + "x" * 300})

    assert len(target) == 120
    assert target.startswith("echo a xxx")
    assert target.endswith("…")


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        ("permission_prompt", "blocked"), ("elicitation_dialog", "blocked"),
        ("idle_prompt", "working"),
    ],
)
def test_only_permission_and_elicitation_notifications_block(kind, expected):
    state, _ = _state()
    state.apply_hook(_hook("UserPromptSubmit"))

    state.apply_hook(_hook("Notification", notification=kind))

    assert state.snapshot().status == expected


def test_stop_is_done_until_seen_then_idle():
    state, _ = _state()
    state.apply_hook(_hook("UserPromptSubmit"))
    state.apply_hook(_hook("Stop"))
    done = state.snapshot()

    seen = state.mark_seen()

    assert (done.status, done.activity) == ("done", None)
    assert seen
    assert state.snapshot().status == "idle"


def test_a_permission_request_blocks_and_hands_the_decision_to_the_waiting_hook():
    state, _ = _state()
    outcome = state.apply_hook(_hook("PermissionRequest", "Bash", {"command": "npm run e2e"}))
    pending = state.snapshot().pending

    accepted = state.decide(outcome.request_id, "allow")

    assert (state.snapshot().status, pending.tool, pending.summary) == (
        "working", "Bash", "Bash(npm run e2e)",
    )
    assert re.fullmatch(r"p_[0-9a-f]{6}", pending.request_id)
    assert accepted
    assert outcome.decision.result(timeout=1) == "allow"
    assert state.snapshot().pending is None


def test_an_unknown_request_id_is_not_decided():
    state, _ = _state()
    state.apply_hook(_hook("PermissionRequest", "Bash"))

    accepted = state.decide("p_000000", "allow")

    assert not accepted
    assert state.snapshot().pending is not None


def test_a_parallel_tools_hooks_leave_another_tools_pending_request_waiting():
    state, _ = _state()
    outcome = state.apply_hook(_hook("PermissionRequest", "Bash"))

    state.apply_hook(_hook("PreToolUse", "Read"))
    state.apply_hook(_hook("PostToolUse", "Read"))

    pending = state.snapshot().pending
    assert (state.snapshot().status, pending and pending.request_id) == (
        "blocked", outcome.request_id,
    )
    assert not outcome.decision.done()


def test_a_settled_visible_idle_prompt_ends_a_turn_that_never_sent_stop():
    state, _ = _state()
    state.apply_hook(_hook("PreToolUse", "Bash"))

    changed = state.apply_screen("idle", visible_blocker=False, visible_idle=True)

    assert changed
    assert (state.snapshot().status, state.snapshot().activity) == ("done", None)


def test_a_visible_idle_prompt_does_not_end_a_turn_while_a_canvas_request_waits():
    state, _ = _state()
    state.apply_hook(_hook("PermissionRequest", "Bash"))

    changed = state.apply_screen("idle", visible_blocker=False, visible_idle=True)

    assert not changed
    assert state.snapshot().status == "blocked"


def test_an_expired_request_leaves_the_agent_blocked_without_a_pending_request():
    state, _ = _state()
    outcome = state.apply_hook(_hook("PermissionRequest", "Bash"))

    expired = state.expire(outcome.request_id)

    assert expired
    assert (state.snapshot().status, state.snapshot().pending) == ("blocked", None)


def test_before_any_hook_the_screen_decides_and_working_to_idle_is_done():
    state, _ = _state()
    state.apply_screen("working", visible_blocker=False)

    state.apply_screen("idle", visible_blocker=False)

    assert state.snapshot().status == "done"


def test_once_hooks_report_the_screen_no_longer_sets_working_or_idle():
    state, _ = _state()
    state.apply_hook(_hook("UserPromptSubmit"))

    changed = state.apply_screen("idle", visible_blocker=False)

    assert not changed
    assert state.snapshot().status == "working"


def test_once_hooks_report_a_visible_blocker_still_blocks_and_its_end_resumes_work():
    state, _ = _state()
    state.apply_hook(_hook("UserPromptSubmit"))
    state.apply_screen(None, visible_blocker=True)
    blocked = state.snapshot().status

    state.apply_screen(None, visible_blocker=False)

    assert (blocked, state.snapshot().status) == ("blocked", "working")


def test_status_since_moves_only_when_the_status_changes():
    state, clock = _state()
    state.apply_hook(_hook("UserPromptSubmit"))
    clock.now = T0 + timedelta(minutes=1)
    state.apply_hook(_hook("PreToolUse", "Read"))
    unchanged = state.snapshot().since
    clock.now = T0 + timedelta(minutes=2)

    state.apply_hook(_hook("Stop"))

    assert (unchanged, state.snapshot().since) == (T0, T0 + timedelta(minutes=2))


def test_an_unknown_event_changes_nothing_and_does_not_take_over_from_the_screen():
    state, _ = _state()

    outcome = state.apply_hook(_hook("SessionStart"))

    assert not outcome.changed
    assert not state.hooked


@pytest.mark.skipif(os.name == "nt", reason="POSIX exit codes through a PTY")
@pytest.mark.parametrize(("code", "status"), [(3, "error"), (0, "stopped")])
def test_an_exit_is_reported_at_once_and_only_a_non_zero_one_is_an_error(code, status):
    async def run() -> tuple[list[str], str, str | None]:
        exited: list[str] = []
        session = AgentSession(
            "runner", [sys.executable, "-c", f"raise SystemExit({code})"], cwd=".",
            on_exit=lambda s: exited.append(s.agent_id),
        )
        for _ in range(400):
            if exited:
                break
            await asyncio.sleep(0.025)
        error = session.snapshot().error
        return exited, session.status, error and error.message

    exited, reported, message = asyncio.run(run())

    assert exited == ["runner"]
    assert reported == status
    assert (message is not None) == (code != 0)


def _run_hook(monkeypatch, stdin: str, reply: str | None) -> tuple[int, str, list]:
    monkeypatch.setenv("CODECHROMA_BRIDGE_URL", "http://127.0.0.1:9/")
    monkeypatch.setenv("CODECHROMA_QUESTION_TOKEN", "agent1.sig")
    monkeypatch.setenv("CODECHROMA_WORKSPACE_ID", "agent1")
    posts: list = []
    output = io.StringIO()

    def sender(url, token, body, timeout):
        posts.append((url, token, body, timeout))
        return reply

    code = agent_hook.run(io.StringIO(stdin), output, sender)
    return code, output.getvalue(), posts


def test_the_hook_posts_the_report_to_the_agents_route_with_its_token(monkeypatch):
    stdin = '{"hook_event_name":"Stop"}'

    code, output, posts = _run_hook(monkeypatch, stdin, '{"ok":true}')

    assert (code, output) == (0, "")
    assert posts == [(
        "http://127.0.0.1:9/agents/agent1/hook", "agent1.sig", stdin,
        agent_hook.POST_TIMEOUT_SECONDS,
    )]


def test_the_hook_posts_only_what_the_bridge_reads_never_the_tool_response(monkeypatch):
    stdin = json.dumps({
        "hook_event_name": "PostToolUse", "session_id": "s", "tool_name": "Read",
        "tool_input": {"file_path": "a.cs", "limit": 5}, "tool_response": {"content": "file"},
    })

    _, _, posts = _run_hook(monkeypatch, stdin, '{"ok":true}')

    assert posts[0][2] == (
        '{"hook_event_name":"PostToolUse","tool_name":"Read","tool_input":{"file_path":"a.cs"}}'
    )


@pytest.mark.parametrize("decision", ["allow", "deny"])
def test_a_decided_permission_request_prints_claudes_decision(monkeypatch, decision):
    _, output, _ = _run_hook(
        monkeypatch, '{"hook_event_name":"PermissionRequest"}', json.dumps({"decision": decision})
    )

    printed = json.loads(output)["hookSpecificOutput"]
    assert printed == {"hookEventName": "PermissionRequest", "decision": {"behavior": decision}}


@pytest.mark.parametrize("reply", ['{"decision":null}', None, "not json"])
def test_an_undecided_or_failed_permission_request_prints_nothing(monkeypatch, reply):
    code, output, _ = _run_hook(monkeypatch, '{"hook_event_name":"PermissionRequest"}', reply)

    assert (code, output) == (0, "")


def test_the_hook_without_its_env_posts_nothing(monkeypatch):
    for name in ("CODECHROMA_QUESTION_TOKEN", "codechroma_QUESTION_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CODECHROMA_BRIDGE_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("CODECHROMA_WORKSPACE_ID", "agent1")

    code = agent_hook.run(io.StringIO("{}"), io.StringIO(), lambda *_: pytest.fail("posted"))

    assert code == 0


def test_status_hooks_register_every_event_with_a_tool_matcher_where_claude_takes_one():
    hooks = hook_document(session_tracking=False, status_hooks=True)["hooks"]

    assert set(hooks) == {*agent_hook.EVENTS, "SessionStart"}
    assert all(hooks[n][0]["hooks"][0]["command"].endswith("agent_hook.py") for n in hooks)
    assert hooks["SessionStart"][0]["matcher"] == agent_hook.CLEAR_SOURCE
    assert hooks["PreToolUse"][0]["matcher"] == "*"
    assert "matcher" not in hooks["Stop"][0]
