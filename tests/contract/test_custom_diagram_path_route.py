"""Contract coverage for GET /repos/{id}/custom/{type_id}-path and GET /diagram-styles."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.diagrams import library
from codechroma.diagrams.styles import STYLES
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
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))


def test_custom_path_returns_the_artifact_location_not_the_bare_type_payload(bridge):
    with TestClient(bridge.app) as client:
        client.put("/diagram-types/data-flow", json=VALID_DEFINITION)
        response = client.get("/repos/default/custom/data-flow-path")

    body = response.json()
    expected = diagram_json_path(Path(body["repo_root"]), "custom/data-flow")
    assert response.status_code == 200
    assert Path(body["custom_path"]) == expected
    assert "nodes" not in body


def test_custom_path_rejects_a_malformed_id(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/custom/UPPER_CASE-path")

    assert response.status_code == 400


def test_custom_path_404s_for_an_unsaved_type(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/custom/never-saved-path")

    assert response.status_code == 404


# Kept separate: /diagram-styles may be removed; delete only this test if so.
def test_diagram_styles_lists_every_registered_style(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/diagram-styles")

    styles = response.json()["styles"]
    assert response.status_code == 200
    assert {s["id"] for s in styles} == set(STYLES)
    assert all({"id", "label", "description", "overrides"} <= set(s) for s in styles)
