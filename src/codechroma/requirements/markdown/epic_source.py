"""MarkdownRequirementsSource: adapts a directory of frontmatter markdown to RequirementsSource.

A file's `id`/`title`/`status`/`kind`/`group` come from its frontmatter; `parent` (frontmatter)
names its parent's id, and `depends_on`/`enables` (frontmatter lists of {id, title}) become
ItemLinks. list_items() and every parent/child lookup read only frontmatter (frontmatter.py's
read_frontmatter_only stops before the body is ever pulled off disk) -- only fetch_item's own file
is read in full, and only once (FR-007, FR-008).
"""

from __future__ import annotations

from pathlib import Path

from codechroma.fingerprint import hash_lines
from codechroma.requirements.markdown.frontmatter import (
    parse_criteria,
    read_frontmatter_only,
    relative_source_ref,
    split_frontmatter,
)
from codechroma.requirements.models import ItemLink, ItemRef, WorkItem

_RELATIONS = ("depends_on", "enables")


class MarkdownRequirementsSource:
    """Adapts `items_root` (recursively) to the RequirementsSource port; scheme "file"."""

    scheme = "file"

    def __init__(self, items_root: Path, repo_root: Path) -> None:
        self._items_root = items_root
        self._repo_root = repo_root

    def _paths(self) -> list[Path]:
        if not self._items_root.is_dir():
            return []
        return sorted(self._items_root.rglob("*.md"))

    def _source_ref(self, path: Path) -> str:
        return relative_source_ref(path, self._repo_root)

    @staticmethod
    def _str_or_none(data: dict, key: str) -> str | None:
        value = data.get(key)
        return value if isinstance(value, str) else None

    def _ref_from(self, path: Path, data: dict) -> ItemRef | None:
        item_id = self._str_or_none(data, "id")
        if not item_id:
            return None
        return ItemRef(
            id=item_id,
            title=self._str_or_none(data, "title") or item_id,
            status=self._str_or_none(data, "status") or "",
            kind=self._str_or_none(data, "kind") or "item",
            group=self._str_or_none(data, "group"),
        )

    @staticmethod
    def _references_of(data: dict) -> tuple[str, ...]:
        """`references:` frontmatter list -- paths and/or bare ids, each kept as text (FR-011)."""
        raw = data.get("references")
        if isinstance(raw, list):
            return tuple(entry for entry in raw if isinstance(entry, str))
        return ()

    def list_items(self) -> list[ItemRef]:
        """Every item's summary fields; never opens a body (FR-007). A dup id keeps the first."""
        seen: set[str] = set()
        items: list[ItemRef] = []
        for path in self._paths():
            data = read_frontmatter_only(path)
            if not data:
                continue
            ref = self._ref_from(path, data)
            if ref is None or ref.id in seen:
                continue
            seen.add(ref.id)
            items.append(ref)
        return items

    def _find(self, item_id: str) -> tuple[Path, dict, str] | None:
        # casefold both sides so a user can look up an epic by any case (ep-a-01 works for EP-A-01);
        # return the file's own stored id so a fetched item keeps its canonical spelling.
        folded = item_id.casefold()
        for path in self._paths():
            data = read_frontmatter_only(path)
            if data and isinstance(data.get("id"), str) and data["id"].casefold() == folded:
                return path, data, data["id"]
        return None

    def _links_of(self, data: dict) -> list[ItemLink]:
        links: list[ItemLink] = []
        for relation in _RELATIONS:
            for entry in data.get(relation) or []:
                if isinstance(entry, dict) and isinstance(entry.get("id"), str):
                    links.append(
                        ItemLink(id=entry["id"], relation=relation, title=entry.get("title"))
                    )
                elif isinstance(entry, str):
                    links.append(ItemLink(id=entry, relation=relation, title=None))
        return links

    def _children_of(self, item_id: str) -> list[WorkItem]:
        """One tier of children from their own frontmatter -- their interior needs its own fetch."""
        children: list[WorkItem] = []
        for path in self._paths():
            data = read_frontmatter_only(path)
            if not data or data.get("parent") != item_id:
                continue
            ref = self._ref_from(path, data)
            if ref is None:
                continue
            children.append(
                WorkItem(
                    id=ref.id,
                    title=ref.title,
                    status=ref.status,
                    kind=ref.kind,
                    group=ref.group,
                    source_ref=self._source_ref(path),
                )
            )
        return children

    def fetch_item(self, item_id: str) -> WorkItem | None:
        """One fully-populated WorkItem, or None for an unknown id; degrades on parse failure."""
        found = self._find(item_id)
        if found is None:
            return None
        path, listed_data, canonical_id = found
        item_id = canonical_id
        source_ref = self._source_ref(path)
        try:
            text = path.read_text(encoding="utf-8")
            data, body = split_frontmatter(text)
            requirements = parse_criteria(body, source_ref)
            return WorkItem(
                id=item_id,
                title=self._str_or_none(data, "title") or item_id,
                status=self._str_or_none(data, "status") or "",
                kind=self._str_or_none(data, "kind") or "item",
                group=self._str_or_none(data, "group"),
                priority=self._str_or_none(data, "priority"),
                url=self._str_or_none(data, "url"),
                source_ref=source_ref,
                requirements=tuple(requirements),
                children=tuple(self._children_of(item_id)),
                links=tuple(self._links_of(data)),
                references=self._references_of(data),
                context_file=self._str_or_none(data, "context_file"),
                component=self._str_or_none(data, "component"),
            )
        except Exception:
            ref = self._ref_from(path, listed_data)
            title = ref.title if ref else item_id
            status = ref.status if ref else ""
            kind = ref.kind if ref else "item"
            return WorkItem(
                id=item_id, title=title, status=status, kind=kind, source_ref=source_ref
            )

    def fingerprint(self) -> str:
        """Hash of (path, mtime, size) triples -- directory metadata only, no body read (D-09)."""
        entries: list[str] = []
        for path in self._paths():
            try:
                stat = path.stat()
            except OSError:
                continue
            rel = path.relative_to(self._items_root)
            entries.append(f"{rel}:{stat.st_mtime_ns}:{stat.st_size}")
        return hash_lines(entries)
