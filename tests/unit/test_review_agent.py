"""Unit tests for review.py's background `claude -p` change-review job."""

import asyncio
import json

import pytest

from codechroma.bridge import review
from codechroma.bridge.overlays import impact_changes_path
from tests.unit.fake_claude import fake_claude_exec

# One instance per test module; the autouse fixture clears its state between tests.
AGENT = review.REVIEW_AGENT_FACTORIES["impact-changes"]()

VALID_REVIEW = {"fingerprint": "abc", "summary": "Reworked billing.", "blocks": []}
TRUNCATED_REVIEW = '{"fingerprint": "ab'

# Long enough for the fire-and-forget _run task to finish against a fake subprocess.
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


def _write_review(repo_root, review):
    path = impact_changes_path(repo_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(review))


class _RecordingChange:
    def __init__(self):
        self.calls = []

    async def __call__(self, repo_id, state):
        self.calls.append((repo_id, dict(state)))


def _run_review(repo_root, on_change=None):
    """Starts a review and lets its background task settle before returning."""

    async def _drive():
        await AGENT.start("default", repo_root, on_change or _RecordingChange())
        await asyncio.sleep(_SETTLE_SECONDS)

    asyncio.run(_drive())


def test_the_review_writes_beside_the_diagram_not_over_it(tmp_path):
    assert impact_changes_path(tmp_path).name == "impact-changes.json"


def test_a_successful_run_ends_idle(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(returncode=0))
    _write_review(tmp_path, VALID_REVIEW)

    _run_review(tmp_path)

    assert AGENT.get_state("default") == {"state": "idle", "error": None}


def test_exit_zero_without_a_written_review_is_an_error(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(returncode=0))

    _run_review(tmp_path)

    assert AGENT.get_state("default") == {
        "state": "error",
        "error": "review produced no valid impact-changes.json",
    }


def test_a_run_that_leaves_an_unparseable_review_restores_the_previous_one(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    _write_review(tmp_path, VALID_REVIEW)

    truncating_exec = fake_claude_exec(
        returncode=0,
        on_spawn=lambda: impact_changes_path(tmp_path).write_text(TRUNCATED_REVIEW),
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", truncating_exec)

    _run_review(tmp_path)

    assert json.loads(impact_changes_path(tmp_path).read_text()) == VALID_REVIEW


def test_a_second_start_while_one_is_in_flight_is_a_no_op(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    starts = []
    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        fake_claude_exec(hang=True, on_spawn=lambda: starts.append(True)),
    )

    async def _drive():
        on_change = _RecordingChange()
        await AGENT.start("default", tmp_path, on_change)
        await asyncio.sleep(_SETTLE_SECONDS)
        second = await AGENT.start("default", tmp_path, on_change)
        await AGENT.cancel()
        return second

    second = asyncio.run(_drive())

    assert (second["state"], len(starts)) == ("generating", 1)


def test_the_review_timeout_is_read_from_its_own_env_var(monkeypatch):
    monkeypatch.setenv(review.IMPACT_REVIEW_TIMEOUT_ENV_VAR, "77")

    assert AGENT.timeout_seconds() == 77


def test_services_shutdown_covers_the_review_runner(monkeypatch, tmp_path):
    from codechroma.bridge.services import _build_skill_agents

    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    killed = []
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", fake_claude_exec(hang=True, killed=killed)
    )
    agents = _build_skill_agents()

    async def _drive():
        await agents["impact-changes"].start("default", tmp_path, _RecordingChange())
        await asyncio.sleep(_SETTLE_SECONDS)
        for agent in agents.values():
            await agent.cancel()

    asyncio.run(_drive())

    assert killed == [True]
