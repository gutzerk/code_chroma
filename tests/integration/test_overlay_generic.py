"""US2 Scenario 1 (037): turning on the `"changes"` overlay on a second, non-c1 type -- using only
its `DiagramTypeDefinition.overlays` field -- badges that type's nodes exactly like c1's, with no
per-type overlay code (contracts/overlay.md's registry is name-keyed, not kind-keyed).
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from codechroma.diagrams import library
from tests.conftest import diagram_json_path

NEW_TYPE = {
    "id": "release-flow",
    "title": "Release flow",
    "style": "boxes-arrows",
    "layout": {"direction": "TB"},
    "grouping": {"enabled": False},
    "relation_kinds": [{"id": "triggers", "label": "triggers"}],
    "instructions": "One box per release step.",
    "overlays": ["changes"],
    "checks": {"shape": "flat", "budgets": {}, "allow_self": False},
}


@pytest.fixture(autouse=True)
def _isolated_library(tmp_path, monkeypatch):
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))


def test_a_second_type_gets_change_badges_from_its_own_definition_alone(bridge):
    library.save_type(NEW_TYPE)
    diagram_path = diagram_json_path(bridge.repo, "custom/release-flow")
    diagram_path.parent.mkdir(parents=True, exist_ok=True)
    diagram_path.write_text(
        json.dumps(
            {
                "nodes": [{"id": "build", "name": "Build", "path": "billing"}],
                "relations": [],
            }
        )
, encoding="utf-8")
    (bridge.repo / "billing" / "service.py").write_text(
        "changed for the release\n", encoding="utf-8"
    )

    with TestClient(bridge.app) as client:
        resolved = client.get("/repos/default/custom/release-flow").json()

    node = next(n for n in resolved["nodes"] if n["id"] == "build")
    assert node["overlays"]["changes"]["status"] == "modified"
    assert resolved["changes"]["blocks"]
