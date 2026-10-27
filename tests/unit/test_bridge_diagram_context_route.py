"""TestClient coverage for the unified GET /repos/{id}/{kind}/context envelope (037)."""


import pytest
from fastapi.testclient import TestClient

from codechroma.diagrams import library
from tests.conftest import copy_sample_repo


@pytest.fixture
def server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    copy_sample_repo(repo)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))

    bridge = make_bridge(repo)
    return bridge, repo


@pytest.mark.parametrize(
    ("kind", "has_staleness", "generation_key"),
    [
        ("c1", False, None),
        ("patterns", True, "classes"),
        ("impact", False, "nodes"),
        ("sequence", False, "traces"),
    ],
)
def test_the_context_envelope_per_kind(server_module, kind, has_staleness, generation_key):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        payload = client.get(f"/repos/default/{kind}/context").json()

    assert payload["coverage"] is None
    assert (payload["staleness"] is not None) == has_staleness
    if generation_key is None:
        assert payload["generation_data"] is None
    else:
        assert generation_key in payload["generation_data"]


def test_unknown_kind_context_is_a_404(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/not-a-kind/context")

    assert response.status_code == 404


def test_custom_type_context_is_all_null_by_default(server_module):
    bridge, _repo = server_module
    library.save_type(
        {
            "id": "data-flow",
            "title": "Data flow",
            "style": "boxes-arrows",
            "layout": {"direction": "LR"},
            "grouping": {"enabled": False},
            "relation_kinds": [],
            "instructions": "One box per component.",
        }
    )

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/custom/data-flow/context").json()

    assert payload == {"coverage": None, "staleness": None, "generation_data": None}
