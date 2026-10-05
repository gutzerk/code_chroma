"""Loads Claude system/user prompts from `prompts/*.yaml` instead of embedding them in source.

Every prompt-owning module used to hold its wording as an inline string constant; this is the one
place that reads it back off disk, so editing a prompt never touches Python. `render_prompt` only
calls `.format()` when variables are given — a static prompt (e.g. a system prompt containing a
literal JSON schema in braces) is returned verbatim, which keeps its `{"key": ...}` examples intact.
"""

from __future__ import annotations

from functools import cache
from pathlib import Path

import yaml

_PROMPTS_DIR = Path(__file__).parent


@cache
def _load(name: str) -> dict[str, str]:
    return yaml.safe_load((_PROMPTS_DIR / f"{name}.yaml").read_text(encoding="utf-8"))


def render_prompt(name: str, key: str = "prompt", **variables: object) -> str:
    """The `key` template from `prompts/{name}.yaml`, `.format(**variables)`'d if any were given."""
    template = _load(name)[key]
    return template.format(**variables) if variables else template
