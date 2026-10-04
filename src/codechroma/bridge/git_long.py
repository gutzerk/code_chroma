"""The git runner for the few commands that talk to a network, where git_cmd's rules are wrong.

`git_cmd.run_git_raw` is capped at 10s and collapses "git isn't installed" and "git hung" into the
same `None`. That is right for every read path in the app and fatal for `fetch` and `push`: a real
fetch outlives 10s routinely, and the caller has to tell a missing binary from a stalled network to
say anything useful. So this module is the other half — a longer, env-tunable timeout, its own
process group, and a reason code a route can turn into a message.

🔴 The non-interactive environment, not the longer timeout, is what stops a private-repo fetch
wedging the bridge: git would otherwise sit on a credential prompt for the whole timeout with no
terminal able to answer it. Failing immediately with git's own "could not read Username" is the
honest outcome.
"""

from __future__ import annotations

import contextlib
import logging
import os
import signal
import subprocess
from pathlib import Path

from codechroma.config import settings
from codechroma.errors import codechromaError
from codechroma.llm.runtime_env import (
    CliLookupError,
    launch_failed,
    resolve_runtime_cli,
    runtime_environment,
)

logger = logging.getLogger("uvicorn.error")

TIMEOUT_ENV_VAR = "codechroma_GIT_LONG_TIMEOUT_SECONDS"

REASON_NOT_RUNNABLE = "not-runnable"
REASON_TIMED_OUT = "timed-out"
REASON_FAILED = "failed"


class GitLongError(codechromaError):
    """A network-touching git command could not be run, hung, or exited non-zero."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


def timeout_seconds() -> int:
    """Read per call, so a slow remote can be accommodated without restarting the bridge."""
    raw = os.environ.get(TIMEOUT_ENV_VAR, "").strip()
    fallback = settings.git.long_timeout_seconds
    try:
        value = int(raw)
    except ValueError:
        return fallback
    return value if value > 0 else fallback


def non_interactive_env() -> dict[str, str]:
    """git's environment with every credential prompt turned into an immediate failure."""
    return {
        **runtime_environment()[0],
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "echo",
        "SSH_ASKPASS": "echo",
        "SSH_ASKPASS_REQUIRE": "never",
        "GIT_SSH_COMMAND": os.environ.get("GIT_SSH_COMMAND") or "ssh -o BatchMode=yes",
    }


def run_git_long(cwd: Path, *args: str, timeout: int | None = None) -> str:
    """stdout of a network-touching git command; raises GitLongError with a reason on failure."""
    limit = timeout if timeout is not None else timeout_seconds()
    # Own process group: killing git alone orphans its credential helper, ssh and pager.
    try:
        runtime = resolve_runtime_cli("git", non_interactive_env())
        process = subprocess.Popen(
            [runtime.executable, *args],
            cwd=cwd,
            env=dict(runtime.env),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=not settings.windows,
        )
    except (OSError, CliLookupError) as exc:
        launch_failed(exc)
        raise GitLongError(REASON_NOT_RUNNABLE, f"git could not be run: {exc}") from exc
    try:
        stdout, stderr = process.communicate(timeout=limit)
    except subprocess.TimeoutExpired as exc:
        kill_process_group(process)
        logger.warning("git_long: git %s timed out after %ss", " ".join(args), limit)
        raise GitLongError(REASON_TIMED_OUT, f"git {args[0]} timed out after {limit}s") from exc
    if process.returncode != 0:
        detail = (stderr or stdout or "").strip()
        raise GitLongError(REASON_FAILED, detail or f"git {args[0]} exited {process.returncode}")
    return stdout


def kill_process_group(process: subprocess.Popen) -> None:
    """Kills the whole process group and reaps it, so nothing survives the timeout."""
    if settings.windows:
        process.kill()
    else:
        with contextlib.suppress(OSError):
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        process.kill()
    with contextlib.suppress(subprocess.TimeoutExpired):
        process.communicate(timeout=5)
