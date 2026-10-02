#!/usr/bin/env python3
"""Verifies a written diagram review resolves against the bridge (explanatory axis).

Replaces `check_c1_changes.py`, standardized on the HTTP-fetch transport: `GET /repos/{id}/{kind}` +
`GET /repos/{id}/{kind}/review` (037-total-diagram-unification, US3, T043 --
contracts/review-result.md's transport decision and check table). The judgmental axis (impact) was
removed rather than kept half-wired (038 follow-up), so this only ever inspects `axis="explanatory"`
today (moved from c1 to impact in the same follow-up); `--json` is optional and only sharpens the
report: several problems (a dropped block id) never reach the resolved response at all, since the
bridge silently drops them -- reading the file as written is the only way to name them. Stdlib
only -- it runs inside the analyzed repo, where codechroma itself is not importable.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

_FETCH_TIMEOUT_SECONDS = 10


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        review = _fetch(args, "review")
        authored = _read_authored(args)
    except (OSError, urllib.error.URLError, ValueError) as exc:
        print(f"ERROR could not read the review: {exc}", file=sys.stderr)
        return 2

    axis = review.get("axis")
    problems, advisories = _inspect_explanatory(review, authored, args.kind)

    for line in advisories + problems:
        print(line)
    if problems:
        print(f"FAILED {len(problems)} problem(s) in the review")
        return 1
    entry_count = len(review.get("entries", []))
    print(f"OK: {entry_count} entr{'y' if entry_count == 1 else 'ies'} ({axis})")
    return 0


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check a written diagram review (explanatory axis)."
    )
    default_url = os.environ.get("CODECHROMA_BRIDGE_URL", "http://localhost:8000")
    parser.add_argument("--url", default=default_url, help="bridge base URL")
    parser.add_argument("--repo", default="default", help="repo id in the bridge route")
    parser.add_argument(
        "--kind", required=True, help="diagram kind with a review flow, e.g. impact"
    )
    parser.add_argument("--json", dest="json_path", help="path to the written review file")
    return parser.parse_args(argv)


def _fetch(args: argparse.Namespace, route: str) -> dict:
    suffix = f"/{route}" if route else ""
    url = f"{args.url.rstrip('/')}/repos/{args.repo}/{args.kind}{suffix}"
    with urllib.request.urlopen(url, timeout=_FETCH_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def _read_authored(args: argparse.Namespace) -> dict:
    """The file as written, so ids the bridge silently dropped can still be named."""
    if not args.json_path:
        return {}
    with open(args.json_path, encoding="utf-8") as handle:
        return json.load(handle)


def _shared_checks(review: dict) -> list[str]:
    """NOFINGERPRINT/STALE checks any review must pass regardless of the diagram kind."""
    problems = []
    if not review.get("has_review"):
        problems.append("NOREVIEW the bridge sees no review file -- wrote to the wrong path?")
    if not review.get("fingerprint"):
        problems.append("NOFINGERPRINT")
    if review.get("stale"):
        problems.append(
            "STALE fingerprint does not match the current diff/slice -- re-review the latest change"
        )
    return problems


def _inspect_explanatory(review: dict, authored: dict, kind: str) -> tuple[list[str], list[str]]:
    """axis="explanatory": a dropped `block`/ghost id is BROKEN; unexplained is advisory."""
    problems = _shared_checks(review)
    advisories: list[str] = []

    resolved_ids = {e.get("node_id") for e in review.get("entries") or [] if isinstance(e, dict)}
    for block_id in _authored_field(authored, "blocks", "block"):
        if block_id not in resolved_ids:
            problems.append(f"BROKEN {block_id} is not a block in the diagram -- check the node_id")

    resolved_ghosts = {g.get("node_id") for g in review.get("ghosts") or [] if isinstance(g, dict)}
    for ghost in authored.get("ghosts") or []:
        if not isinstance(ghost, dict):
            continue
        node_id = f"{kind}-ghost::{ghost.get('parent')}/{ghost.get('id')}"
        if node_id not in resolved_ghosts:
            problems.append(f"BROKEN ghost {ghost.get('id')} names an unknown parent block")

    for entry in review.get("entries") or []:
        if not isinstance(entry, dict):
            continue
        explanation = entry.get("explanation") or {}
        has_prose = explanation.get("before") or explanation.get("after")
        if explanation.get("change_count") and not has_prose:
            advisories.append(f"UNEXPLAINED {entry.get('node_id')} has changes but no before/after")
    return problems, advisories


def _authored_field(authored: dict, list_key: str, field: str) -> list[str]:
    entries = authored.get(list_key)
    if not isinstance(entries, list):
        return []
    return [e[field] for e in entries if isinstance(e, dict) and isinstance(e.get(field), str)]


if __name__ == "__main__":
    sys.exit(main())
