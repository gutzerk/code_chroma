"""SC-003 (037): a newly registered overlay reaches a built-in type via its own data only."""

from __future__ import annotations

import dataclasses
import json

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge.overlays import register_overlay_provider
from codechroma.diagrams import library
from codechroma.diagrams.registry import BUILTIN_TYPES


class _MarkerOverlay:
    """A trivial provider that tags every node -- stands in for any future new overlay."""

    def resolve(self, ws, resolved, by_id):
        for node in resolved.get("nodes") or []:
            if isinstance(node, dict):
                node.setdefault("overlays", {})["sc003-marker"] = {"marked": True}
        return resolved


@pytest.fixture(autouse=True)
def _isolated_library(tmp_path, monkeypatch):
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))


@pytest.fixture(autouse=True)
def _registered_marker_overlay():
    register_overlay_provider("sc003-marker", _MarkerOverlay())
    yield
    del __import__("codechroma.bridge.overlays", fromlist=["OVERLAY_PROVIDERS"]).OVERLAY_PROVIDERS[
        "sc003-marker"
    ]


def test_an_existing_builtin_type_picks_up_a_new_overlay_via_its_own_data_only(bridge, monkeypatch):
    patterns = BUILTIN_TYPES["patterns"]
    monkeypatch.setitem(
        BUILTIN_TYPES, "patterns", dataclasses.replace(patterns, overlays=["sc003-marker"])
    )
    diagram_path = bridge.main.diagram_artifact_path("patterns")
    diagram_path.parent.mkdir(parents=True, exist_ok=True)
    node = {"id": "billing", "name": "Billing", "kind": "infra"}
    diagram_path.write_text(json.dumps({"nodes": [node], "relations": []}), encoding="utf-8")

    with TestClient(bridge.app) as client:
        resolved = client.get("/repos/default/patterns").json()

    node = next(n for n in resolved["nodes"] if n["id"] == "billing")
    assert node["overlays"]["sc003-marker"]["marked"] is True
