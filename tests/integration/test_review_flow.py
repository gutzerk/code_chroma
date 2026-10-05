"""US3 Scenario 1 (037): one review flow, reached over `GET /repos/{id}/{kind}/review`, produces the
`ReviewResult` shape for an explanatory type (impact) -- contracts/review-result.md. The judgmental
axis was removed rather than kept half-wired (038 follow-up), and the explanatory axis itself moved
from c1 to impact in the same follow-up -- see docs/architecture/diagram-skills.md.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from codechroma.bridge.overlays import impact_changes_path

_IMPACT_DIAGRAM = {
    "nodes": [{"id": "billing", "name": "Billing", "node_id": "component::billing.py"}],
    "relations": [],
}


def test_explanatory_type_review_route_returns_explanation_not_severity(bridge):
    ws = bridge.main
    diagram_path = ws.diagram_artifact_path("impact")
    diagram_path.parent.mkdir(parents=True, exist_ok=True)
    diagram_path.write_text(json.dumps(_IMPACT_DIAGRAM), encoding="utf-8")
    impact_changes_path(ws.root).write_text(json.dumps({
        "fingerprint": "f", "summary": "renamed", "blocks": [{"block": "billing", "before": "x"}],
    }), encoding="utf-8")

    with TestClient(bridge.app) as client:
        body = client.get("/repos/default/impact/review").json()

    assert body["axis"] == "explanatory"
    entry = next(e for e in body["entries"] if e["node_id"] == "billing")
    assert entry["explanation"] is not None
    assert entry["severity"] is None


def test_a_type_with_no_review_flow_returns_404(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/patterns/review")

    assert response.status_code == 404


def test_c1_has_no_review_flow_since_the_explanatory_axis_moved_to_impact(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/c1/review")

    assert response.status_code == 404
