"""Contract: `GET /repos/{id}/{kind}/context` returns the same field names for every diagram type,
including custom (037, data-model.md's `ContextEnvelope`, FR-005/US4).
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from codechroma.diagrams import library
from tests.conftest import diagram_json_path

_ENVELOPE_FIELDS = {"coverage", "staleness", "generation_data"}

NEW_TYPE = {
    "id": "release-flow",
    "title": "Release flow",
    "style": "boxes-arrows",
    "layout": {"direction": "TB"},
    "grouping": {"enabled": False},
    "relation_kinds": [{"id": "triggers", "label": "triggers"}],
    "instructions": "One box per release step.",
}


def _isolated_library(tmp_path, monkeypatch):
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))


def test_every_builtin_context_envelope_has_the_same_field_names(bridge):
    with TestClient(bridge.app) as client:
        for kind in ("c1", "patterns", "impact"):
            body = client.get(f"/repos/default/{kind}/context").json()
            assert set(body) == _ENVELOPE_FIELDS


def test_a_custom_type_gets_the_same_envelope_shape_with_null_fields(bridge, tmp_path, monkeypatch):
    _isolated_library(tmp_path, monkeypatch)
    library.save_type(NEW_TYPE)
    diagram_path = diagram_json_path(bridge.repo, "custom/release-flow")
    diagram_path.parent.mkdir(parents=True, exist_ok=True)
    diagram_path.write_text(json.dumps({"nodes": [], "relations": []}), encoding="utf-8")

    with TestClient(bridge.app) as client:
        body = client.get("/repos/default/custom/release-flow/context").json()

    assert set(body) == _ENVELOPE_FIELDS
    assert body["generation_data"] is None
