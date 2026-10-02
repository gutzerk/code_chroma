"""Recognizing the bridge's own installed skill copies, so core file walks can skip them.

Core, not bridge: `GraphEngine`'s repository walk must ignore `.claude/skills/codechroma-*` (the
bridge re-installs those into every analyzed repo), and the engine may not import `bridge/` back.
`bridge/skill_sync.py` owns the installing half and builds on these names.
"""

from __future__ import annotations

from pathlib import Path

SKILLS_PARENT_PARTS = (".claude", "skills")


def is_synced_skill_path(relative_path: str | Path) -> bool:
    """True for anything inside a `.claude/skills/codechroma-*` copy the bridge installs itself."""
    parts = Path(relative_path).parts
    return (
        len(parts) > 2
        and parts[: len(SKILLS_PARENT_PARTS)] == SKILLS_PARENT_PARTS
        and parts[2].startswith("codechroma-")
    )
