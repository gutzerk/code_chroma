"""Recognizing the bridge's own installed skill copies, so core file walks can skip them.

Core, not bridge: `GraphEngine`'s repository walk must ignore `.agents/skills/codechroma-*` and
`.claude/skills/codechroma-*` (the
bridge re-installs those into every analyzed repo), and the engine may not import `bridge/` back.
`bridge/skill_sync.py` owns the installing half and builds on these names.
"""

from __future__ import annotations

from pathlib import Path

# .agents/skills is the cross-agent standard (Codex, Gemini, Kimi); Claude reads .claude/skills.
SKILL_TARGET_PARTS = ((".agents", "skills"), (".claude", "skills"))


def is_synced_skill_path(relative_path: str | Path) -> bool:
    """True for anything inside a `<target>/codechroma-*` copy the bridge installs itself."""
    parts = Path(relative_path).parts
    return len(parts) > 2 and parts[:2] in SKILL_TARGET_PARTS and parts[2].startswith("codechroma-")
