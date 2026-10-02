"""Unit tests for research_agent's per-question background `claude -p` job."""

import asyncio
import json

import pytest

from codechroma.bridge import research_agent, skill_agent
from tests.unit.fake_claude import fake_claude_exec

# One instance per test module; the autouse fixture clears its state between tests.
AGENT = research_agent.build_agent()

VALID_ANSWER = {"query": "q", "answer": "the answer", "citations": [], "degraded": False}

_SETTLE_SECONDS = 0.05


@pytest.fixture(autouse=True)
def _clear_jobs():
    AGENT.jobs.clear()
    AGENT.tasks.clear()
    AGENT.procs.clear()
    AGENT.output.clear()
    yield
    AGENT.jobs.clear()
    AGENT.tasks.clear()
    AGENT.procs.clear()
    AGENT.output.clear()


def _write_answer(repo_root, key, answer):
    path = research_agent.research_answer_path(repo_root, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(answer))


class _RecordingChange:
    def __init__(self):
        self.calls = []

    async def __call__(self, key, state):
        self.calls.append((key, dict(state)))


def test_job_key_embeds_the_workspace_id_and_a_stable_query_hash():
    first = research_agent.job_key("main", "Where is JWT validated?")
    second = research_agent.job_key("main", "where is jwt validated?")

    assert first == second
    assert first.startswith("main:")


def test_different_questions_hash_to_different_job_keys():
    one = research_agent.job_key("main", "question one")

    assert one != research_agent.job_key("main", "question two")


def test_research_answer_path_is_scoped_per_job_key(tmp_path):
    key = research_agent.job_key("main", "a question")

    path = research_agent.research_answer_path(tmp_path, key)

    assert path == research_agent.research_answers_dir(tmp_path) / f"{key.rsplit(':', 1)[-1]}.json"


def test_two_questions_against_the_same_repo_get_independent_artifact_files(tmp_path):
    key_a = research_agent.job_key("main", "question a")
    key_b = research_agent.job_key("main", "question b")
    path_a = research_agent.research_answer_path(tmp_path, key_a)

    assert path_a != research_agent.research_answer_path(tmp_path, key_b)


def test_successful_run_writes_the_prompt_override_not_the_static_prompt(monkeypatch, tmp_path):
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: "/usr/bin/claude")
    captured = []

    def _capturing_factory(*args, **_kwargs):
        captured.extend(args)
        return fake_claude_exec(returncode=0)(*args, **_kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _capturing_factory)
    key = research_agent.job_key("main", "where is jwt validated")
    _write_answer(tmp_path, key, VALID_ANSWER)

    async def _drive():
        await AGENT.start(key, tmp_path, _RecordingChange(), prompt="custom prompt")
        await asyncio.sleep(_SETTLE_SECONDS)

    asyncio.run(_drive())

    assert "custom prompt" in captured
    assert AGENT.get_state(key) == {"state": "idle", "error": None}


def test_exit_zero_without_a_written_answer_is_an_error(monkeypatch, tmp_path):
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: "/usr/bin/claude")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(returncode=0))
    key = research_agent.job_key("main", "a question with no fixture answer")

    async def _drive():
        await AGENT.start(key, tmp_path, _RecordingChange(), prompt="p")
        await asyncio.sleep(_SETTLE_SECONDS)

    asyncio.run(_drive())

    assert AGENT.get_state(key) == {
        "state": "error",
        "error": "synthesis produced no valid answer",
    }


def test_a_concurrent_second_question_does_not_collide_with_the_first(monkeypatch, tmp_path):
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: "/usr/bin/claude")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(hang=True))
    key_a = research_agent.job_key("main", "question a")
    key_b = research_agent.job_key("main", "question b")

    async def _drive():
        first = await AGENT.start(key_a, tmp_path, _RecordingChange(), prompt="a")
        second = await AGENT.start(key_b, tmp_path, _RecordingChange(), prompt="b")
        await asyncio.sleep(_SETTLE_SECONDS)
        await AGENT.cancel()
        return first, second

    first, second = asyncio.run(_drive())

    assert first == second == {"state": "generating", "error": None}
