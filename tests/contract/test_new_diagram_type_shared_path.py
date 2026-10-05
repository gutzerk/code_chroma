"""US3 (036-shared-diagram-style-catalog): a diagram kind nobody wrote a resolver for renders
through the shared path with zero new plumbing -- the strongest form of the claim. A brand-new
custom type needs no new `DiagramSpec` entry, no new resolver, no new reshape/render code: saving a
`library` definition and an authored `.codechroma/custom/<id>.json` is enough, because
`DiagramRegistry._synthesize_custom` already wires every custom type's `resolve` closure straight to
`resolve_diagram()` (diagram_resolver.py). This is the one type this repo did not know about at
036-plan time -- "onboarding-flow" -- proving the generalization by using it, not by reading it.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from codechroma.diagrams import library

NEW_TYPE = {
    "id": "onboarding-flow",
    "title": "Onboarding flow",
    "style": "layered-flow",
    "layout": {"direction": "TB"},
    "grouping": {"enabled": True, "label": "Stage"},
    "relation_kinds": [{"id": "leads_to", "label": "leads to"}],
    "instructions": "One box per onboarding step, grouped by stage.",
}


@pytest.fixture(autouse=True)
def _isolated_library(tmp_path, monkeypatch):
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))


def test_a_brand_new_custom_type_renders_through_the_shared_resolver_with_no_new_code(bridge):
    library.save_type(NEW_TYPE)
    diagram_path = (
        bridge.repo
        / ".codechroma"
        / "diagrams"
        / "custom"
        / "onboarding-flow"
        / "onboarding-flow.json"
    )
    diagram_path.parent.mkdir(parents=True, exist_ok=True)
    diagram_path.write_text(
        json.dumps(
            {
                "nodes": [
                    {
                        "id": "signup",
                        "name": "Sign up",
                        "group": "Start",
                        "path": "billing/service.py",
                    },
                    {"id": "verify", "name": "Verify email", "group": "Start"},
                    {"id": "dangling", "name": "Ghost step", "group": "Start"},
                ],
                "relations": [
                    {"from": "signup", "to": "verify", "kind": "leads_to", "label": "then"},
                    {"from": "signup", "to": "nowhere", "kind": "leads_to"},
                ],
            }
        )
, encoding="utf-8")

    with TestClient(bridge.app) as client:
        body = client.get("/repos/default/custom/onboarding-flow").json()

    # Path resolution, dangling-relation drop, and grouping -- with zero per-type code.
    nodes = {node["id"]: node for node in body["nodes"]}
    assert nodes["signup"]["node_id"] == "component::billing/service.py"
    assert [rel["to"] for rel in body["relations"]] == ["verify"]
    assert body["groups"] == ["Start"]
    assert body["diagnostics"]["dropped"][0]["reason"] == "dangling_endpoint"
    # Coverage + staleness are opt-in add-ons every custom type already gets (FR-005/FR-006).
    assert "unmapped" in body
    assert "stale" in body
