"""SpeckitDeliverySource: adapts specs/<slug>/{spec,plan,tasks,...}.md to the DeliverySource port.

A feature attaches to a work item by `epic:`/`epics:` frontmatter on spec.md when present, else by
every id named across spec.md's and plan.md's `**Input**` blocks (union, not "most specific wins" --
one spec can legitimately attach to more than one item). Header fields (status, done/total) are
cheap to compute on every call; a stage's `sections` stay empty unless its own node id is passed as
`expand` (D-05, FR-010). Every artifact in a feature dir gets a stage -- not just spec/plan/tasks --
and a section's items come from whichever of three extractors (checklist/table/bullet) is non-empty,
mirroring `frontmatter.parse_criteria`'s "first parser to yield items wins" idiom.
"""

from __future__ import annotations

import contextlib
import re
from collections import OrderedDict
from pathlib import Path

from codechroma.requirements.markdown.frontmatter import (
    _BULLET_RE,
    _CHECKLIST_RE,
    read_frontmatter_only,
    relative_source_ref,
)
from codechroma.requirements.models import Stage, StageItem, StageSection

_ID_RE = re.compile(r"(?:EP-)?[A-Z]+-\d+(?:-\d+)?")
_STATUS_RE = re.compile(r"^\*\*Status\*\*:?\s*(.+)$", re.MULTILINE)
_HEADING_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
_ITEM_ID_RE = re.compile(r"^([A-Z]+\d+)\b\s*(.*)$")
_TABLE_ROW_RE = re.compile(r"^\|(.+)\|\s*$")
_TABLE_SEP_CELL_RE = re.compile(r"^:?-+:?$")
_BOLD_LEADIN_RE = re.compile(r"^\*\*([^*]+)\*\*:?\s*(.*)$")
_PARALLEL_RE = re.compile(r"\[P\]")
_STORY_RE = re.compile(r"\[(US\d+)\]")
_INPUT_START_RE = re.compile(r"^\*\*Input\*\*")

_STAGE_FILES = (
    ("spec", "spec.md"),
    ("plan", "plan.md"),
    ("tasks", "tasks.md"),
    ("research", "research.md"),
    ("data-model", "data-model.md"),
    ("quickstart", "quickstart.md"),
)
_STAGE_DIRS = (("contract", "contracts"), ("checklist", "checklists"))


def stage_node_id(feature_name: str, kind: str) -> str:
    return f"epic-stage::{feature_name}::{kind}"


def _is_checklist_kind(kind: str) -> bool:
    return kind == "tasks" or kind.startswith("checklist-")


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _input_block(text: str) -> str | None:
    """The `**Input**` line plus continuation lines, stopping at a blank line/heading/new bold."""
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if _INPUT_START_RE.match(line.strip())), None)
    if start is None:
        return None
    block = [lines[start]]
    for line in lines[start + 1 :]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or _BOLD_LEADIN_RE.match(stripped):
            break
        block.append(line)
    return "\n".join(block)


def _status_of(text: str) -> str | None:
    match = _STATUS_RE.search(text)
    return match.group(1).strip() if match else None


def _checklist_counts(text: str) -> tuple[int, int]:
    """Total/done checklist items, case-insensitive -- cheap enough for every header (FR-017)."""
    done = total = 0
    for line in text.splitlines():
        match = _CHECKLIST_RE.match(line.strip())
        if not match:
            continue
        total += 1
        if match.group(1).strip().lower() == "x":
            done += 1
    return done, total


def _marker_flags(text: str) -> tuple[bool, str | None]:
    story_match = _STORY_RE.search(text)
    return bool(_PARALLEL_RE.search(text)), (story_match.group(1) if story_match else None)


def _fallback_id(section_index: int, ordinal: int) -> str:
    """A per-section id that never collides with a real one (no extractor emits `item-...`)."""
    return f"item-{section_index}-{ordinal}"


def _item_id(raw: str, section_index: int, ordinal: int) -> tuple[str, str]:
    """Leading `[A-Z]+\\d+` token as the id, else a per-section fallback that never collides."""
    id_match = _ITEM_ID_RE.match(raw)
    if id_match:
        return id_match.group(1), raw
    return _fallback_id(section_index, ordinal), raw


