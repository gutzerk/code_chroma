#!/usr/bin/env python3
"""Verifies the just-written EpicBrief before the skill reports success.

Run after writing <epic_id>.json. Reads the bridge's own GET .../brief route (which returns what
the canvas will actually render) rather than the file on disk directly. Stdlib only -- it runs
inside the analyzed repo, where codechroma itself is not importable.

Checks: every scope-item/task/acceptance-criterion id is unique across the whole brief; every
`closes_scope_id` is either null or a real scope-item id; no out-of-scope item carries tasks. When
the brief names spokes, an advisory (non-blocking) pass flags in-scope tasks that carry no `repo`
tag.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field

_FETCH_TIMEOUT_SECONDS = 10


@dataclass
class _Report:
    broken: list[str] = field(default_factory=list)
    # Advisory (non-blocking) lines -- printed but never fail the run.
    advisory: list[str] = field(default_factory=list)
    # id -> how many scope items/tasks/criteria claim it; every id must be unique across the brief.
    ids: dict[str, int] = field(default_factory=dict)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        brief = _load_brief(args)
    except (OSError, urllib.error.URLError, ValueError) as exc:
        print(f"ERROR could not read the brief: {exc}", file=sys.stderr)
        return 2
    if brief is None:
        print("ERROR the brief job has no data yet", file=sys.stderr)
        return 2

    report = _inspect(brief)
    for line in report.broken:
        print(line)
    if report.broken:
        print(f"FAILED {len(report.broken)} issue(s) -- see lines above")
        return 1
    for line in report.advisory:
        print(line)
    print(f"OK: {len(report.ids)} id(s) resolved")
    return 0


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check the just-written EpicBrief.")
    parser.add_argument("--url", default="http://localhost:8000", help="bridge base URL")
    parser.add_argument("--repo", default="default", help="repo id in the bridge route")
    parser.add_argument("--item", required=False, help="epic id, e.g. LMP-65")
    parser.add_argument("--json", dest="json_path", help="read a raw brief file instead")
    return parser.parse_args(argv)


def _load_brief(args: argparse.Namespace) -> dict | None:
    if args.json_path:
        with open(args.json_path, encoding="utf-8") as handle:
            return json.load(handle)
    if not args.item:
        raise ValueError("--item is required unless --json is given")
    url = f"{args.url.rstrip('/')}/repos/{args.repo}/epics/{args.item}/brief"
    with urllib.request.urlopen(url, timeout=_FETCH_TIMEOUT_SECONDS) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload.get("brief") if isinstance(payload, dict) else None


def _inspect(brief: object) -> _Report:
    report = _Report()
    if not isinstance(brief, dict):
        report.broken.append("BROKEN <root> the brief is not a JSON object")
        return report

    for item in brief.get("scope") or []:
        _note_scope_item(item, report)
    for task in brief.get("prep_tasks") or []:
        _note_id(task, report)
    for criterion in brief.get("acceptance") or []:
        _note_id(criterion, report)

    _check_duplicates(report)
    _check_dangling_closes(brief.get("acceptance") or [], report)
    _check_spoke_tags(brief, report)
    _check_stage_tags(brief, report)
    return report


def _note_id(entry: object, report: _Report) -> None:
    if not isinstance(entry, dict):
        report.broken.append("BROKEN an entry is not a JSON object")
        return
    entry_id = entry.get("id")
    if isinstance(entry_id, str):
        report.ids[entry_id] = report.ids.get(entry_id, 0) + 1


def _note_scope_item(item: object, report: _Report) -> None:
    if not isinstance(item, dict):
        report.broken.append("BROKEN a scope item is not a JSON object")
        return
    _note_id(item, report)
    tasks = item.get("tasks") or []
    if item.get("in_scope") is False and tasks:
        report.broken.append(
            f"TASKS-ON-OUT-OF-SCOPE {item.get('id')!r} carries {len(tasks)} task(s)"
        )
    for task in tasks:
        _note_id(task, report)


def _check_duplicates(report: _Report) -> None:
    for entry_id, count in sorted(report.ids.items()):
        if count > 1:
            report.broken.append(
                f"DUPLICATE {entry_id!r} is claimed by {count} entries -- every id must be unique"
                " across the whole brief"
            )


def _check_dangling_closes(acceptance: list, report: _Report) -> None:
    for criterion in acceptance:
        if not isinstance(criterion, dict):
            continue
        closes = criterion.get("closes_scope_id")
        if closes is not None and closes not in report.ids:
            report.broken.append(f"DANGLING {closes!r} matches no scope item id")


def _check_stage_tags(brief: dict, report: _Report) -> None:
    """Advisory only: a `tasks_source: "spec"` task without `stage` can't be spliced safely when
    another spec has a same-numbered task -- the resolver then keeps whatever the model wrote."""
    for item in brief.get("scope") or []:
        if not isinstance(item, dict) or item.get("tasks_source") != "spec":
            continue
        for task in item.get("tasks") or []:
            if isinstance(task, dict) and not task.get("stage"):
                report.advisory.append(
                    f"STAGE-MISSING {task.get('id')!r} is a spec task with no `stage` -- a"
                    " same-numbered task in another spec may overwrite its text"
                )
    for task in brief.get("prep_tasks") or []:
        if isinstance(task, dict) and not task.get("stage"):
            report.advisory.append(
                f"STAGE-MISSING {task.get('id')!r} is a prep task with no `stage`"
            )


def _check_spoke_tags(brief: dict, report: _Report) -> None:
    """Advisory only: when the epic names spokes, in-scope tasks should carry a repo naming one."""
    spokes = brief.get("spokes") or []
    if not spokes:
        return
    known = {entry.get("spoke") for entry in spokes if isinstance(entry, dict)}
    for item in brief.get("scope") or []:
        if not isinstance(item, dict) or item.get("in_scope") is False:
            continue
        for task in item.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            repo = task.get("repo")
            if not isinstance(repo, str) or not repo:
                task_id = task.get("id")
                report.advisory.append(
                    f"SPOKE-MISSING {task_id!r} carries no repo tag under spokes {sorted(known)}"
                )


if __name__ == "__main__":
    sys.exit(main())
