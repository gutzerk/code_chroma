"""The plain-wiki context wiki-general's own worker jobs read -- no navigation, one sentence each.

build_wiki_context() (wiki_context.py) walks root-to-leaf navigation for a caller that doesn't yet
know where a path lives -- a diagram-drawing skill exploring from scratch. wiki-general's own
write-c3/resolve-undetermined jobs never explore: their file list is already fixed by clustering
before the call, so the root index and ancestor-folder walk buy nothing, and were pushing real
per-file content past the char budget (docs/planning/wiki-general-vllm-prompt-sample.md's
vllm_test.go truncation writeup). build_job_context() reads each file's own page directly instead,
and trim_to_first_sentence() reduces every module/class/bullet docstring in it to one sentence --
the job's own output is already one line per element, so a full docstring mostly buys nuance over a
one-sentence one, not length.
"""

from __future__ import annotations

import re
from pathlib import Path

from codechroma.bridge.wiki_context import WikiContextBundle, WikiContextPage, safe_file_text
from codechroma.config import settings
from codechroma.io import CharBudget, read_text
from codechroma.wiki.writer import NO_BREAKDOWN as _NO_BREAKDOWN

__all__ = ["build_job_context", "first_sentence", "trim_to_first_sentence"]

_HEADER_RE = re.compile(r"^(#{1,6})\s")
_BULLET_RE = re.compile(r"^- `([^`]+)` — (.*)$")
_ABBREVIATIONS = frozenset({"e.g", "i.e", "etc", "vs", "cf", "approx"})
_SENTENCE_END_RE = re.compile(r"[.!?]+(?=\s|$)")
# Letters with optional internal dots, so a lookback before the cut sees "e.g" whole, not just "g".
_ABBREV_TAIL_RE = re.compile(r"([a-zA-Z]+(?:\.[a-zA-Z]+)*)$")


def first_sentence(text: str) -> str:
    """The first real sentence in text -- cuts at ./!/?, skipping "e.g."-style abbreviations."""
    for match in _SENTENCE_END_RE.finditer(text):
        tail = _ABBREV_TAIL_RE.search(text[: match.start()])
        if tail is not None and tail.group(1).lower() in _ABBREVIATIONS:
            continue
        return text[: match.end()]
    return text


def _is_boundary(line: str) -> bool:
    """A header, a bullet, or the fixed no-breakdown marker -- where one doc block ends."""
    if _HEADER_RE.match(line) or _BULLET_RE.match(line):
        return True
    return line.strip() == _NO_BREAKDOWN


def _collect_body(lines: list[str], start: int) -> tuple[list[str], int]:
    """Lines from start up to the next boundary, plus the index that boundary starts at."""
    n = len(lines)
    j = start
    body: list[str] = []
    while j < n and not _is_boundary(lines[j]):
        body.append(lines[j])
        j += 1
    return body, j


def trim_to_first_sentence(markdown: str) -> str:
    """Reduces every module/class/bullet docstring in a rendered wiki file page to one sentence."""
    lines = markdown.split("\n")
    out: list[str] = []
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        bullet = _BULLET_RE.match(line)
        if bullet is not None:
            name, first = bullet.group(1), bullet.group(2)
            body, j = _collect_body(lines, i + 1)
            doc = first_sentence("\n".join([first, *body]).strip())
            out.append(f"- `{name}` — {doc}")
            i = j
            continue
        header = _HEADER_RE.match(line)
        if header is not None and header.group(1) in ("#", "###"):
            out.append(line)
            body, j = _collect_body(lines, i + 1)
            text = "\n".join(body).strip()
            if text:
                out.append("")
                out.append(first_sentence(text))
            i = j
            continue
        out.append(line)
        i += 1
    return "\n".join(out)


def build_job_context(wiki_dir: Path, paths: list[str]) -> WikiContextBundle:
    """Each path's own file page, one-sentence-trimmed -- no root index, no ancestor-folder walk."""
    if read_text(wiki_dir / "index.md") is None:
        return WikiContextBundle(has_wiki=False, root=None)

    budget = CharBudget(max_chars=settings.wiki_context.max_chars, used=0)
    pages: list[WikiContextPage] = []
    gaps: list[str] = []
    for path in paths:
        if budget.truncated:
            break
        raw = safe_file_text(wiki_dir, path)
        if raw is None:
            gaps.append(path)
            continue
        content = trim_to_first_sentence(raw)
        if not budget.try_add(content):
            break
        pages.append(WikiContextPage(path=path, kind="file", content=content))

    return WikiContextBundle(
        has_wiki=True, root=None, pages=pages, gaps=gaps, truncated=budget.truncated
    )