def _checklist_items(section: str, section_index: int) -> list[StageItem]:
    # A wrapped checklist task carries its continuation indented on the lines below; buffer it
    # like _bullet_items does so a task's text is never cut to its first line (LMP-123 tasks.md).
    items: list[StageItem] = []
    pending_done: bool | None = None
    pending_lines: list[str] = []

    def flush() -> None:
        nonlocal pending_done, pending_lines
        if not pending_lines:
            return
        text = " ".join(pending_lines)
        item_id, _text = _item_id(text, section_index, len(items) + 1)
        parallel, story = _marker_flags(text)
        items.append(
            StageItem(id=item_id, text=text, done=pending_done, story=story, parallel=parallel)
        )
        pending_done, pending_lines = None, []

    for line in section.splitlines():
        stripped = line.strip()
        checklist = _CHECKLIST_RE.match(stripped)
        if not checklist:
            is_fence = stripped.startswith("#") or stripped.startswith("```")
            if pending_lines and stripped and not is_fence:
                pending_lines.append(stripped)
            elif pending_lines:
                flush()
            continue
        flush()
        pending_done = checklist.group(1).strip().lower() == "x"
        pending_lines = [checklist.group(2).strip()]
    flush()
    return items


def _table_items(section: str, section_index: int) -> list[StageItem]:
    rows: list[list[str]] = []
    for line in section.splitlines():
        match = _TABLE_ROW_RE.match(line.strip())
        if not match:
            continue
        cells = [cell.strip() for cell in match.group(1).split("|")]
        if all(_TABLE_SEP_CELL_RE.match(cell) for cell in cells):
            continue  # the `|---|---|` separator row
        rows.append(cells)
    if len(rows) < 2:
        return []
    items: list[StageItem] = []
    for cells in rows[1:]:  # rows[0] is the header row
        if not cells or not cells[0]:
            continue
        raw_id = cells[0].strip("`* ")
        text = " — ".join(cell for cell in cells if cell) if len(cells) > 1 else cells[0]
        fallback = _fallback_id(section_index, len(items) + 1)
        item_id = raw_id if raw_id and " " not in raw_id else fallback
        parallel, story = _marker_flags(text)
        items.append(StageItem(id=item_id, text=text, done=None, story=story, parallel=parallel))
    return items


def _build_stage_item(item_id: str, text: str) -> StageItem:
    parallel, story = _marker_flags(text)
    return StageItem(id=item_id, text=text, done=None, story=story, parallel=parallel)


def _bullet_items(section: str, section_index: int) -> list[StageItem]:
    items: list[StageItem] = []
    # A bare bold-leadin paragraph can wrap across lines; buffer it so continuations join one item.
    pending_id: str | None = None
    pending_lines: list[str] = []

    def flush() -> None:
        nonlocal pending_id, pending_lines
        if pending_id is None:
            return
        items.append(_build_stage_item(pending_id, " ".join(pending_lines)))
        pending_id, pending_lines = None, []

    for line in section.splitlines():
        stripped = line.strip()
        bullet = _BULLET_RE.match(stripped)
        raw = bullet.group(1).strip() if bullet else None
        if raw is None and _BOLD_LEADIN_RE.match(stripped):
            raw = stripped
        if raw is not None:
            flush()
            lead_in = _BOLD_LEADIN_RE.match(raw)
            if bullet:
                if lead_in:
                    item_id = lead_in.group(1).strip()
                    text = raw
                else:
                    item_id, text = _item_id(raw, section_index, len(items) + 1)
                items.append(_build_stage_item(item_id, text))
            else:  # a bare bold-leadin: start a wrapped paragraph
                # raw == stripped here (line 199), and stripped already matched this same regex.
                assert lead_in is not None
                pending_id = lead_in.group(1).strip()
                pending_lines = [raw]
            continue
        # Not a new item: a wrapped continuation line, or a blank/heading/fence that ends one.
        if pending_id is not None:
            if not stripped or stripped.startswith("#") or stripped.startswith("```"):
                flush()
            else:
                pending_lines.append(stripped)
    flush()
    return items


def _section_counts(items: tuple[StageItem, ...]) -> tuple[int | None, int | None]:
    if not items or items[0].done is None:
        return None, None
    return sum(1 for item in items if item.done), len(items)


def _parse_sections(text: str) -> list[StageSection]:
    """Phase headings (`## ...`); the first non-empty extractor of the three wins per section."""
    headings = list(_HEADING_RE.finditer(text))
    sections: list[StageSection] = []
    for index, match in enumerate(headings):
        start = match.end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        body = text[start:end]
        items: list[StageItem] = []
        for extractor in (_checklist_items, _table_items, _bullet_items):
            items = extractor(body, index)
            if items:
                break
        if not items:
            continue
        done, total = _section_counts(tuple(items))
        title = match.group(1).strip()
        sections.append(StageSection(title=title, items=tuple(items), done=done, total=total))
    return sections


