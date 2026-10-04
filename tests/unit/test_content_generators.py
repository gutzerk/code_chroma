"""Unit tests for build_skill_agent_for's background `claude -p` generation job."""


import asyncio
import json

import pytest

from codechroma.bridge import content_generators
from codechroma.diagrams.registry import BUILTIN_TYPES
from tests.unit.fake_claude import CLI_MISSING, fake_claude_exec

# One instance per test module; the autouse fixture clears its state between tests.
AGENT = content_generators.build_skill_agent_for(BUILTIN_TYPES["c1"])

VALID_C1 = {
    "type": "c1",
    "nodes": [{"id": "system", "name": "Sample", "description": ""}],
    "relations": [],
}
TRUNCATED_C1 = '{"nodes": [{"id": "sys'
DRAFT_C1 = {**VALID_C1, "draft": True}

_TEXT_BLOCK = {"type": "text", "text": "skill not found"}
_TEXT_EVENT = {"type": "assistant", "message": {"content": [_TEXT_BLOCK]}}

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


def _c1_path(repo_root):
    return repo_root / BUILTIN_TYPES["c1"].artifact


def _write_c1(repo_root, diagram):
    path = _c1_path(repo_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(diagram))


class _RecordingChange:
    def __init__(self):
        self.calls = []

    async def __call__(self, repo_id, state):
        self.calls.append((repo_id, dict(state)))


def _run_generation(repo_root, on_change=None):
    """Starts a generation and lets its background task settle before returning."""

    async def _drive():
        await AGENT.start("default", repo_root, on_change or _RecordingChange())
        await asyncio.sleep(_SETTLE_SECONDS)

    asyncio.run(_drive())


def test_missing_claude_binary_reports_error_without_spawning(monkeypatch, tmp_path):
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)
    on_change = _RecordingChange()

    result = asyncio.run(AGENT.start("default", tmp_path, on_change))

    assert result == {"state": "error", "error": CLI_MISSING}
    assert AGENT.get_state("default") == result
    assert on_change.calls == [("default", result)]


def test_successful_run_ends_idle(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(returncode=0))
    _write_c1(tmp_path, VALID_C1)
    on_change = _RecordingChange()

    async def _drive():
        started = await AGENT.start("default", tmp_path, on_change)
        assert started == {"state": "generating", "error": None}
        await asyncio.sleep(0.05)

    asyncio.run(_drive())

    assert AGENT.get_state("default") == {"state": "idle", "error": None}
    assert on_change.calls[-1] == ("default", {"state": "idle", "error": None})


def test_runs_claude_with_the_haiku_model(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    captured = []

    def _capturing_factory(*args, **_kwargs):
        captured.extend(args)
        return fake_claude_exec(returncode=0)(*args, **_kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _capturing_factory)

    _run_generation(tmp_path)

    assert "--model" in captured
    assert captured[captured.index("--model") + 1] == "haiku"


def test_timeout_is_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("codechroma_C1_TIMEOUT_SECONDS", "42")

    assert AGENT.timeout_seconds() == 42


def test_timeout_falls_back_to_the_default_when_unset_or_junk(monkeypatch):
    monkeypatch.setenv("codechroma_C1_TIMEOUT_SECONDS", "not-a-number")

    assert AGENT.timeout_seconds() == AGENT.default_timeout_seconds


@pytest.mark.parametrize(
    ("events", "stderr", "expected"),
    [
        ([_TEXT_EVENT], b"boom: skill failed", "boom"),
        ([_TEXT_EVENT], b"", "skill not found"),
        ([], b"", "claude exited 1"),
    ],
    ids=["stderr-preferred", "rendered-lines-fallback", "nothing-to-report"],
)
def test_nonzero_exit_reports_stderr_then_the_progress_lines(
    monkeypatch, tmp_path, events, stderr, expected
):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        fake_claude_exec(returncode=1, events=events, stderr=stderr),
    )

    _run_generation(tmp_path)

    assert expected in AGENT.get_state("default")["error"]


def test_exit_zero_without_a_written_diagram_is_an_error(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(returncode=0))

    _run_generation(tmp_path)

    assert AGENT.get_state("default") == {
        "state": "error",
        "error": "generation produced no valid c1.json",
    }


