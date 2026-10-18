#!/usr/bin/env python3
"""Verifies the just-written wiki-general tree before the skill reports success.

Run after writing manifest.json and every page. Unlike check_diagram.py/check_brief.py, there is no
resolved HTTP GET for wiki-general to read (see 047-wiki-general's planning doc -- this is a
full-replace markdown page tree, not a server-merged artifact), so this reads the files on disk
directly, the same way the skill itself just wrote them. It still makes one HTTP call: each declared
File/Class/Function reference's path is checked against GET /repos/{id}/wiki-context, the same
route the skill used to ground itself, so a path the real wiki has no page for fails the run.
Stdlib only -- it runs inside the analyzed repo, where codechroma itself isn't importable.

Exit codes: 0 OK (advisories may still print) -- 1 FAILED (see the printed lines) -- 2 ERROR (the
manifest or a listed page could not be read, or the wiki-context call itself failed).

`--strip-connects PAGE TARGET_ID` is a second, unrelated mode: mechanically removes one
still-invalid `Connects:` line the skill's own batched correction pass didn't fix (never calls a
model itself -- stdlib-only) -- 0 removed, 2 no matching line found. See
docs/architecture/wiki-general.md's self-check section for the full batched-fixup-then-fail flow.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

_FETCH_TIMEOUT_SECONDS = 10
_REF_RE = re.compile(r"^\s*-\s+(?:File|Class|Function):\s+`([^`]+)`\s*$", re.MULTILINE)
_CONNECTS_RE = re.compile(r"^\s*-\s+Connects:\s+`([^`]+)`\s*$", re.MULTILINE)
_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\)")


@dataclass
class _Report:
    broken: list[str] = field(default_factory=list)
    advisory: list[str] = field(default_factory=list)
    pages_checked: int = 0
    refs_checked: int = 0


def run_checks(wiki_dir: Path, fetch_gaps) -> tuple[int, list[str]]:
    """The whole check, minus argv/printing -- returns (0/1/2 exit code, the lines to print)."""
    manifest_path = wiki_dir / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except OSError as exc:
        return 2, [f"ERROR could not read {manifest_path}: {exc}"]
    except ValueError as exc:
        return 2, [f"ERROR {manifest_path} is not valid JSON: {exc}"]

    report = _Report()
    containers = _as_list(manifest.get("containers"))
    components = _as_list(manifest.get("components"))
    edges = _as_list(manifest.get("edges"))
    _check_unique_ids(containers, "container", report)
    _check_unique_ids(components, "component", report)
    container_ids = {c["id"] for c in containers if isinstance(c.get("id"), str)}
    _check_membership(components, container_ids, report)
    _check_containers_nonempty(containers, components, report)
    _check_connects(wiki_dir, containers + components, edges, report)

    refs: set[str] = set()
    entries = [
        (wiki_dir / "index.md", "root"),
        *_page_entries(wiki_dir, containers, "c2"),
        *_page_entries(wiki_dir, components, "c3"),
    ]
    for entry, kind in entries:
        refs |= _check_page(entry, kind, report)

    root_targets = _target_paths(wiki_dir, containers)
    _check_links(wiki_dir, wiki_dir / "index.md", root_targets, "root", report)
    for container in containers:
        c_path = container.get("path")
        if not isinstance(c_path, str):
            continue
        owned = [c for c in components if c.get("container") == container.get("id")]
        label = f"container {container.get('id')!r}"
        _check_links(wiki_dir, wiki_dir / c_path, _target_paths(wiki_dir, owned), label, report)

    try:
        _check_refs_resolve(fetch_gaps, refs, report)
    except (OSError, ValueError) as exc:
        return 2, [f"ERROR could not verify wiki-context references: {exc}"]

    if report.broken:
        return 1, [*report.broken, f"FAILED {len(report.broken)} issue(s) -- see lines above"]
    tail = f"OK: {report.pages_checked} page(s), {report.refs_checked} code reference(s) resolved"
    return 0, [*report.advisory, tail]


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    # Absolute, so _check_links' relative_to() against resolved page paths can't raise.
    root = Path(args.dir).resolve()
    wiki_dir = root / ".codechroma" / "wiki-general"

    if args.strip_connects:
        page_rel, target_id = args.strip_connects
        if _strip_connects_line(wiki_dir / page_rel, target_id):
            print(f"STRIPPED Connects: `{target_id}` from {page_rel}")
            return 0
        print(f"ERROR no such Connects: `{target_id}` line found in {page_rel}", file=sys.stderr)
        return 2

    exit_code, lines = run_checks(wiki_dir, _http_gap_fetcher(args.url, args.repo))
    for line in lines:
        print(line, file=sys.stderr if exit_code == 2 else sys.stdout)
    return exit_code


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check the just-written wiki-general tree.")
    parser.add_argument("--url", default="http://localhost:8000", help="bridge base URL")
    parser.add_argument("--repo", default="default", help="repo id in the bridge route")
    parser.add_argument("--dir", default=".", help="repo root on disk (defaults to cwd)")
    parser.add_argument(
        "--strip-connects",
        nargs=2,
        metavar=("PAGE", "TARGET_ID"),
        help="remove one still-invalid Connects: line (PAGE relative to wiki-general/), then exit",
    )
    return parser.parse_args(argv)


def _as_list(value: object) -> list[dict]:
    return [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []


def _check_unique_ids(entries: list[dict], noun: str, report: _Report) -> None:
    seen: dict[str, int] = {}
    for entry in entries:
        entry_id = entry.get("id")
        if isinstance(entry_id, str):
            seen[entry_id] = seen.get(entry_id, 0) + 1
    for entry_id, count in sorted(seen.items()):
        if count > 1:
            report.broken.append(f"DUPLICATE {noun} id {entry_id!r} used {count} times")


def _check_membership(components: list[dict], container_ids: set[str], report: _Report) -> None:
    for component in components:
        container = component.get("container")
        if container not in container_ids:
            report.broken.append(
                f"DANGLING component {component.get('id')!r} names container {container!r},"
                " which does not exist"
            )


def _check_containers_nonempty(
    containers: list[dict], components: list[dict], report: _Report
) -> None:
    owned = {c.get("container") for c in components}
    for container in containers:
        if container.get("id") not in owned:
            report.broken.append(f"EMPTY-CONTAINER {container.get('id')!r} has no components")


def _page_entries(wiki_dir: Path, entries: list[dict], subdir: str) -> list[tuple[Path, str]]:
    result = []
    for entry in entries:
        path = entry.get("path")
        if isinstance(path, str):
            result.append((wiki_dir / path, subdir))
    return result


def _target_paths(wiki_dir: Path, entries: list[dict]) -> set[Path]:
    return {
        (wiki_dir / entry["path"]).resolve()
        for entry in entries
        if isinstance(entry.get("path"), str)
    }


def _check_links(
    wiki_dir: Path, page: Path, expected: set[Path], label: str, report: _Report
) -> None:
    """Advisory: every container/component should be reachable by a click from its parent page."""
    try:
        text = page.read_text(encoding="utf-8")
    except OSError:
        return  # already reported as MISSING-PAGE below
    linked = {(page.parent / match.group(1)).resolve() for match in _LINK_RE.finditer(text)}
    for target in sorted(expected - linked):
        rel = target.relative_to(wiki_dir).as_posix()
        report.advisory.append(f"LINK-MISSING {label} page never links to {rel}")


def _connects_neighbors(edges: list[dict]) -> dict[str, set[str]]:
    neighbors: dict[str, set[str]] = {}
    for edge in edges:
        from_id, to_id = edge.get("from"), edge.get("to")
        if isinstance(from_id, str) and isinstance(to_id, str):
            neighbors.setdefault(from_id, set()).add(to_id)
            neighbors.setdefault(to_id, set()).add(from_id)
    return neighbors


def _check_connects(
    wiki_dir: Path, entries: list[dict], edges: list[dict], report: _Report
) -> None:
    """One-way: a claimed Connects: target with no matching edges[] entry fails; omission is OK."""
    neighbors = _connects_neighbors(edges)
    for entry in entries:
        entry_id, path = entry.get("id"), entry.get("path")
        if not isinstance(entry_id, str) or not isinstance(path, str):
            continue
        try:
            text = (wiki_dir / path).read_text(encoding="utf-8")
        except OSError:
            continue  # already reported as MISSING-PAGE by _check_page
        claimed = {m.group(1) for m in _CONNECTS_RE.finditer(text)}
        for target in sorted(claimed - neighbors.get(entry_id, set())):
            report.broken.append(
                f"CONNECTS-INVALID {entry_id!r} claims a connection to {target!r},"
                " which has no matching edges[] entry"
            )


def _strip_connects_line(page_path: Path, target_id: str) -> bool:
    """Removes one `- Connects: `<target_id>`` line from page_path; True if one was found."""
    try:
        text = page_path.read_text(encoding="utf-8")
    except OSError:
        return False
    pattern = re.compile(rf"^[ \t]*-\s+Connects:\s+`{re.escape(target_id)}`\s*\n?", re.MULTILINE)
    new_text, count = pattern.subn("", text)
    if count == 0:
        return False
    page_path.write_text(new_text, encoding="utf-8")
    return True


def _check_page(path: Path, kind: str, report: _Report) -> set[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        report.broken.append(f"MISSING-PAGE {kind} page {path} does not exist")
        return set()
    report.pages_checked += 1
    return {match.group(1) for match in _REF_RE.finditer(text)}


def _http_gap_fetcher(url: str, repo: str):
    """The CLI's own gap-fetching strategy -- a real HTTP round trip to a running bridge."""

    def fetch(paths: list[str]) -> set[str]:
        query = urllib.parse.quote(",".join(paths), safe=",/")
        request_url = f"{url.rstrip('/')}/repos/{repo}/wiki-context?paths={query}"
        with urllib.request.urlopen(request_url, timeout=_FETCH_TIMEOUT_SECONDS) as response:
            bundle = json.loads(response.read().decode("utf-8"))
        return set(bundle.get("gaps") or []) if isinstance(bundle, dict) else set(paths)

    return fetch


def _check_refs_resolve(fetch_gaps, refs: set[str], report: _Report) -> None:
    """Strips a `path::Symbol` reference, then checks the path via the pluggable `fetch_gaps`."""
    paths = sorted({ref.split("::", 1)[0] for ref in refs})
    if not paths:
        return
    gaps = fetch_gaps(paths)
    report.refs_checked += len(paths) - len(gaps & set(paths))
    for path in paths:
        if path in gaps:
            report.broken.append(f"HALLUCINATED {path!r} matches no page in .codechroma/wiki/")


if __name__ == "__main__":
    sys.exit(main())
