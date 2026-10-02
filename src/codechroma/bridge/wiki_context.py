"""build_wiki_context(): the wiki-page bundle a diagram-drawing skill reads instead of a full
raw-context dump, when a repo already has a wiki -- mirrors patterns_context.py's shape."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from codechroma.config import settings
from codechroma.io import CharBudget, read_text, safe_read_within
from codechroma.wiki.generator import file_page_relative_path

__all__ = ["WikiContextPage", "WikiContextBundle", "build_wiki_context", "safe_file_text"]


@dataclass(slots=True)
class WikiContextPage:
    """One wiki page's content for a requested path -- a file or a folder."""

    path: str
    kind: str
    content: str


@dataclass(slots=True)
class WikiContextBundle:
    """What GET /repos/{repo_id}/wiki-context returns (data-model.md)."""

    has_wiki: bool
    root: str | None
    pages: list[WikiContextPage] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    truncated: bool = False


def _folder_page_path(wiki_dir: Path, folder_path: str) -> Path:
    return wiki_dir / "files" / folder_path / "index.md"


def _file_page_path(wiki_dir: Path, file_path: str) -> Path:
    return wiki_dir / "files" / file_page_relative_path(file_path)


def safe_file_text(wiki_dir: Path, file_path: str) -> str | None:
    """The file page's text, or None if no page exists -- public for a fixed-file-list caller."""
    try:
        page_path = _file_page_path(wiki_dir, file_path)
    except ValueError:
        return None
    return safe_read_within(wiki_dir, page_path)


def _proper_ancestors(path: str) -> list[str]:
    """Root-to-leaf proper-prefix folder paths for `path`, excluding `path` itself."""
    parts = path.split("/")
    return ["/".join(parts[:i]) for i in range(1, len(parts))]


def _entries_for(
    wiki_dir: Path, requested: str, seen: set[str]
) -> list[tuple[str, str, str]] | None:
    """One requested path's (path, kind, content) chain, root-to-leaf; `None` when it's a gap."""
    ancestors = [
        (folder, "folder", text)
        for folder in _proper_ancestors(requested)
        if folder not in seen
        and (text := safe_read_within(wiki_dir, _folder_page_path(wiki_dir, folder))) is not None
    ]
    folder_text = safe_read_within(wiki_dir, _folder_page_path(wiki_dir, requested))
    if folder_text is not None:
        return [*ancestors, (requested, "folder", folder_text)]
    file_text = safe_file_text(wiki_dir, requested)
    if file_text is not None:
        return [*ancestors, (requested, "file", file_text)]
    return None


def build_wiki_context(wiki_dir: Path, paths: list[str]) -> WikiContextBundle:
    """Assembles the root page plus each requested path's ancestor-folder and own page."""
    root_text = read_text(wiki_dir / "index.md")
    if root_text is None:
        return WikiContextBundle(has_wiki=False, root=None)

    budget = CharBudget(max_chars=settings.wiki_context.max_chars, used=len(root_text))
    pages: list[WikiContextPage] = []
    gaps: list[str] = []
    seen: set[str] = set()

    for requested in paths:
        if budget.truncated:
            break
        if requested in seen:
            continue
        entries = _entries_for(wiki_dir, requested, seen)
        if entries is None:
            gaps.append(requested)
            seen.add(requested)
            continue
        for path, kind, content in entries:
            if path in seen:
                continue
            if not budget.try_add(content):
                break
            pages.append(WikiContextPage(path=path, kind=kind, content=content))
            seen.add(path)

    return WikiContextBundle(
        has_wiki=True, root=root_text, pages=pages, gaps=gaps, truncated=budget.truncated
    )
