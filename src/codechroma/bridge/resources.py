"""Resolves the repo-relative data dirs (skills, web build, agent detect manifests)."""

from __future__ import annotations

from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[3]

_SOURCE_RELATIVE = {
    "skills": Path("skills"),
    "web": Path("web") / "dist",
    "detect": Path("src") / "codechroma" / "bridge" / "agents" / "detect",
}


def resource_path(kind: str, *parts: str) -> Path:
    """Resolves a bundled data dir ("skills"/"web"/"detect") plus optional sub-parts."""
    if kind not in _SOURCE_RELATIVE:
        raise KeyError(f"unknown resource kind: {kind!r}")
    return (SOURCE_ROOT / _SOURCE_RELATIVE[kind]).joinpath(*parts)
