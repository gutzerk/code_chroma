"""wiki_general_worker.py: argv shape, structured-output parsing, retries, capability gate."""

from __future__ import annotations

import asyncio

import pytest

from codechroma.bridge.wiki_general_worker import (
    UnsupportedAdapterError,
    require_minimal_context_support,
    run_worker_job,
)
from codechroma.llm.cli_adapters import ClaudeAdapter, CodexAdapter
from tests.unit.fake_worker_claude import fake_worker_exec

_SCHEMA = {"type": "object", "properties": {"word": {"type": "string"}}, "required": ["word"]}


class _FakeAgent:
    def __init__(self):
        self.name = "wiki_general_agent"
        self.job_procs: dict[str, set] = {}

    def register_job_proc(self, repo_id, proc) -> None:
        self.job_procs.setdefault(repo_id, set()).add(proc)

    def unregister_job_proc(self, repo_id, proc) -> None:
        self.job_procs.get(repo_id, set()).discard(proc)


def _run(tmp_path):
    return asyncio.run(
        run_worker_job(
            _FakeAgent(), "default", tmp_path, ClaudeAdapter(), "claude", "haiku", "ping",
            _SCHEMA, {},
        )
    )


def test_require_minimal_context_support_accepts_claude_adapter():
    result = require_minimal_context_support(ClaudeAdapter(), "claude")

    assert result is None


def test_require_minimal_context_support_rejects_codex_adapter():
    with pytest.raises(UnsupportedAdapterError, match="codex"):
        require_minimal_context_support(CodexAdapter(), "codex")


def _pong(_prompt, _required):
    return {"word": "pong"}


def test_run_worker_job_returns_structured_output_on_success(monkeypatch, tmp_path):
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_worker_exec(_pong))

    result = _run(tmp_path)

    assert result.ok
    assert result.data == {"word": "pong"}


def test_run_worker_job_passes_env_overrides_to_the_subprocess(monkeypatch, tmp_path):
    seen_envs = []
    fake_exec = fake_worker_exec(_pong)

    async def _exec(*args, **kwargs):
        seen_envs.append(kwargs.get("env"))
        return await fake_exec(*args, **kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _exec)

    result = asyncio.run(
        run_worker_job(
            _FakeAgent(), "default", tmp_path, ClaudeAdapter(), "claude", "haiku", "ping",
            _SCHEMA, {"ANTHROPIC_BASE_URL": "https://proxy.example.com"},
        )
    )

    assert result.ok
    assert seen_envs[0]["ANTHROPIC_BASE_URL"] == "https://proxy.example.com"


def test_run_worker_job_retries_then_succeeds(monkeypatch, tmp_path):
    attempts = {"n": 0}

    def fail_when(prompt, required):
        attempts["n"] += 1
        return attempts["n"] == 1

    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", fake_worker_exec(_pong, fail_when=fail_when)
    )

    result = _run(tmp_path)

    assert result.ok
    assert attempts["n"] == 2


def _always_fail(_prompt, _required):
    return True


def test_run_worker_job_gives_up_after_max_retries(monkeypatch, tmp_path):
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", fake_worker_exec(_pong, fail_when=_always_fail)
    )

    result = _run(tmp_path)

    assert not result.ok
    assert result.error == "boom"


def test_run_worker_job_prefers_the_stdout_envelopes_message_over_stderr_noise(
    monkeypatch, tmp_path
):
    """A readable API error in stdout's envelope beats an unrelated stderr banner."""
    import json

    from tests.unit.fake_worker_claude import FakeWorkerProc

    envelope = {"is_error": True, "result": "API Error: SSL certificate verification failed"}

    async def _exec(*_argv, **_kwargs):
        return FakeWorkerProc(
            stdout=json.dumps(envelope).encode(),
            stderr=b'[claude-code:unrecognized_model] {"model":"deepseek-v4-flash"}',
            returncode=1,
        )

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _exec)

    result = _run(tmp_path)

    assert not result.ok
    assert result.error == "API Error: SSL certificate verification failed"


class _HangingProc:
    """A subprocess that never exits on its own -- only an explicit kill() ends it."""

    def __init__(self, killed: list[bool]):
        self.returncode = None
        self._killed = killed

    async def communicate(self):
        await asyncio.sleep(10)
        return b"", b""

    def kill(self) -> None:
        self._killed.append(True)
        self.returncode = -9

    async def wait(self):
        return self.returncode


def test_external_cancellation_kills_and_unregisters_the_subprocess(monkeypatch, tmp_path):
    """The pipeline's own overall timeout cancels a job from outside -- must not leak the proc."""
    killed: list[bool] = []
    agent = _FakeAgent()

    async def _exec(*_argv, **_kwargs):
        return _HangingProc(killed)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _exec)

    async def drive():
        task = asyncio.create_task(
            run_worker_job(
                agent, "default", tmp_path, ClaudeAdapter(), "claude", "haiku", "ping",
                _SCHEMA, {},
            )
        )
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())

    assert killed == [True]
    assert agent.job_procs.get("default", set()) == set()
