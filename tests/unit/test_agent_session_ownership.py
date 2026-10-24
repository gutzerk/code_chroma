"""SessionStart hooks track changes without claiming another process's conversation."""

import io
import json
import os
import subprocess
from types import SimpleNamespace
from uuid import uuid4

import pytest

from codechroma.bridge.agents import session_ownership as ownership
from codechroma.bridge.agents.manager import AgentManager, AgentRecord
from codechroma.io import write_json
from codechroma.terminal.agents import agent_cli


@pytest.mark.parametrize("source", ["clear", "resume"])
def test_generated_hook_records_session_changes_from_an_unrelated_worktree(tmp_path, source):
    file = ownership.file_for(tmp_path, str(uuid4()))
    session_id = str(uuid4())
    hook = json.loads(ownership.hook_settings())["hooks"]["SessionStart"][0]["hooks"][0]
    command = (
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", hook["command"]]
        if os.name == "nt" else ["/bin/sh", "-c", hook["command"]]
    )

    result = subprocess.run(
        command, input=json.dumps({"session_id": session_id, "source": source}),
        env={**os.environ, ownership.FILE_ENV: str(file)}, cwd=tmp_path,
        capture_output=True, text=True, timeout=15,
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(file.read_text(encoding="utf-8"))["session_id"] == session_id


@pytest.mark.parametrize("payload", ["invalid JSON", "[]", '{"session_id":"not-a-uuid"}'])
def test_malformed_hook_events_preserve_the_last_session(tmp_path, payload):
    file = ownership.file_for(tmp_path, str(uuid4()))
    session_id = str(uuid4())
    ownership.record(io.StringIO(json.dumps({"session_id": session_id})), str(file))

    ownership.record(io.StringIO(payload), str(file))

    assert json.loads(file.read_text(encoding="utf-8"))["session_id"] == session_id


def test_reload_reads_only_the_current_launch_and_ignores_late_events(tmp_path):
    record = AgentRecord("runner", "runner", "claude", "main", str(tmp_path), "")
    write_json(tmp_path / ".codechroma" / "agents.json", {"agents": [record.to_json()]})
    manager = AgentManager(tmp_path)
    old_file = ownership.file_for(tmp_path, str(uuid4()))
    current_file = ownership.file_for(tmp_path, str(uuid4()))
    initial_id, current_id, stale_id = (str(uuid4()) for _ in range(3))
    launch = SimpleNamespace(session_tracking_file=str(current_file), initial_session_id=initial_id)
    manager.record_session_launch(record.id, launch)
    ownership.record(io.StringIO(json.dumps({"session_id": current_id})), str(current_file))
    ownership.record(io.StringIO(json.dumps({"session_id": stale_id})), str(old_file))

    reloaded = AgentManager(tmp_path)
    found = reloaded.capture_session_id(record.id)
    reloaded.record_session_launch(record.id, launch)

    assert found == current_id
    assert reloaded.get(record.id).session_id == current_id
    assert AgentManager(tmp_path).get(record.id).session_id == current_id
    assert reloaded.get(record.id).session_tracking_id == current_file.stem


@pytest.mark.parametrize("kind", ["claude", "agent"])
def test_owned_launch_tracks_resumes_and_fresh_sessions(tmp_path, kind):
    file = ownership.file_for(tmp_path, str(uuid4()))
    session_id = str(uuid4())

    fresh, env = agent_cli(kind, new_session_id=session_id, session_tracking_file=file)
    resumed, resumed_env = agent_cli(
        kind, resume_session_id=session_id, session_tracking_file=file,
    )

    assert fresh[fresh.index("--session-id") + 1] == session_id
    assert "SessionStart" in fresh[fresh.index("--settings") + 1]
    assert env[ownership.FILE_ENV] == str(file)
    assert env[ownership.INITIAL_ID_ENV] == session_id
    assert "--session-id" not in resumed
    assert resumed[-2:] == ["--resume", session_id]
    assert resumed_env[ownership.INITIAL_ID_ENV] == session_id


@pytest.mark.parametrize("kind", ["shell", "claude", "agent"])
def test_alternative_clis_receive_no_session_hook(tmp_path, kind):
    from codechroma.assistant import save_assistant_settings

    save_assistant_settings({"cli": "codex"})

    argv, env = agent_cli(kind, session_tracking_file=tmp_path / "owned.json")

    assert "--settings" not in argv
    assert ownership.FILE_ENV not in env
