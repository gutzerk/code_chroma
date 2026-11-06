"""A wider window restarts an idle claude agent with --resume (C# WidenResumeTests.cs)."""

import asyncio
import sys
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from codechroma.bridge.agents import widen_resume
from codechroma.bridge.agents.history_clear import RESET_SCREEN
from codechroma.bridge.agents.session_ownership import FILE_ENV
from codechroma.bridge.agents.sessions import AgentSession, AgentSessionRegistry
from codechroma.io import utc_now
from codechroma.terminal.agents import AgentLaunch

TRACKED = {FILE_ENV: "owned.json"}
STOP = {"hook_event_name": "Stop"}


def _printer(text: str) -> list[str]:
    return [sys.executable, "-c", f"import time; print({text!r}, flush=True); time.sleep(30)"]


def _later():
    return utc_now() + timedelta(seconds=10)


async def _wait_for(session: AgentSession, text: str) -> None:
    for _ in range(500):
        if any(text in line for line in session._tap.tail(200)):
            return
        await asyncio.sleep(0.02)
    raise TimeoutError(text)


async def _idle_at_120(argv=None, env=TRACKED) -> AgentSession:
    session = AgentSession("agent", argv or _printer("printed"), cwd=".", env=dict(env or {}))
    await _wait_for(session, "printed")
    session.apply_hook(dict(STOP))
    return session


def _due_after(cols: int, before=None, argv=None, env=TRACKED) -> bool:
    async def run() -> bool:
        session = await _idle_at_120(argv, env)
        if before is not None:
            before(session)
        session.resize(30, cols)
        due = session.widen_due(_later())
        session.close()
        return due

    return asyncio.run(run())


def test_widening_an_idle_agent_past_its_printed_width_is_due_once_the_resize_settles():
    async def run() -> tuple[bool, bool]:
        session = await _idle_at_120()
        session.resize(30, 160)
        result = (session.widen_due(utc_now()), session.widen_due(_later()))
        session.close()
        return result

    assert asyncio.run(run()) == (False, True)


@pytest.mark.parametrize("cols", [124, 100])
def test_a_small_widening_or_a_narrowing_is_never_due(cols):
    assert not _due_after(cols)


def test_a_busy_agent_is_not_due():
    busy = _due_after(160, before=lambda s: s.apply_hook({"hook_event_name": "UserPromptSubmit"}))

    assert not busy


def test_a_draft_in_the_prompt_holds_the_widen():
    drafting = _due_after(160, before=lambda s: s._note_typing("half typed"))

    assert not drafting


def test_a_sent_message_is_no_draft():
    sent = _due_after(160, before=lambda s: s._note_typing("done\r"))

    assert sent


@pytest.mark.parametrize("argv, env", [
    (None, {}),
    ([*_printer("printed"), "--system-prompt", "skill"], TRACKED),
])
def test_untracked_or_bare_launches_never_resume_on_widen(argv, env):
    assert not _due_after(160, argv=argv, env=env)


def test_respawn_clears_the_old_screen_and_streams_the_new_process():
    async def run():
        exited: list[str] = []
        session = AgentSession(
            "agent", _printer("first run"), cwd=".", on_exit=lambda s: exited.append(s.agent_id)
        )
        await _wait_for(session, "first run")
        window = session.attach()
        window.get_nowait()
        session.resize(30, 160)
        respawned = session.respawn(_printer("second run"), ".", None)
        await _wait_for(session, "second run")
        await asyncio.sleep(0.2)
        streamed = []
        while not window.empty():
            streamed.append(window.get_nowait())
        text = "".join(c for c in streamed if c is not None)
        result = (respawned, session.is_alive, list(exited), session._tap.tail(200), text)
        session.close()
        return result

    respawned, alive, exited, screen, text = asyncio.run(run())

    assert (respawned, alive, exited) == (True, True, [])
    assert not any("first run" in line for line in screen)
    assert text.index(RESET_SCREEN) < text.index("second run")


class _Agents:
    """The slice of AgentManager the coordinator uses, recording each call."""

    main_root = Path(".")

    def __init__(self, session_id: str | None) -> None:
        self.record = SimpleNamespace(kind="claude", worktree=".", worktree_lost=False)
        self.session_id = session_id
        self.calls: list[str] = []

    def get(self, agent_id):
        return self.record

    def capture_session_id(self, agent_id):
        return self.session_id

    def mark_started(self, agent_id, pid, resolved_cli=""):
        self.calls.append("mark_started")

    def record_session_launch(self, agent_id, session):
        self.calls.append("record_session_launch")


def _sweep(monkeypatch, tmp_path, asking=False, transcript=True):
    launched: list[list[str]] = []

    def fake_launch(kind, session_id, **kwargs):
        argv = [*_printer("resumed"), "--resume", session_id]
        launched.append(argv)
        return AgentLaunch(argv, {FILE_ENV: str(kwargs["session_tracking_file"])}, "claude")

    monkeypatch.setattr(widen_resume, "agent_launch", fake_launch)
    if transcript:
        (tmp_path / "p").mkdir()
        (tmp_path / "p" / "sid.jsonl").write_text("{}\n")
    agents = _Agents("sid")

    async def run():
        sessions = AgentSessionRegistry()
        session = sessions.start("agent", _printer("printed"), Path("."), env=dict(TRACKED))
        await _wait_for(session, "printed")
        session.apply_hook(dict(STOP))
        session.resize(30, 160)
        widen = widen_resume.WidenResume(agents, sessions, lambda _id: asking, None, tmp_path)
        resumed = widen.sweep(_later())
        if resumed:
            await _wait_for(session, "resumed")
        tracking = session.session_tracking_file
        sessions.stop_all()
        return resumed, tracking

    resumed, tracking = asyncio.run(run())
    return resumed, tracking, launched, agents.calls


def test_a_due_agent_is_resumed_in_place_with_a_new_tracking_file(monkeypatch, tmp_path):
    resumed, tracking, launched, calls = _sweep(monkeypatch, tmp_path)

    assert resumed == ["agent"]
    assert launched[0][-2:] == ["--resume", "sid"]
    assert tracking != "owned.json"
    assert calls == ["mark_started", "record_session_launch"]


@pytest.mark.parametrize("asking, transcript", [(True, True), (False, False)])
def test_an_open_question_or_a_missing_transcript_leaves_the_agent_running(
    monkeypatch, tmp_path, asking, transcript
):
    resumed, tracking, launched, calls = _sweep(monkeypatch, tmp_path, asking, transcript)

    assert (resumed, tracking, launched, calls) == ([], "owned.json", [], [])
