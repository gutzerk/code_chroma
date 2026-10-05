"""US1 (037): a brand-new diagram type, defined only as JSON, renders AND self-checks correctly
through the shared path -- SC-001's full acceptance scenario, not just 036's render-only proof
(`tests/contract/test_new_diagram_type_shared_path.py`). No new source file backs this type; its
`checks` field alone drives `bridge/inspect.py`'s dispatch.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge.inspect import inspect
from codechroma.diagrams import library
from codechroma.diagrams.registry import get_definition
from tests.conftest import diagram_json_path

NEW_TYPE = {
    "id": "release-flow",
    "title": "Release flow",
    "style": "boxes-arrows",
    "layout": {"direction": "TB"},
    "grouping": {"enabled": False},
    "relation_kinds": [{"id": "triggers", "label": "triggers"}],
    "instructions": "One box per release step.",
    "checks": {
        "shape": "flat",
        "budgets": {
            "max_nodes": 2,
            "max_relations": 10,
            "max_name_chars": 40,
            "max_edge_label_chars": 40,
        },
        "allow_self": False,
        "check_islands": {"hint": "wire it into the release chain"},
    },
}


@pytest.fixture(autouse=True)
def _isolated_library(tmp_path, monkeypatch):
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))


def test_a_new_type_renders_and_self_checks_with_zero_new_source_files(bridge):
    library.save_type(NEW_TYPE)
    diagram_path = diagram_json_path(bridge.repo, "custom/release-flow")
    diagram_path.parent.mkdir(parents=True, exist_ok=True)
    diagram_path.write_text(
        json.dumps(
            {
                "nodes": [
                    {"id": "build", "name": "Build"},
                    {"id": "deploy", "name": "Deploy"},
                    {"id": "notify", "name": "Notify"},
                ],
                "relations": [{"from": "build", "to": "deploy", "label": "triggers"}],
            }
        )
, encoding="utf-8")

    with TestClient(bridge.app) as client:
        resolved = client.get("/repos/default/custom/release-flow").json()

    # Renders through the shared path (036's proof, still true).
    assert {node["id"] for node in resolved["nodes"]} == {"build", "deploy", "notify"}

    # Self-checks using the type's own definition -- no check written for "release-flow".
    definition = get_definition("custom/release-flow")
    report = inspect(resolved, definition.checks)

    assert any(line.startswith("CROWDED") for line in report.shape)  # budget: max_nodes=2, got 3
    assert any(line.startswith("ORPHAN") for line in report.shape)  # "notify" touches nothing
