"""The long-running git runner: its reason codes, its process-group kill, its non-interactive env.

🔴 No test here touches the network. `git` is a shell script this module writes into a temp dir that
is prepended to PATH, so a hang and a missing binary can both be produced on demand.
"""

import os
import subprocess
import time
from pathlib import Path

import pytest

from codechroma.bridge import git_long


def _stub_git(bin_dir: Path, body: str) -> None:
    """A fake `git` on PATH; `body` is the shell script standing in for the real binary."""
    bin_dir.mkdir(parents=True, exist_ok=True)
    script = bin_dir / "git"
    script.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
    script.chmod(0o755)


def _wait_until_gone(pid: int, wait: float = 10.0) -> bool:
    """True once `pid` is dead; an unreaped zombie counts, since init may reap it late."""
    deadline = time.monotonic() + wait
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except OSError:
            return True
        probe = subprocess.run(
            ["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True, check=False
        )
        if probe.stdout.strip().startswith("Z"):
            return True
        time.sleep(0.1)
    return False


@pytest.fixture
def bin_dir(tmp_path, monkeypatch):
    if os.name == "nt":
        pytest.skip("uses POSIX shebang stubs")
    path = tmp_path / "bin"
    path.mkdir()
    monkeypatch.setenv("PATH", f"{path}{os.pathsep}{os.environ['PATH']}")
    from codechroma.llm import runtime_env

    monkeypatch.setattr(runtime_env, "_probe", lambda *_: ({}, None, (), "test-shell"))
    environment = runtime_env.get_runtime_environment()
    environment.inherited = dict(os.environ)
    environment.refresh("test PATH changed", force=True).result()
    return path


def test_returns_stdout_of_a_successful_command(tmp_path, bin_dir):
    _stub_git(bin_dir, 'echo "fetched"')

    assert git_long.run_git_long(tmp_path, "fetch", "origin").strip() == "fetched"


def test_a_hang_reports_timed_out(tmp_path, bin_dir):
    _stub_git(bin_dir, "sleep 60")

    with pytest.raises(git_long.GitLongError) as caught:
        git_long.run_git_long(tmp_path, "fetch", "origin", timeout=1)

    assert caught.value.reason == git_long.REASON_TIMED_OUT


def test_a_hang_leaves_nothing_behind(tmp_path, bin_dir):
    marker = tmp_path / "child.pid"
    _stub_git(bin_dir, f'sleep 47 & echo $! > "{marker}"; wait')

    with pytest.raises(git_long.GitLongError):
        git_long.run_git_long(tmp_path, "fetch", "origin", timeout=1)

    child_pid = int(marker.read_text(encoding="utf-8").strip())
    # The whole process group is killed, so what git spawned is not still sleeping.
    assert _wait_until_gone(child_pid)


def test_a_missing_binary_is_distinct_from_a_hang(tmp_path, monkeypatch):
    from codechroma.llm.runtime_env import CliLookupError

    def missing(*args, **kwargs):
        raise CliLookupError("git executable not found")

    monkeypatch.setattr(git_long, "resolve_runtime_cli", missing)

    with pytest.raises(git_long.GitLongError) as caught:
        git_long.run_git_long(tmp_path, "fetch", "origin")

    assert caught.value.reason == git_long.REASON_NOT_RUNNABLE


def test_a_non_zero_exit_surfaces_gits_own_stderr(tmp_path, bin_dir):
    _stub_git(bin_dir, 'echo "fatal: could not read Username" >&2; exit 128')

    with pytest.raises(git_long.GitLongError) as caught:
        git_long.run_git_long(tmp_path, "fetch", "origin")

    assert caught.value.reason == git_long.REASON_FAILED
    assert "could not read Username" in str(caught.value)


def test_the_child_cannot_be_asked_for_credentials(tmp_path, bin_dir):
    _stub_git(bin_dir, 'echo "$GIT_TERMINAL_PROMPT $GIT_ASKPASS"')

    assert git_long.run_git_long(tmp_path, "fetch").strip() == "0 echo"


def test_the_ssh_command_already_set_by_the_operator_wins(monkeypatch):
    monkeypatch.setenv("GIT_SSH_COMMAND", "ssh -i /keys/deploy")

    assert git_long.non_interactive_env()["GIT_SSH_COMMAND"] == "ssh -i /keys/deploy"


def test_the_timeout_is_read_from_the_environment_per_call(monkeypatch):
    monkeypatch.setenv(git_long.TIMEOUT_ENV_VAR, "300")

    assert git_long.timeout_seconds() == 300


@pytest.mark.parametrize("value", ["", "not-a-number", "0", "-5"])
def test_an_unusable_timeout_falls_back_to_the_default(monkeypatch, value):
    monkeypatch.setenv(git_long.TIMEOUT_ENV_VAR, value)

    assert git_long.timeout_seconds() == git_long.settings.git.long_timeout_seconds


def test_a_command_runs_in_the_directory_it_was_given(tmp_path, bin_dir):
    work = tmp_path / "work"
    work.mkdir()
    _stub_git(bin_dir, "pwd")

    assert Path(git_long.run_git_long(work, "fetch").strip()).resolve() == work.resolve()


def test_the_group_kill_reaps_the_process_it_killed(tmp_path, bin_dir):
    _stub_git(bin_dir, "sleep 60")
    process = subprocess.Popen(["git", "fetch"], cwd=tmp_path, start_new_session=True)

    git_long.kill_process_group(process)

    assert process.poll() is not None
