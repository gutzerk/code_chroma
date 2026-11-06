"""Clearing a CLI's conversation drops the agent window's history at once, detected per provider."""

import asyncio

import pytest

from codechroma.bridge.agents import agent_hook
from codechroma.bridge.agents.history_clear import (
    CLEAR_SCROLLBACK,
    ClearWatch,
    TypedLine,
    clear_watch_for,
)
from codechroma.bridge.agents.session_ownership import hook_document
from codechroma.bridge.agents.sessions import AgentSession
from codechroma.llm.cli_adapters import CLI_ADAPTERS
from codechroma.terminal.agents import PromptContext, agent_launch
from tests.unit.portable_commands import ECHO


def _sent_after(action, clear: ClearWatch | None) -> tuple[str, list[str]]:
    """Everything an attached window receives after `action(session)`, and the cleared callbacks."""

    async def run() -> tuple[str, list[str]]:
        cleared: list[str] = []
        session = AgentSession(
            "runner", ECHO, cwd=".", clear=clear, on_clear=lambda s: cleared.append(s.agent_id)
        )
        queue = session.attach()
        queue.get_nowait()
        action(session)
        session.close()
        chunks = []
        while not queue.empty():
            chunk = queue.get_nowait()
            if chunk is not None:
                chunks.append(chunk)
        return "".join(chunks), cleared

    return asyncio.run(run())


def test_a_clear_reported_by_claudes_session_start_hook_erases_the_windows_scrollback():
    report = {"hook_event_name": "SessionStart", "source": "clear"}

    sent, cleared = _sent_after(lambda s: s.apply_hook(report), ClearWatch((), None))

    assert CLEAR_SCROLLBACK in sent
    assert cleared == ["runner"]


def test_a_resume_session_start_keeps_the_history():
    report = {"hook_event_name": "SessionStart", "source": "resume"}

    sent, cleared = _sent_after(lambda s: s.apply_hook(report), ClearWatch((), None))

    assert CLEAR_SCROLLBACK not in sent
    assert cleared == []


def test_a_typed_clear_command_clears_a_cli_without_a_clear_hook():
    def type_new(session: AgentSession) -> None:
        for key in "/new\r":
            session.write(key)

    sent, cleared = _sent_after(type_new, ClearWatch(("/clear", "/new"), None))

    assert CLEAR_SCROLLBACK in sent
    assert cleared == ["runner"]


def test_ordinary_typed_lines_keep_the_history():
    sent, cleared = _sent_after(
        lambda s: s.write("/newer idea\r\x1b[A\r"), ClearWatch(("/clear", "/new"), None)
    )

    assert CLEAR_SCROLLBACK not in sent
    assert cleared == []


@pytest.mark.parametrize(
    ("keys", "cleared"),
    [
        ("/clear\r", True),
        ("  /clear  \r", True),
        ("/clear my-name\r", True),
        ("/clx\x7fear\r", True),
        ("\x1b[200~/clear\x1b[201~\r", True),
        ("/clearer\r", False),
        ("please /clear\r", False),
        ("/cl\t\r", False),
        ("/clear\x1b[D\r", False),
        ("/clear\x15\r", False),
        ("/clear", False),
        ("\n/clear\r", False),
        ("draft\n/clear\r", False),
        ("\x1b[200~/clear\r\x1b[201~", False),
        ("\x1b[200~x\n/clear\x1b[201~\r", False),
    ],
)
def test_the_typed_detector_matches_only_a_submitted_clear_command(keys, cleared):
    detector = TypedLine(("/clear",))

    matched = any([detector.feed(key) for key in keys])

    assert matched == cleared


def test_text_the_bridge_types_never_reads_as_a_clear_command():
    detector = TypedLine(("/clear",))
    detector.feed("/clear", injected=True)

    injected = detector.feed("\r")
    detector.feed("\r", injected=True)
    typed_after = detector.feed("/clear\r")

    assert (injected, typed_after) == (False, True)


def test_a_clear_asked_for_mid_escape_sequence_waits_for_the_next_ground_boundary():
    held: list[str] = []

    def clear_mid_sequence(session: AgentSession) -> None:
        session._tap.feed("\x1b[38;2;1")
        session.clear_history()
        held.append(str(session._clear_pending))
        session._on_output("m after", session._spawn)

    sent, cleared = _sent_after(clear_mid_sequence, ClearWatch((), None))

    assert held == ["True"]
    assert sent.index("m after") < sent.index(CLEAR_SCROLLBACK)
    assert cleared == ["runner"]


def test_a_claude_launch_without_status_hooks_types_its_context_and_watches_typed_clears():
    from codechroma.questions.launch import McpEndpoint

    hooked = agent_launch("claude", mcp=McpEndpoint("a", "http://127.0.0.1:8123", "a.sig"))

    unhooked = agent_launch("claude")

    assert (hooked.prompt_context, unhooked.prompt_context) == (
        PromptContext.HIDDEN, PromptContext.TYPED)
    assert unhooked.clear is not None and unhooked.clear.typed_commands
    assert agent_launch("shell").prompt_context == PromptContext.NONE


def test_each_adapter_defines_its_own_clear_commands():
    commands = {key: adapter.clear_commands for key, adapter in CLI_ADAPTERS.items()}

    assert commands == {
        "claude": ("/clear", "/reset", "/new"),
        "codex": ("/clear", "/new"),
        "kimi-cli": ("/new", "/clear"),
        "gemini": ("/clear",),
    }


def test_a_hooked_claude_relies_on_the_hook_and_repaints_with_ctrl_l():
    hooked = clear_watch_for(CLI_ADAPTERS["claude"], hooked=True)

    unhooked = agent_launch("claude").clear

    assert hooked == ClearWatch((), "\f")
    assert unhooked is not None and unhooked.typed_commands == ("/clear", "/reset", "/new")
    assert agent_launch("shell").clear is None


def test_the_status_hooks_register_a_session_start_hook_only_for_clear():
    starts = hook_document(status_hooks=True)["hooks"]["SessionStart"]

    clears = [entry for entry in starts if entry.get("matcher") == agent_hook.CLEAR_SOURCE]

    assert len(clears) == 1
    assert "agent_hook.py" in clears[0]["hooks"][0]["command"]
    assert all(e.get("matcher") is None for e in hook_document()["hooks"]["SessionStart"])


def test_the_hook_keeps_the_session_start_source():
    report = {"hook_event_name": "SessionStart", "source": "clear", "session_id": "s"}

    slim = agent_hook.slim(report)

    assert slim == {"hook_event_name": "SessionStart", "source": "clear"}
    assert agent_hook.is_clear(slim)
