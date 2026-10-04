"""Machine-level shell capture and per-executable escape hatches."""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from pathlib import Path

from codechroma.io import load_json_or_none, write_json


@dataclass(frozen=True)
class RuntimeSettings:
    shell: str | None = None
    timeout_seconds: float = 10.0
    cli_paths: dict[str, str] = field(default_factory=dict)

    def payload(self) -> dict:
        return {
            "shell": self.shell,
            "timeout_seconds": self.timeout_seconds,
            "cli_paths": dict(self.cli_paths),
        }


def settings_path() -> Path:
    override = os.environ.get("codechroma_RUNTIME_SETTINGS_FILE")
    return (
        Path(override).expanduser()
        if override
        else (Path.home() / ".codechroma" / "runtime-environment.json")
    )


def validate_settings(payload: object) -> RuntimeSettings:
    if not isinstance(payload, dict):
        raise ValueError("runtime settings must be an object")
    shell = payload.get("shell")
    if shell is not None and (not isinstance(shell, str) or not shell.strip()):
        raise ValueError("shell must be a non-empty executable path or null")
    timeout = payload.get("timeout_seconds", 10.0)
    if (
        isinstance(timeout, bool)
        or not isinstance(timeout, (int, float))
        or not math.isfinite(timeout)
        or not 0.1 <= timeout <= 60
    ):
        raise ValueError("timeout_seconds must be between 0.1 and 60")
    paths = payload.get("cli_paths", {})
    if not isinstance(paths, dict) or any(
        not isinstance(k, str)
        or not k.strip()
        or os.path.basename(k) != k
        or not isinstance(v, str)
        or not v.strip()
        or not os.path.dirname(v)
        for k, v in paths.items()
    ):
        raise ValueError("cli_paths must map executable names to explicit executable paths")
    return RuntimeSettings(shell, float(timeout), dict(paths))


def load_runtime_settings() -> RuntimeSettings:
    try:
        return validate_settings(load_json_or_none(settings_path()) or {})
    except ValueError:
        return RuntimeSettings()


def save_runtime_settings(payload: object) -> RuntimeSettings:
    result = validate_settings(payload)
    write_json(settings_path(), result.payload())
    return result
