"""Cross-project assistant settings: which CLI + model to run, credentials, instructions.

Lives in the user's home directory rather than the repo, like the diagram-type library
(`diagrams/library.py`): the assistant a user wants is a machine-level choice, not tied to one
codebase. Each reader loads the tiny file fresh, so a settings save applies to the next generation
without a restart. `$codechroma_ASSISTANT_SETTINGS_FILE` overrides the default path (the same
env-var escape hatch as `library_dir()`/`worktrees_root()`).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from codechroma.io import load_json_or_none, write_json

ASSISTANT_SETTINGS_ENV = "codechroma_ASSISTANT_SETTINGS_FILE"
DEFAULT_CLI = "claude"
SCHEMA_VERSION = 1


def assistant_settings_path() -> Path:
    """The settings file from the environment or `~/.codechroma/`."""
    configured = os.environ.get(ASSISTANT_SETTINGS_ENV, "")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".codechroma" / "assistant-settings.json"


@dataclass
class AssistantSettings:
    """The persisted, validated assistant config. Never exposes a raw API key in a payload."""

    cli: str = DEFAULT_CLI
    model: str | None = None
    api_key: str | None = None
    api_key_path: str | None = None
    instruction: str = ""
    schema_version: int = SCHEMA_VERSION

    @property
    def has_key(self) -> bool:
        return bool(self.api_key or self.api_key_path)

    @property
    def effective_cli(self) -> str:
        """The CLI to actually run: the chosen binary, else the default."""
        return self.cli if self.cli else DEFAULT_CLI

    def masked(self) -> dict:
        """A UI-safe payload: the raw key is replaced by a boolean, the path shown as-is."""
        return {
            "schema_version": self.schema_version,
            "cli": self.cli,
            "model": self.model,
            "api_key_set": bool(self.api_key),
            "api_key_path": self.api_key_path,
            "instruction": self.instruction,
        }


def validate(payload: object) -> list[str]:
    """Returns a list of problems; empty means the payload is acceptable to save."""
    if not isinstance(payload, dict):
        return ["settings must be an object"]
    problems: list[str] = []
    cli = payload.get("cli", DEFAULT_CLI)
    if not isinstance(cli, str) or not cli.strip() or "/" in cli or cli in (".", ".."):
        problems.append("cli must be a simple executable name (no slashes)")
    model = payload.get("model")
    if model is not None and (not isinstance(model, str) or not model.strip()):
        problems.append("model must be a non-empty string")
    has_key = payload.get("api_key")
    has_path = payload.get("api_key_path")
    if has_path is not None and (not isinstance(has_path, str) or not has_path.strip()):
        problems.append("api_key_path must be a non-empty string")
    if has_key and has_path:
        problems.append("provide an api_key OR an api_key_path, not both")
    if "instruction" in payload and not isinstance(payload["instruction"], str):
        problems.append("instruction must be a string")
    return problems


def load_assistant_settings() -> AssistantSettings:
    """The effective settings; defaults when nothing is saved yet."""
    return from_payload(load_json_or_none(assistant_settings_path()) or {})


def from_payload(payload: dict) -> AssistantSettings:
    """Coerces a stored dict into an AssistantSettings, ignoring unknown/invalid fields."""
    raw_cli = payload.get("cli")
    raw_model = payload.get("model")
    return AssistantSettings(
        cli=raw_cli if isinstance(raw_cli, str) and raw_cli.strip() else DEFAULT_CLI,
        model=raw_model if isinstance(raw_model, str) and raw_model.strip() else None,
        api_key=payload.get("api_key") if isinstance(payload.get("api_key"), str) else None,
        api_key_path=payload.get("api_key_path")
        if isinstance(payload.get("api_key_path"), str)
        else None,
        instruction=payload.get("instruction", "")
        if isinstance(payload.get("instruction"), str)
        else "",
        schema_version=payload.get("schema_version", SCHEMA_VERSION),
    )


def save_assistant_settings(payload: object) -> AssistantSettings:
    """Validates, then writes the settings; raises ValueError listing every problem."""
    problems = validate(payload)
    if problems:
        raise ValueError("; ".join(problems))
    assert isinstance(payload, dict)  # validate() would have raised "must be an object" otherwise
    data = dict(payload)
    if data.get("api_key") == "":
        data["api_key"] = None
    if data.get("api_key_path") == "":
        data["api_key_path"] = None
    settings = from_payload(data)
    write_json(assistant_settings_path(), {
        "schema_version": settings.schema_version,
        "cli": settings.cli,
        "model": settings.model,
        "api_key": settings.api_key,
        "api_key_path": settings.api_key_path,
        "instruction": settings.instruction,
    })
    return settings
