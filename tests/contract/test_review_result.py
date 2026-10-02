"""Contract: `ReviewResult`'s shape (037, data-model.md / review-result.md).

The explanatory axis (impact) populates `entries[].explanation` and nulls `severity`.
It moved here from c1 in the same follow-up that removed the judgmental axis (038 follow-up).
half-wired; a type with no `review` config resolves to `None`, covered below by "patterns" and "c1".
"""

from __future__ import annotations

import json

from codechroma.bridge.overlays import impact_changes_path
from codechroma.bridge.review import resolve_review

_IMPACT_DIAGRAM = {
    "nodes": [{"id": "billing", "name": "Billing", "node_id": "component::billing.py"}],
    "relations": [],
}


def _write_impact(ws, changes: dict | None = None) -> None:
    diagram_path = ws.diagram_artifact_path("impact")
    diagram_path.parent.mkdir(parents=True, exist_ok=True)
    diagram_path.write_text(json.dumps(_IMPACT_DIAGRAM))
    if changes is not None:
        path = impact_changes_path(ws.root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(changes))


def test_explanatory_axis_populates_explanation_and_nulls_severity(bridge):
    ws = bridge.main
    _write_impact(ws, changes={
        "fingerprint": "f",
        "summary": "renamed a function",
        "blocks": [{"block": "billing", "before": "old", "after": "new"}],
    })

    result = resolve_review(ws, "impact")

    assert result["axis"] == "explanatory"
    assert {"fingerprint", "summary", "axis", "entries", "ghosts", "relationships"} <= set(result)
    entry = next(e for e in result["entries"] if e["node_id"] == "billing")
    assert entry["explanation"]["before"] == "old"
    assert entry["severity"] is None


def test_a_type_with_no_review_flow_resolves_to_none(bridge):
    ws = bridge.main

    result = resolve_review(ws, "patterns")

    assert result is None


def test_c1_resolves_to_none_since_the_explanatory_axis_moved_to_impact(bridge):
    ws = bridge.main

    result = resolve_review(ws, "c1")

    assert result is None
