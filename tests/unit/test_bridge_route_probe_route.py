"""TestClient coverage for GET /repos/{id}/route, plus a pure hop-cap test on find_route."""

import pytest

from codechroma.dependencies.digest import DependencyIndex, build_dependency_index, find_route
from codechroma.graph.models import Graph, HierarchyLevel, HierarchyNode


@pytest.fixture(scope="module")
def client(shared_client):
    """Read-only throughout, so the whole module shares one analyzed repo and one app."""
    return shared_client


def test_direct_call_returns_a_two_node_path(client):
    response = client.get(
        "/repos/default/route",
        params={
            "from": "billing/service.py::function::BillingService.create_invoice",
            "to": "shared/text_utils.py::function::slugify",
        },
    )

    assert response.json() == {
        "path": [
            "billing/service.py::function::BillingService.create_invoice",
            "shared/text_utils.py::function::slugify",
        ]
    }


def test_unconnected_nodes_return_null_path(client):
    response = client.get(
        "/repos/default/route",
        params={
            "from": "billing/models/invoice.py::function::format_invoice_id",
            "to": "shared/text_utils.py::function::slugify",
        },
    )

    assert response.json() == {"path": None}


def test_unknown_node_id_returns_null_path(client):
    response = client.get(
        "/repos/default/route",
        params={"from": "nope::nope", "to": "shared/text_utils.py::function::slugify"},
    )

    assert response.status_code == 200
    assert response.json() == {"path": None}


def _chain_index(length: int) -> DependencyIndex:
    """A straight-line dependency chain n0 -> n1 -> ... -> n{length-1}."""
    nodes = {}
    for i in range(length):
        depends_on = [f"n{i + 1}"] if i + 1 < length else []
        nodes[f"n{i}"] = HierarchyNode(
            id=f"n{i}", name=f"n{i}", level=HierarchyLevel.FUNCTION, depends_on_ids=depends_on
        )
    return build_dependency_index(Graph(nodes=nodes))


def test_path_within_hop_cap_is_found():
    index = _chain_index(13)

    path = find_route(index, "n0", "n12")

    assert path == [f"n{i}" for i in range(13)]


def test_path_beyond_hop_cap_returns_none():
    index = _chain_index(14)

    path = find_route(index, "n0", "n13")

    assert path is None
