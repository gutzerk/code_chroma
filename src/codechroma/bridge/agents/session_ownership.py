"""Per-launch Claude session tracking; also a standalone, stdlib-only SessionStart helper."""

from __future__ import annotations

import json
import os
import shlex
import sys
from contextlib import suppress
from pathlib import Path
from typing import TextIO
from uuid import UUID, uuid4

FILE_ENV = "CODECHROMA_AGENT_SESSION_FILE"
INITIAL_ID_ENV = "CODECHROMA_AGENT_SESSION_ID"


def valid_id(value: object) -> str | None:
    """Keep only UUIDs, including when validating persisted tracking-file names."""
    if not isinstance(value, str):
        return None
    try:
        return str(UUID(value))
    except ValueError:
        return None


def file_for(root: Path, tracking_id: str) -> Path:
    """The same per-launch location as the production C# bridge."""
    normalized = valid_id(tracking_id)
    if normalized is None:
        raise ValueError("invalid session tracking id")
    return root / ".codechroma" / "agent-sessions" / f"{normalized}.json"


def _script_hook(script: Path, timeout: int) -> dict:
    """Use an absolute script path so the helper works from any agent worktree."""
    argv = [sys.executable, str(script.resolve())]
    hook: dict = {"type": "command", "timeout": timeout}
    if os.name == "nt":
        hook["shell"] = "powershell"
        hook["command"] = "& " + " ".join("'" + arg.replace("'", "''") + "'" for arg in argv)
    else:
        hook["command"] = shlex.join(argv)
    return hook


def hook_document(session_tracking: bool = True, status_hooks: bool = False) -> dict:
    """The `--settings` hooks: SessionStart tracking and/or the status reports of agent_hook.py."""
    from codechroma.bridge.agents import agent_hook

    hooks: dict = {}
    if session_tracking:
        hooks["SessionStart"] = [{"hooks": [_script_hook(Path(__file__), 5)]}]
    if status_hooks:
        command = _script_hook(Path(agent_hook.__file__), agent_hook.HOOK_TIMEOUT_SECONDS)
        for name in agent_hook.EVENTS:
            entry: dict = {"matcher": "*"} if name in agent_hook.TOOL_EVENTS else {}
            hooks.setdefault(name, []).append({**entry, "hooks": [dict(command)]})
        # Only a /clear reports, so startup, resume and compact start no extra process.
        hooks.setdefault("SessionStart", []).append(
            {"matcher": agent_hook.CLEAR_SOURCE, "hooks": [dict(command)]}
        )
    return {"hooks": hooks}


def record(input_stream: TextIO, file: str | None) -> None:
    """Atomically record this process's session; malformed input leaves the previous ID intact."""
    if not file:
        return
    temp = None
    try:
        payload = json.load(input_stream)
        session_id = valid_id(payload.get("session_id")) if isinstance(payload, dict) else None
        if session_id is None:
            return
        path = Path(file)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(f"{path.name}.{uuid4()}.tmp")
        temp.write_text(json.dumps({"session_id": session_id}), encoding="utf-8")
        os.replace(temp, path)
    except (OSError, ValueError):
        pass
    finally:
        if temp is not None:
            with suppress(OSError):
                temp.unlink(missing_ok=True)


if __name__ == "__main__":
    record(sys.stdin, os.environ.get(FILE_ENV))
