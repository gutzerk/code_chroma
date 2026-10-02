"""TestClient coverage for the /structure route the C1 skill reads verified paths from."""

import pytest


@pytest.fixture(scope="module")
def client(shared_client):
    """Read-only throughout, so the whole module shares one analyzed repo and one app."""
    return shared_client


def _flatten(nodes):
    for entry in nodes:
        yield entry
        yield from _flatten(entry.get("children", []))


def test_returns_the_top_level_tree_for_the_analyzed_repo(client):
    structure = client.get("/repos/default/structure").json()

    assert {entry["node_id"] for entry in structure["nodes"]} == {
        "dir::billing",
        "dir::shared",
        "dir::users",
        "dir::web",
    }


def test_root_and_depth_query_params_are_honored(client):
    params = {"root": "dir::billing", "depth": 1}

    structure = client.get("/repos/default/structure", params=params).json()

    assert [entry["node_id"] for entry in structure["nodes"]] == [
        "dir::billing/models",
        "component::billing/reporter.go",
        "component::billing/service.py",
    ]


def test_response_never_includes_file_source(client):
    params = {"depth": 5}

    structure = client.get("/repos/default/structure", params=params).json()

    assert all("source" not in entry for entry in _flatten(structure["nodes"]))


def test_unknown_root_returns_404(client):
    response = client.get("/repos/default/structure", params={"root": "dir::nope"})

    assert response.status_code == 404
