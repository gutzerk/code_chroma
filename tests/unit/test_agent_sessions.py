"""AgentSession reattach: a redraw of the rendered screen, never a replay of the raw byte stream."""

import asyncio

from codechroma.bridge.agents.sessions import AgentSession, AgentSessionPort, agent_run_env
from tests.unit.portable_commands import ECHO


def _attach_frame(stream: str) -> str:
    """The first frame a reattaching window receives after the agent emitted `stream`."""

    async def run() -> str:
        session = AgentSession("runner", ECHO, cwd=".")
        session._on_output(stream)
        queue = session.attach()
        session.close()
        return queue.get_nowait()

    return asyncio.run(run())


def test_attaching_sends_a_redraw_of_the_screen_not_the_escape_sequences_that_drew_it():
    frame = _attach_frame("\x1b[?1049h\x1b[2Jinside the alt screen")

    assert "inside the alt screen" in frame
    assert "\x1b[?1049h" not in frame


def test_a_repainted_screen_reattaches_without_the_text_the_repaint_erased():
    frame = _attach_frame("stale banner\r\n\x1b[H\x1b[2Jcurrent prompt")

    assert "current prompt" in frame
    assert "stale banner" not in frame


def test_resyncing_an_unknown_queue_is_a_no_op_rather_than_an_error():
    async def run() -> int:
        session = AgentSession("runner", ECHO, cwd=".")
        stranger: asyncio.Queue = asyncio.Queue()
        session.resync(stranger)
        session.close()
        return stranger.qsize()

    assert asyncio.run(run()) == 0


def test_agent_session_satisfies_the_terminal_port():
    async def run() -> bool:
        session = AgentSession("runner", ECHO, cwd=".")
        result = isinstance(session, AgentSessionPort)
        session.close()
        return result

    assert asyncio.run(run())


def test_agent_run_env_points_the_skills_at_the_agents_own_workspace():
    env = agent_run_env("agent1-2")

    assert env == {"codechroma_WORKSPACE_ID": "agent1-2"}


class _IdleLater:
    """A controllable detector verdict: not idle yet, then idle once flipped."""

    def __init__(self) -> None:
        self.idle = False

    def __call__(self, tail, title, progress, process) -> str | None:
        return "idle" if self.idle else None


def _make_injecting_session(monkeypatch, classify, written: list[str]):
    """Real AgentSession with detector.classify patched and write() recording into `written`."""
    session = AgentSession("runner", ECHO, cwd=".")
    session.write = written.append
    monkeypatch.setattr(session._detector, "classify", classify)
    return session


def _inject(
    monkeypatch, classify, text: str, attempts: int = 20, interval: float = 0.001, flip=None
) -> list[str]:
    """Drives real AgentSession.inject_when_idle to completion; returns what it wrote."""
    from codechroma.bridge.agents import sessions as sessions_mod

    written: list[str] = []

    async def run() -> list[str]:
        monkeypatch.setattr(sessions_mod, "context_inject_attempts", lambda: attempts)
        monkeypatch.setattr(sessions_mod, "context_inject_interval_seconds", lambda: interval)
        session = _make_injecting_session(monkeypatch, classify, written)
        try:
            if flip is not None:
                await asyncio.gather(session.inject_when_idle(text), flip())
            else:
                await session.inject_when_idle(text)
        finally:
            session.close()
        return list(written)

    return asyncio.run(run())


def test_inject_types_the_context_once_the_agent_classes_as_idle(monkeypatch):
    text = "[Context] you are looking at the C1 diagram"

    written = _inject(monkeypatch, lambda *_: "idle", text)

    assert written == [text + "\r"]


def test_inject_gives_up_without_typing_when_the_agent_never_idles(monkeypatch):
    written = _inject(monkeypatch, lambda *_: None, "hi", attempts=2)

    assert written == []


def test_inject_waits_for_the_agent_to_idle_before_typing(monkeypatch):
    # Detector says not idle at first, then idle shortly after — inject should hold rather than
    # give up before the verdict flips.
    idle = _IdleLater()

    async def flip() -> None:
        await asyncio.sleep(0.0002)
        idle.idle = True

    written = _inject(monkeypatch, idle, "ctx", flip=flip)

    assert written == ["ctx\r"]
