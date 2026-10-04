"""SkillAgent's run_body hook (058): dispatch, snapshot/restore/validate, multi-proc cancel."""

import asyncio
import json

from codechroma.bridge.skill_agent import SkillAgent

_SETTLE_SECONDS = 0.05


def _stub_claude_on_path(monkeypatch):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )


def _make_agent(*, run_body, timeout_seconds=5):
    def artifact(repo_root, repo_id):
        return repo_root / f"{repo_id}.json"

    return SkillAgent(
        name="wiki_general_agent",
        model="haiku",
        artifact=artifact,
        validate=lambda data: isinstance(data, dict) and data.get("ok") is True,
        timeout_env_var="TEST_RUN_BODY_TIMEOUT_SECONDS",
        default_timeout_seconds=timeout_seconds,
        invalid_error="no valid artifact",
        run_body=run_body,
    )


async def _noop_on_change(_repo_id, _state):
    return None


def test_run_body_success_writes_state_idle(monkeypatch, tmp_path):
    _stub_claude_on_path(monkeypatch)

    async def run_body(agent, workspace, repo_id, on_output):
        (tmp_path / f"{repo_id}.json").write_text(json.dumps({"ok": True}))
        return {"state": "idle", "error": None}

    agent = _make_agent(run_body=run_body)

    async def drive():
        await agent.start("job-a", tmp_path, _noop_on_change)
        await asyncio.sleep(_SETTLE_SECONDS)
        return agent.get_state("job-a")

    state = asyncio.run(drive())

    assert state == {"state": "idle", "error": None}


def test_run_body_failure_restores_prior_artifact(monkeypatch, tmp_path):
    _stub_claude_on_path(monkeypatch)
    artifact_path = tmp_path / "job-a.json"
    artifact_path.write_text(json.dumps({"ok": True, "prior": True}))

    async def run_body(agent, workspace, repo_id, on_output):
        artifact_path.write_text(json.dumps({"ok": False, "half-written": True}))
        return {"state": "error", "error": "job failed"}

    agent = _make_agent(run_body=run_body)

    async def drive():
        await agent.start("job-a", tmp_path, _noop_on_change)
        await asyncio.sleep(_SETTLE_SECONDS)
        return agent.get_state("job-a")

    state = asyncio.run(drive())

    assert state == {"state": "error", "error": "job failed"}
    assert json.loads(artifact_path.read_text()) == {"ok": True, "prior": True}


def test_run_body_result_missing_valid_artifact_is_reported_as_invalid(monkeypatch, tmp_path):
    _stub_claude_on_path(monkeypatch)

    async def run_body(agent, workspace, repo_id, on_output):
        return {"state": "idle", "error": None}

    agent = _make_agent(run_body=run_body)

    async def drive():
        await agent.start("job-a", tmp_path, _noop_on_change)
        await asyncio.sleep(_SETTLE_SECONDS)
        return agent.get_state("job-a")

    state = asyncio.run(drive())

    assert state == {"state": "error", "error": "no valid artifact"}


def test_stop_kills_every_registered_job_proc(monkeypatch, tmp_path):
    _stub_claude_on_path(monkeypatch)
    killed: list[str] = []

    class _FakeProc:
        def __init__(self, tag):
            self.tag = tag
            self.returncode = None

        def kill(self):
            killed.append(self.tag)
            self.returncode = -9

        async def wait(self):
            return self.returncode

    async def run_body(agent, workspace, repo_id, on_output):
        agent.register_job_proc(repo_id, _FakeProc("a"))
        agent.register_job_proc(repo_id, _FakeProc("b"))
        await asyncio.sleep(10)
        return {"state": "idle", "error": None}

    agent = _make_agent(run_body=run_body)

    async def drive():
        await agent.start("job-a", tmp_path, _noop_on_change)
        await asyncio.sleep(_SETTLE_SECONDS)
        await agent.stop("job-a")

    asyncio.run(drive())

    assert sorted(killed) == ["a", "b"]
