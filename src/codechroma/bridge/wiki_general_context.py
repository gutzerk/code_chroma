"""build_wiki_general_context(): the compact wiki-general bundle a diagram-drawing skill reads
first, ahead of its own type-specific context call and the older wiki_context.py -- see
docs/architecture/wiki-general.md's "Consumed by codechroma-draw-diagram" section."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from codechroma.bridge.wiki_general_agent import _valid_manifest
from codechroma.config import settings
from codechroma.io import CharBudget, load_json, safe_read_within

__all__ = ["WikiGeneralContainerPage", "WikiGeneralContextBundle", "build_wiki_general_context"]


@dataclass(slots=True)
class WikiGeneralContainerPage:
    """One container's (C2) wiki-general page."""

    id: str
    name: str
    content: str


@dataclass(slots=True)
class WikiGeneralContextBundle:
    """What GET /repos/{repo_id}/wiki-general-context returns."""

    has_wiki_general: bool
    generated_at: str | None = None
    root: str | None = None
    containers: list[WikiGeneralContainerPage] = field(default_factory=list)
    truncated: bool = False


def build_wiki_general_context(wiki_general_dir: Path) -> WikiGeneralContextBundle:
    """Assembles the root (C1) overview plus every container (C2) page, capped by a char budget."""
    manifest = load_json(wiki_general_dir / "manifest.json")
    root_text = safe_read_within(wiki_general_dir, wiki_general_dir / "index.md")
    if not _valid_manifest(manifest) or root_text is None:
        return WikiGeneralContextBundle(has_wiki_general=False)

    generated_at = manifest.get("generated_at")
    budget = CharBudget(max_chars=settings.wiki_general_context.max_chars, used=len(root_text))
    containers: list[WikiGeneralContainerPage] = []

    for entry in manifest["containers"]:
        container_id = entry.get("id")
        name = entry.get("name")
        path = entry.get("path")
        if not isinstance(container_id, str) or not isinstance(path, str):
            continue
        content = safe_read_within(wiki_general_dir, wiki_general_dir / path)
        if content is None:
            continue
        if not budget.try_add(content):
            break
        containers.append(
            WikiGeneralContainerPage(
                id=container_id,
                name=name if isinstance(name, str) else container_id,
                content=content,
            )
        )

    return WikiGeneralContextBundle(
        has_wiki_general=True,
        generated_at=generated_at if isinstance(generated_at, str) else None,
        root=root_text,
        containers=containers,
        truncated=budget.truncated,
    )
