#!/usr/bin/env python3
"""Checks a decision-diagram draft ({title, nodes, edges}) against the node budget; prints OK."""

from __future__ import annotations

import json
import sys

MAX_NODES = 12


def problems(spec: dict) -> list[str]:
    """One line per budget, label or reference problem."""
    nodes, edges = spec.get("nodes") or [], spec.get("edges") or []
    found: list[str] = []
    if not (spec.get("title") or "").strip():
        found.append("title is empty")
    if not 1 <= len(nodes) <= MAX_NODES:
        found.append(f"give 1-{MAX_NODES} nodes, got {len(nodes)}")
    ids = [node.get("id") for node in nodes]
    if len(set(ids)) != len(ids):
        found.append("node ids are not unique")
    found.extend(
        f"node {n.get('id')!r}: empty label" for n in nodes if not n.get("label", "").strip()
    )
    found.extend(
        f"edge {e.get('from')}->{e.get('to')}: unknown node"
        for e in edges
        if e.get("from") not in ids or e.get("to") not in ids
    )
    return found


def main(argv: list[str]) -> int:
    """Reads the JSON file named in argv[1]; exit 0 and OK when clean, else 1 with the problems."""
    if len(argv) != 2:
        print("usage: check_decision_diagram.py <draft.json>")
        return 2
    with open(argv[1], encoding="utf-8") as handle:
        found = problems(json.load(handle))
    print("\n".join(f"- {p}" for p in found) if found else "OK")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
