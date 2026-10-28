"""Whether a CLI adapter is signed in, via its own status command; None when it can't be told."""

from __future__ import annotations

import json
import subprocess

from codechroma.llm.runtime_env import CliLookupError, resolve_runtime_cli

_STATUS_ARGS = {"claude": ["auth", "status"], "codex": ["login", "status"]}
_TIMEOUT_SECONDS = 8


def cli_signed_in(adapter: str) -> bool | None:
    args = _STATUS_ARGS.get(adapter)
    if args is None:
        return None
    try:
        cli = resolve_runtime_cli(adapter)
        done = subprocess.run(
            [cli.executable, *args],
            env=dict(cli.env),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_SECONDS,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (CliLookupError, OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return False
    try:
        return bool(json.loads(done.stdout).get("loggedIn", True))
    except (ValueError, AttributeError):
        return True