@pytest.mark.parametrize(
    ("returncode", "stderr"),
    [(1, b"boom"), (0, b"")],
    ids=["nonzero-exit", "clean-exit-but-unparseable"],
)
def test_a_run_that_leaves_no_valid_diagram_restores_the_previous_one(
    monkeypatch, tmp_path, returncode, stderr
):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    _write_c1(tmp_path, VALID_C1)

    truncating_exec = fake_claude_exec(
        returncode=returncode,
        stderr=stderr,
        on_spawn=lambda: _c1_path(tmp_path).write_text(TRUNCATED_C1),
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", truncating_exec)

    _run_generation(tmp_path)

    assert json.loads(_c1_path(tmp_path).read_text()) == VALID_C1


def test_a_run_that_leaves_the_draft_marker_restores_the_previous_one(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    _write_c1(tmp_path, VALID_C1)
    still_draft_exec = fake_claude_exec(
        returncode=0, on_spawn=lambda: _write_c1(tmp_path, DRAFT_C1)
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", still_draft_exec)

    _run_generation(tmp_path)

    assert json.loads(_c1_path(tmp_path).read_text()) == VALID_C1


def test_cancel_all_kills_an_in_flight_run(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    killed = []
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", fake_claude_exec(hang=True, killed=killed)
    )

    async def _drive():
        await AGENT.start("default", tmp_path, _RecordingChange())
        await asyncio.sleep(0.05)
        await AGENT.cancel()

    asyncio.run(_drive())

    assert killed == [True]
    assert AGENT.tasks == {}


def test_second_call_while_generating_does_not_spawn_again(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    spawns = []
    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        fake_claude_exec(hang=True, on_spawn=lambda: spawns.append(True)),
    )
    on_change = _RecordingChange()

    async def _drive():
        first = await AGENT.start("default", tmp_path, on_change)
        await asyncio.sleep(_SETTLE_SECONDS)
        second = await AGENT.start("default", tmp_path, on_change)
        await asyncio.sleep(_SETTLE_SECONDS)
        await AGENT.cancel()
        return first, second

    first, second = asyncio.run(_drive())

    assert first == second == {"state": "generating", "error": None}
    assert spawns == [True]


# --- patterns: same build_skill_agent_for path, a different definition ---

PATTERNS_AGENT = content_generators.build_skill_agent_for(BUILTIN_TYPES["patterns"])


def _patterns_path(repo_root):
    return repo_root / BUILTIN_TYPES["patterns"].artifact


@pytest.fixture(autouse=True)
def _clear_patterns_jobs():
    PATTERNS_AGENT.jobs.clear()
    PATTERNS_AGENT.tasks.clear()
    PATTERNS_AGENT.procs.clear()
    PATTERNS_AGENT.output.clear()
    yield
    PATTERNS_AGENT.jobs.clear()
    PATTERNS_AGENT.tasks.clear()
    PATTERNS_AGENT.procs.clear()
    PATTERNS_AGENT.output.clear()


def test_patterns_invalid_artifact_reports_error_and_restores_snapshot(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    path = _patterns_path(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    valid = {"type": "patterns", "nodes": [], "relations": []}
    path.write_text(json.dumps(valid))
    good_snapshot = path.read_text()

    def _corrupt_then_exit(*_args, **_kwargs):
        path.write_text("not json")
        return fake_claude_exec(returncode=0)(*_args, **_kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _corrupt_then_exit)

    async def _drive():
        await PATTERNS_AGENT.start("default", tmp_path, _RecordingChange())
        await asyncio.sleep(_SETTLE_SECONDS)

    asyncio.run(_drive())

    final_state = PATTERNS_AGENT.get_state("default")
    assert final_state == {"state": "error", "error": "generation produced no valid patterns.json"}
    assert path.read_text() == good_snapshot


# --- impact: prompt_for is the one per-kind wrinkle build_skill_agent_for doesn't cover ---


def test_prompt_for_impact_names_the_sponsor_and_defaults_feature_to_blank():
    prompt = content_generators.prompt_for("impact")("diff", None)

    assert isinstance(prompt, str) and prompt


def test_prompt_for_c1_is_none_its_prompt_is_static():
    assert content_generators.prompt_for("c1") is None
