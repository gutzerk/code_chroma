"""Contract coverage for the custom-diagram library/per-repo GET route table.

The in-app interview that used to author a new library entry (its own draft/interview routes) is
retired -- diagram-management unification; see test_skill_sync.py for its retire/prune coverage.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge import skill_agent
from codechroma.diagrams import library
from tests.conftest import diagram_json_path

VALID_DEFINITION = {
    "id": "data-flow",
    "title": "Data flow",
    "style": "boxes-arrows",
    "layout": {"direction": "LR"},
    "grouping": {"enabled": False, "label": ""},
    "relation_kinds": [{"id": "writes", "label": "writes to"}],
    "instructions": "One box per component that owns or moves user data.",
}


@pytest.fixture(autouse=True)
def _isolated_library(tmp_path, monkeypatch):
    """Every test gets its own throwaway library dir -- never the real ~/.codechroma library."""
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))


@pytest.fixture(autouse=True)
def _no_claude_cli(monkeypatch):
    """None of these routes should ever spawn a real `claude` process in a test run."""
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: None)


def test_get_diagram_type_rejects_a_malformed_id(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/diagram-types/UPPER_CASE")

    assert response.status_code == 400


def test_get_diagram_type_404s_for_an_unknown_type(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/diagram-types/does-not-exist")

    assert response.status_code == 404


def test_put_then_get_round_trips_a_definition(bridge):
    with TestClient(bridge.app) as client:
        put = client.put("/diagram-types/data-flow", json=VALID_DEFINITION)
        get = client.get("/diagram-types/data-flow")

    assert put.status_code == 200
    assert get.json()["title"] == "Data flow"


def test_put_rejects_an_invalid_definition(bridge):
    with TestClient(bridge.app) as client:
        response = client.put("/diagram-types/data-flow", json={"title": "No instructions"})

    assert response.status_code == 400


def test_get_custom_diagram_has_no_diagram_before_any_generation(bridge):
    with TestClient(bridge.app) as client:
        client.put("/diagram-types/data-flow", json=VALID_DEFINITION)
        response = client.get("/repos/default/custom/data-flow")

    body = response.json()
    assert body["has_diagram"] is False
    assert body["nodes"] == []


@pytest.mark.parametrize("type_id", ["context", "review"])
def test_get_custom_diagram_is_not_shadowed_by_the_generic_context_or_review_route(bridge, type_id):
    # ROUTERS order regression -- diagrams.py's generic /{kind}/context|review must not win here.
    with TestClient(bridge.app) as client:
        client.put(f"/diagram-types/{type_id}", json={**VALID_DEFINITION, "id": type_id})
        response = client.get(f"/repos/default/custom/{type_id}")

    body = response.json()
    assert response.status_code == 200
    assert body["has_diagram"] is False


def test_custom_diagram_reports_coverage_and_staleness_it_never_had_before_036(bridge):
    # Proves FR-005/FR-006 (staleness/coverage) generalize to a type that had neither before.
    with TestClient(bridge.app) as client:
        client.put("/diagram-types/data-flow", json=VALID_DEFINITION)
        library.write_json(
            diagram_json_path(bridge.repo, "custom/data-flow"),
            {
                "nodes": [{"id": "n1", "name": "Box", "path": "shared"}],
                "relations": [],
                "fingerprint": "stale-hash",
            },
        )
        response = client.get("/repos/default/custom/data-flow")

    body = response.json()
    assert body["reviewed_fingerprint"] == "stale-hash"
    assert body["stale"] is True
    assert "billing" in [entry["path"] for entry in body["unmapped"]]


def test_delete_custom_diagram_removes_the_instance_but_not_the_type(bridge):
    with TestClient(bridge.app) as client:
        client.put("/diagram-types/data-flow", json=VALID_DEFINITION)
        library.write_json(
            diagram_json_path(bridge.repo, "custom/data-flow"),
            {"nodes": [{"id": "n1", "name": "Box", "path": "shared"}], "relations": []},
        )
        response = client.delete("/repos/default/custom/data-flow")
        instance = client.get("/repos/default/custom/data-flow").json()
        type_get = client.get("/diagram-types/data-flow")

    assert response.json() == {"deleted": True}
    assert instance["has_diagram"] is False
    assert type_get.status_code == 200


def test_delete_custom_diagram_rejects_a_malformed_id(bridge):
    with TestClient(bridge.app) as client:
        response = client.delete("/repos/default/custom/UPPER_CASE")

    assert response.status_code == 400


def test_interview_routes_are_gone(bridge):
    """POST only matches the bare {type_id} PUT/DELETE trio, which has no POST -- 405 not 404."""
    with TestClient(bridge.app) as client:
        response = client.post("/diagram-types/interview", json={"message": "hello"})

    assert response.status_code == 405
