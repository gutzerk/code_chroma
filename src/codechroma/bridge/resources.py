"""Resolves bundled data dirs, honoring PyInstaller's _MEIPASS so the frozen app finds them."""

from __future__ import annotations

import sys
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[3]

# Source-tree locations vs the flat codechroma_data/ tree packaging/bridge.spec builds.
_SOURCE_RELATIVE = {
    "skills": Path(".claude") / "skills",
    "web": Path("web") / "dist",
    # Agent status manifests: TOML read at runtime, so it needs the same _MEIPASS treatment.
    "detect": Path("src") / "codechroma" / "bridge" / "agents" / "detect",
}


def is_frozen() -> bool:
    """True inside a PyInstaller bundle, where data files live under _MEIPASS, not the repo."""
    return getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


def resource_path(kind: str, *parts: str) -> Path:
    """Resolves a bundled data dir ("skills"/"web"/"detect") plus optional sub-parts."""
    if kind not in _SOURCE_RELATIVE:
        raise KeyError(f"unknown resource kind: {kind!r}")
    if is_frozen():
        base = Path(getattr(sys, "_MEIPASS")) / "codechroma_data" / kind  # noqa: B009
    else:
        base = SOURCE_ROOT / _SOURCE_RELATIVE[kind]
    return base.joinpath(*parts)