# Feature dir -> ((spec.md, plan.md mtimes), attached ids); LRU-capped for long-lived bridges.
type _AttachCache = OrderedDict[Path, tuple[tuple[float, float], frozenset[str]]]


class SpeckitDeliverySource:
    """Adapts `items_root` (a specs/ directory of feature slugs) to the DeliverySource port."""

    scheme = "file"

    _ATTACH_CACHE_MAX = 512

    def __init__(self, items_root: Path, repo_root: Path) -> None:
        self._items_root = items_root
        self._repo_root = repo_root
        self._attach_cache: _AttachCache = OrderedDict()

    def _source_ref(self, path: Path) -> str:
        return relative_source_ref(path, self._repo_root)

    def _feature_dirs(self) -> list[Path]:
        if not self._items_root.is_dir():
            return []
        return sorted(p for p in self._items_root.iterdir() if p.is_dir())

    def _attach_mtime_key(self, feature_dir: Path) -> tuple[float, float]:
        # Both mtimes (0.0 if absent) key the cache; using max would miss edits to the older file.
        spec = plan = 0.0
        with contextlib.suppress(OSError):
            spec = (feature_dir / "spec.md").stat().st_mtime
        with contextlib.suppress(OSError):
            plan = (feature_dir / "plan.md").stat().st_mtime
        return spec, plan

    def _attached_ids(self, feature_dir: Path) -> frozenset[str]:
        """`epic:`/`epics:` frontmatter wins; else the union of ids named across Input blocks."""
        mtime_key = self._attach_mtime_key(feature_dir)
        cached = self._attach_cache.get(feature_dir)
        if cached is not None and cached[0] == mtime_key:
            self._attach_cache.move_to_end(feature_dir)
            return cached[1]
        ids = self._compute_attached_ids(feature_dir)
        # A new key already lands at the end of an OrderedDict, so no move_to_end needed here.
        self._attach_cache[feature_dir] = (mtime_key, ids)
        while len(self._attach_cache) > self._ATTACH_CACHE_MAX:
            self._attach_cache.popitem(last=False)
        return ids

    def _compute_attached_ids(self, feature_dir: Path) -> frozenset[str]:
        frontmatter = read_frontmatter_only(feature_dir / "spec.md")
        if frontmatter is not None:
            epic = frontmatter.get("epic")
            epics = frontmatter.get("epics")
            if isinstance(epic, str):
                return frozenset({epic})
            if isinstance(epics, list):
                return frozenset(str(e) for e in epics)
        ids: set[str] = set()
        for filename in ("spec.md", "plan.md"):
            text = _read(feature_dir / filename)
            if text is None:
                continue
            block = _input_block(text)
            if not block:
                continue
            ids.update(_ID_RE.findall(block))
        return frozenset(ids)

    def _stage_for(self, feature_dir: Path, kind: str, path: Path, expand: str | None) -> Stage:
        node_id = stage_node_id(feature_dir.name, kind)
        text = _read(path) or ""
        done = total = None
        status = None
        if _is_checklist_kind(kind):
            done, total = _checklist_counts(text)
        else:
            status = _status_of(text)
        sections = tuple(_parse_sections(text)) if expand == node_id else ()
        return Stage(
            kind=kind,
            name=feature_dir.name,
            status=status,
            done=done,
            total=total,
            sections=sections,
            source_ref=self._source_ref(path),
        )

    def _artifact_paths(self, feature_dir: Path) -> list[tuple[str, Path]]:
        artifacts: list[tuple[str, Path]] = []
        for kind, filename in _STAGE_FILES:
            path = feature_dir / filename
            if path.is_file():
                artifacts.append((kind, path))
        for prefix, dirname in _STAGE_DIRS:
            dir_path = feature_dir / dirname
            if not dir_path.is_dir():
                continue
            for file_path in sorted(dir_path.glob("*.md")):
                artifacts.append((f"{prefix}-{file_path.stem}", file_path))
        return artifacts

    def stages_for(self, item_id: str, expand: str | None = None) -> list[Stage]:
        """One Stage per artifact of every feature attached to `item_id` (FR-016/FR-019)."""
        stages: list[Stage] = []
        for feature_dir in self._feature_dirs():
            if item_id not in self._attached_ids(feature_dir):
                continue
            for kind, path in self._artifact_paths(feature_dir):
                stages.append(self._stage_for(feature_dir, kind, path, expand))
        return stages
