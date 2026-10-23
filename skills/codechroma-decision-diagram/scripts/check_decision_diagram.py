#!/usr/bin/env python3
"""Checks a decision-diagram draft ({title, nodes, edges}) against the node budget; prints OK."""

from __future__ import annotations

import json
import sys

MAX_NODES = 12
MAX_ID = 40
MAX_TITLE = 80
MAX_LABEL = 60
MAX_DESCRIPTION = 300


def problems(spec: dict) -> list[str]:
    """One line per budget, label, length or reference problem (mirrors questions/diagrams.py)."""
    nodes, edges = spec.get("nodes") or [], spec.get("edges") or []
    title = spec.get("title") or ""
    found: list[str] = []
    if not title.strip():
        found.append("title is empty")
    elif len(title) > MAX_TITLE:
        found.append(f"title is longer than {MAX_TITLE} characters")
    if not 1 <= len(nodes) <= MAX_NODES:
        found.append(f"give 1-{MAX_NODES} nodes, got {len(nodes)}")
    ids = [node.get("id") for node in nodes]
    if len(set(ids)) != len(ids):
        found.append("node ids are not unique")
    for n in nodes:
        name = n.get("id")
        if not (name or "").strip():
            found.append("node with empty id")
        elif len(name) > MAX_ID:
            found.append(f'node "{name}": id is longer than {MAX_ID} characters')
        label = n.get("label") or ""
        if not label.strip():
            found.append(f'node "{name}": empty label')
        elif len(label) > MAX_LABEL:
            found.append(f'node "{name}": label is longer than {MAX_LABEL} characters')
        if len(n.get("description") or "") > MAX_DESCRIPTION:
            found.append(f'node "{name}": description is longer than {MAX_DESCRIPTION} characters')
    seen: set[tuple] = set()
    for e in edges:
        src, dst = e.get("from"), e.get("to")
        if src not in ids or dst not in ids:
            found.append(f"edge {src}->{dst}: unknown node")
        elif src == dst:
            found.append(f"edge {src}->{dst}: self-loop")
        elif (src, dst) in seen:
            found.append(f"edge {src}->{dst}: duplicate")
        seen.add((src, dst))
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
