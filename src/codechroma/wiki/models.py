"""GapEntry/WikiResult/WikiSyncResult -- generate_wiki()/sync_wiki()'s entities (data-model.md)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass(slots=True)
class GapEntry:
    """One undocumented module/class/method/function, for a later AI pass to target."""

    path: str
    qualified_name: str
    kind: str
    reason: str = "no docstring"


@dataclass(slots=True)
class WikiResult:
    """What one generate_wiki() run wrote and how much of the repo is documented."""

    output_dir: Path
    pages: list[Path] = field(default_factory=list)
    gap_report_path: Path | None = None
    gap_json_path: Path | None = None
    undocumented_count: int = 0


@dataclass(slots=True)
class WikiSyncResult:
    """What one sync_wiki() run found stale and wrote -- the spec's Wiki Sync Result entity."""

    changed_paths: list[str] = field(default_factory=list)
    regenerated_pages: list[Path] = field(default_factory=list)
    full_regeneration: bool = False
