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


def hook_settings() -> str:
    """Use an absolute script path so the helper works from any agent worktree."""
    argv = [sys.executable, str(Path(__file__).resolve())]
    hook = {"type": "command", "timeout": 5}
    if os.name == "nt":
        hook["shell"] = "powershell"
        hook["command"] = "& " + " ".join("'" + arg.replace("'", "''") + "'" for arg in argv)
    else:
        hook["command"] = shlex.join(argv)
    return json.dumps({"hooks": {"SessionStart": [{"hooks": [hook]}]}})


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
