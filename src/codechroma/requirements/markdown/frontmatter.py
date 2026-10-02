"""Frontmatter YAML split, criteria-section locator, and the three criteria body parsers.

research.md D-02/D-03/D-04: only the leading ---/--- block is ever yaml.safe_load'd (the body is
prose, not YAML); the criteria section is found by heading *name* (numbering/parenthetical/case
stripped) against a synonym set; three parsers are tried in order and the first to yield items wins.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from codechroma.requirements.models import Requirement

CRITERIA_SYNONYMS = {"acceptance criteria", "success criteria", "key deliverables"}

_LEADING_NUMBER_RE = re.compile(r"^\d+[.)]?\s*")
_TRAILING_ANNOTATION_RE = re.compile(r"\s*[*_]{0,2}\([^)]*\)[*_]{0,2}\s*$")
_HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*$", re.MULTILINE)
_CHECKLIST_RE = re.compile(r"^[-*]\s*\[([ xXoO]?)\]\s*(.+)$")
_CITATION_RE = re.compile(r"^\s*[—-]\s*(\S.*)$")
_GWT_START_RE = re.compile(r"^\*{0,2}given\b", re.IGNORECASE)
_ILLUSTRATIVE_RE = re.compile(r"^\*{0,2}illustrative", re.IGNORECASE)
_BULLET_RE = re.compile(r"^(?:[-*]|\d+[.)])\s+(.+)$")


def split_frontmatter(text: str) -> tuple[dict, str]:
    """Splits a leading ---/--- YAML block from the body; malformed input yields ({}, text)."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    head = text[3:end]
    rest = text[end + 4 :]
    newline = rest.find("\n")
    body = rest[newline + 1 :] if newline != -1 else ""
    try:
        data = yaml.safe_load(head)
    except yaml.YAMLError:
        return {}, text
    return (data if isinstance(data, dict) else {}), body


def read_frontmatter_only(path: Path) -> dict | None:
    """Reads the leading ---/--- block's raw bytes; a bad body encoding can't taint this read."""
    try:
        with path.open("rb") as handle:
            if handle.readline().rstrip(b"\r\n") != b"---":
                return None
            raw = bytearray()
            for line in handle:
                if line.rstrip(b"\r\n") == b"---":
                    break
                raw += line
            else:
                return None
    except OSError:
        return None
    try:
        head = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    try:
        data = yaml.safe_load(head)
    except yaml.YAMLError:
        return None
    return data if isinstance(data, dict) else None


def normalize_heading(raw: str) -> str:
    """Drops a leading "N." ordinal and a trailing italic parenthetical, then casefolds."""
    text = _LEADING_NUMBER_RE.sub("", raw.strip())
    text = _TRAILING_ANNOTATION_RE.sub("", text)
    return text.rstrip(":").strip().casefold()


def find_section(body: str, names: set[str] = CRITERIA_SYNONYMS) -> str | None:
    """Text between a heading whose normalized name is in `names` and the next same/higher one."""
    headings = list(_HEADING_RE.finditer(body))
    for index, match in enumerate(headings):
        if normalize_heading(match.group(2)) not in names:
            continue
        level = len(match.group(1))
        start = match.end()
        end = len(body)
        for later in headings[index + 1 :]:
            if len(later.group(1)) <= level:
                end = later.start()
                break
        return body[start:end].strip()
    return None


def _split_citation(text: str, default_source_ref: str) -> tuple[str, str]:
    """Splits a trailing "— docs/... §x" citation line off `text` (FR-031)."""
    lines = text.splitlines()
    if lines and (citation := _CITATION_RE.match(lines[-1])):
        return "\n".join(lines[:-1]).strip(), citation.group(1).strip()
    return text, default_source_ref


def _parse_checklist(section: str, default_source_ref: str) -> list[Requirement]:
    """Parser 1: `- [ ]` / `- [x]` lines, case-insensitive completion (FR-017)."""
    requirements: list[Requirement] = []
    for index, line in enumerate(section.splitlines(), start=1):
        match = _CHECKLIST_RE.match(line.strip())
        if not match:
            continue
        text, source_ref = _split_citation(match.group(2).strip(), default_source_ref)
        requirements.append(
            Requirement(
                id=f"checklist-{index}",
                text=text,
                kind="checklist",
                done=match.group(1).strip().lower() == "x",
                source_ref=source_ref,
            )
        )
    return requirements


def _blocks(section: str) -> list[str]:
    return [block.strip() for block in re.split(r"\n\s*\n", section) if block.strip()]


def _parse_given_when_then(section: str, default_source_ref: str) -> list[Requirement]:
    """Parser 2: blank-line-separated Given/When/Then blocks; a `**Illustrative` one is excluded."""
    requirements: list[Requirement] = []
    ordinal = 0
    for block in _blocks(section):
        if _ILLUSTRATIVE_RE.match(block):
            continue
        if not any(_GWT_START_RE.match(line.strip()) for line in block.splitlines()):
            continue
        ordinal += 1
        text, source_ref = _split_citation(block, default_source_ref)
        requirements.append(
            Requirement(
                id=f"gwt-{ordinal}",
                text=text,
                kind="given-when-then",
                done=None,
                source_ref=source_ref,
            )
        )
    return requirements


def _parse_prose(section: str, default_source_ref: str) -> list[Requirement]:
    """Parser 3 (fallback): plain bulleted/numbered lines, no checkbox -- kind "functional"."""
    requirements: list[Requirement] = []
    for index, line in enumerate(section.splitlines(), start=1):
        match = _BULLET_RE.match(line.strip())
        if not match:
            continue
        text, source_ref = _split_citation(match.group(1).strip(), default_source_ref)
        requirements.append(
            Requirement(
                id=f"prose-{index}", text=text, kind="functional", done=None, source_ref=source_ref
            )
        )
    return requirements


def relative_source_ref(path: Path, repo_root: Path) -> str:
    """`path` relative to `repo_root`, or the path itself when it isn't underneath it."""
    try:
        return str(path.relative_to(repo_root))
    except ValueError:
        return str(path)


def parse_criteria(body: str, default_source_ref: str) -> list[Requirement]:
    """Locates the criteria section and tries each body parser in order; first non-empty wins."""
    section = find_section(body)
    if section is None:
        return []
    for parser in (_parse_checklist, _parse_given_when_then, _parse_prose):
        requirements = parser(section, default_source_ref)
        if requirements:
            return requirements
    return []
