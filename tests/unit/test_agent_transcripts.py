"""Session-id discovery: derived from each transcript's own `cwd`, never from a guessed dir name."""

import json
import os
from pathlib import Path

from codechroma.bridge.agents import transcripts


def _transcript(root: Path, project: str, session_id: str, cwd: str, mtime: float) -> Path:
    directory = root / project
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{session_id}.jsonl"
    path.write_text(
        json.dumps({"type": "mode", "sessionId": session_id})
        + "\n"
        + json.dumps({"type": "user", "cwd": cwd, "sessionId": session_id})
        + "\n"
, encoding="utf-8")
    os.utime(path, (mtime, mtime))
    return path


def test_the_newest_transcript_for_that_worktree_wins(tmp_path):
    projects = tmp_path / "projects"
    worktree = tmp_path / "worktrees" / "refund-flow"
    worktree.mkdir(parents=True)
    _transcript(projects, "-a-b", "oldest", str(worktree), 1000)
    _transcript(projects, "-a-b", "middle", str(worktree), 2000)
    _transcript(projects, "-a-b", "newest", str(worktree), 3000)

    assert transcripts.find_session_id(worktree, projects) == "newest"


def test_a_transcript_for_another_worktree_is_ignored(tmp_path):
    projects = tmp_path / "projects"
    mine = tmp_path / "worktrees" / "mine"
    theirs = tmp_path / "worktrees" / "theirs"
    mine.mkdir(parents=True)
    theirs.mkdir(parents=True)
    _transcript(projects, "-theirs", "not-mine", str(theirs), 3000)
    _transcript(projects, "-mine", "mine", str(mine), 1000)

    assert transcripts.find_session_id(mine, projects) == "mine"


def test_an_empty_projects_directory_yields_none_without_raising(tmp_path):
    projects = tmp_path / "projects"
    projects.mkdir()

    assert transcripts.find_session_id(tmp_path / "nowhere", projects) is None


def test_a_missing_projects_directory_yields_none(tmp_path):
    assert transcripts.find_session_id(tmp_path, tmp_path / "does-not-exist") is None


def test_the_directory_name_is_never_guessed_from_the_path(tmp_path):
    projects = tmp_path / "projects"
    worktree = tmp_path / "worktrees" / "refund-flow"
    worktree.mkdir(parents=True)
    _transcript(projects, "a-name-nobody-could-derive", "found", str(worktree), 1000)

    assert transcripts.find_session_id(worktree, projects) == "found"


def test_a_transcript_with_no_cwd_entry_is_skipped(tmp_path):
    projects = tmp_path / "projects"
    worktree = tmp_path / "worktrees" / "refund-flow"
    worktree.mkdir(parents=True)
    (projects / "-x").mkdir(parents=True)
    (projects / "-x" / "no-cwd.jsonl").write_text('{"type": "mode"}\n', encoding="utf-8")

    assert transcripts.find_session_id(worktree, projects) is None


def test_the_projects_dir_honours_claude_config_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "custom"))

    assert transcripts.projects_dir() == tmp_path / "custom" / "projects"


def test_a_session_already_claimed_by_a_sibling_is_skipped(tmp_path):
    projects = tmp_path / "projects"
    shared = tmp_path / "worktrees" / "shared"
    shared.mkdir(parents=True)
    _transcript(projects, "-shared", "sibling-owns-this", str(shared), 3000)
    _transcript(projects, "-shared", "my-own-older-session", str(shared), 1000)

    found = transcripts.find_session_id(shared, projects, exclude=frozenset({"sibling-owns-this"}))

    assert found == "my-own-older-session"


def test_every_transcript_claimed_by_siblings_yields_none(tmp_path):
    projects = tmp_path / "projects"
    shared = tmp_path / "worktrees" / "shared"
    shared.mkdir(parents=True)
    _transcript(projects, "-shared", "sibling-owns-this", str(shared), 1000)

    found = transcripts.find_session_id(shared, projects, exclude=frozenset({"sibling-owns-this"}))

    assert found is None
