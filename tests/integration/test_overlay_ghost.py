"""US2 Scenario 2 (037): a block a change removes isn't in the current diagram's `nodes[]`, so its
`OverlayRecord` has to arrive some other way -- the authored review's `ghosts[]` entry, surfaced on
the resolved diagram's own top-level `ghosts[]` array (contracts/overlay.md, data-model.md's
post-analysis fix: never an `is_ghost` flag on a shared list). The `"changes"` overlay lives on
`impact` now, not `c1` -- see docs/architecture/diagram-skills.md.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from tests.conftest import diagram_json_path

_IMPACT = {
    "type": "impact",
    "nodes": [{"id": "billing", "name": "Billing", "node_id": "component::billing/service.py"}],
    "relations": [],
}


def _write_json(path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def test_a_removed_blocks_ghost_still_appears_after_regenerating(bridge):
    _write_json(diagram_json_path(bridge.repo, "impact"), _IMPACT)
    _write_json(
        bridge.repo / ".codechroma" / "impact-changes.json",
        {
            "summary": "Removed the legacy invoicing block.",
            "ghosts": [
                {
                    "id": "legacy-invoicing",
                    "parent": "billing",
                    "name": "Legacy invoicing",
                    "before": "Handled invoices directly.",
                    "after": "",
                }
            ],
        },
    )

    with TestClient(bridge.app) as client:
        resolved = client.get("/repos/default/impact").json()

    assert [n["id"] for n in resolved["nodes"]] == ["billing"]
    ghost = next(g for g in resolved["ghosts"] if g["id"] == "legacy-invoicing")
    assert ghost["parent"] == "billing"
    assert ghost["overlays"]["changes"]["before"] == "Handled invoices directly."
