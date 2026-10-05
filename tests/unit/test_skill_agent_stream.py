"""Unit tests for SkillAgent's live progress stream: the buffer, the batches, and its bounds."""

import asyncio
import json

import pytest

from codechroma.bridge import content_generators, skill_agent
from codechroma.diagrams.registry import BUILTIN_TYPES
from tests.unit.fake_claude import FakeProc, fake_claude_exec, reader

# One instance per test module; the autouse fixture clears its state between tests.
AGENT = content_generators.build_skill_agent_for(BUILTIN_TYPES["c1"])

VALID_C1 = {"type": "c1", "nodes": [{"id": "system", "name": "Sample", "description": ""}]}

_SETTLE_SECONDS = 0.05


@pytest.fixture(autouse=True)
def _clear_jobs(monkeypatch):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    AGENT.jobs.clear()
    AGENT.output.clear()
    yield
    AGENT.jobs.clear()
    AGENT.output.clear()


async def _noop_change(_repo_id, _state):
    pass


class _RecordingOutput:
    def __init__(self):
        self.batches = []

    async def __call__(self, repo_id, lines):
        self.batches.append((repo_id, list(lines)))

    @property
    def lines(self):
        return [line for _repo_id, batch in self.batches for line in batch]


def _write_c1(repo_root):
    path = repo_root / BUILTIN_TYPES["c1"].artifact
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(VALID_C1))


def _tool_use(name, **tool_input):
    blocks = [{"type": "tool_use", "name": name, "input": tool_input}]
    return {"type": "assistant", "message": {"content": blocks}}


def _settle(repo_root, on_output=None):
    """Starts a generation and lets its background task drain the fake feed."""

    async def _drive():
        await AGENT.start("default", repo_root, _noop_change, on_output)
        await asyncio.sleep(_SETTLE_SECONDS)

    asyncio.run(_drive())


def _run(monkeypatch, repo_root, events, on_output=None, returncode=0):
    """Runs one generation against a fake stream-json feed and lets it settle."""
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", fake_claude_exec(returncode=returncode, events=events)
    )
    _settle(repo_root, on_output)


def test_the_run_asks_the_cli_for_a_json_event_stream(monkeypatch, tmp_path):
    captured = []

    def _capturing(*args, **kwargs):
        captured.extend(args)
        return fake_claude_exec(returncode=0)(*args, **kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _capturing)
    _write_c1(tmp_path)

    _settle(tmp_path)

    assert captured[captured.index("--output-format") + 1] == "stream-json"
    assert "--verbose" in captured


def test_rendered_lines_are_readable_back_off_the_agent(monkeypatch, tmp_path):
    _write_c1(tmp_path)
    events = [_tool_use("Read", file_path=str(tmp_path / "src" / "app.py"))]

    _run(monkeypatch, tmp_path, events)

    assert AGENT.get_output("default") == ["⏺ Read(src/app.py)"]


def test_lines_are_pushed_to_the_canvas_as_they_are_rendered(monkeypatch, tmp_path):
    _write_c1(tmp_path)
    on_output = _RecordingOutput()
    events = [_tool_use("Glob", pattern="**/*.py"), {"type": "result", "duration_api_ms": 2000}]

    _run(monkeypatch, tmp_path, events, on_output)

    assert on_output.lines == ["⏺ Glob(**/*.py)", "✓ done in 2s"]
    assert {repo_id for repo_id, _batch in on_output.batches} == {"default"}


def test_the_buffer_keeps_only_the_most_recent_lines(monkeypatch, tmp_path):
    _write_c1(tmp_path)
    events = [_tool_use("Read", path=f"file{index}.py") for index in range(400)]

    _run(monkeypatch, tmp_path, events)

    buffered = AGENT.get_output("default")
    assert len(buffered) == skill_agent._output_lines()
    assert buffered[-1] == "⏺ Read(file399.py)"


def test_a_new_run_starts_from_a_blank_feed(monkeypatch, tmp_path):
    _write_c1(tmp_path)
    _run(monkeypatch, tmp_path, [_tool_use("Read", path="first.py")])

    _run(monkeypatch, tmp_path, [_tool_use("Read", path="second.py")])

    assert AGENT.get_output("default") == ["⏺ Read(second.py)"]


def test_an_unparseable_line_is_skipped_without_ending_the_feed(tmp_path, monkeypatch):
    _write_c1(tmp_path)
    good = json.dumps(_tool_use("Read", path="after.py")).encode()

    async def _exec(*_args, **_kwargs):
        proc = FakeProc(returncode=0)
        proc.stdout = reader(b"not json at all\n" + good + b"\n")
        return proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _exec)

    _settle(tmp_path)

    assert AGENT.get_output("default") == ["⏺ Read(after.py)"]


def test_a_line_past_the_stream_limit_is_dropped_rather_than_killing_the_run(tmp_path, monkeypatch):
    _write_c1(tmp_path)
    monster = json.dumps(_tool_use("Read", path="x" * 5000)).encode()
    good = json.dumps(_tool_use("Read", path="after.py")).encode()

    async def _exec(*_args, **_kwargs):
        proc = FakeProc(returncode=0)
        # A reader whose limit the monster line exceeds, standing in for _STREAM_LIMIT.
        stream = asyncio.StreamReader(limit=1024)
        stream.feed_data(monster + b"\n" + good + b"\n")
        stream.feed_eof()
        proc.stdout = stream
        return proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _exec)

    _settle(tmp_path)

    assert AGENT.get_output("default") == ["⏺ Read(after.py)"]


def test_a_failing_push_does_not_fail_the_run(monkeypatch, tmp_path):
    _write_c1(tmp_path)

    async def _exploding_output(_repo_id, _lines):
        raise RuntimeError("socket gone")

    _run(monkeypatch, tmp_path, [_tool_use("Read", path="app.py")], _exploding_output)

    assert AGENT.get_state("default") == {"state": "idle", "error": None}


def test_the_feed_survives_for_reading_after_the_run_ends(monkeypatch, tmp_path):
    _write_c1(tmp_path)
    events = [_tool_use("Write", path=".codechroma/c1.json"), {"type": "result"}]

    _run(monkeypatch, tmp_path, events)

    assert AGENT.get_output("default") == ["⏺ Write(.codechroma/c1.json)", "✓ done"]


def test_a_finished_run_leaves_no_task_behind(monkeypatch, tmp_path):
    _write_c1(tmp_path)

    _run(monkeypatch, tmp_path, [_tool_use("Read", file_path="app.py")])

    assert "default" not in AGENT.tasks


def test_cancel_after_a_completed_run_on_a_closed_loop_does_not_raise(monkeypatch, tmp_path):
    _write_c1(tmp_path)
    _run(monkeypatch, tmp_path, [_tool_use("Read", file_path="app.py")])

    asyncio.run(AGENT.cancel())

    assert AGENT.tasks == {}


def test_debug_log_dir_writes_the_raw_stream_to_disk(monkeypatch, tmp_path):
    log_dir = tmp_path / "logs"
    monkeypatch.setenv("codechroma_SKILL_LOG_DIR", str(log_dir))
    _write_c1(tmp_path)

    _run(monkeypatch, tmp_path, [_tool_use("Read", path="app.py")])

    logs = list(log_dir.glob(f"{AGENT.name}-default-*.log"))
    assert len(logs) == 1
    assert "tool_use" in logs[0].read_text()


def test_without_the_env_var_nothing_is_written_to_disk(monkeypatch, tmp_path):
    monkeypatch.delenv("codechroma_SKILL_LOG_DIR", raising=False)
    _write_c1(tmp_path)

    _run(monkeypatch, tmp_path, [_tool_use("Read", path="app.py")])

    assert list(tmp_path.rglob("*.log")) == []
