"""The /connections route tags each edge with the arrow's semantic sense.

Part A of the drawio-skill borrow (docs/planning/011): the skill authoring a dependency-graph
relation needs to tell "X depends on Y" (`depends_on`) from "Y is depended on by X"
(`depended_on_by`) -- the two senses of the same arrow. The dependency data already lived in the
engine; this test pins the route that labels it.
"""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(make_repo, make_bridge):
    repo = make_repo()
    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo, bridge


def _children(test_client, node_id: str) -> list[dict]:
    return test_client.get(f"/repos/main/nodes/{node_id}/children").json()


def _node_id(children: list[dict], name: str) -> str | None:
    for child in children:
        if child["name"] == name:
            return child["node_id"]
    return None


def test_connections_tag_the_arrow_sense_for_a_real_dependency(client):
    test_client, _repo, _bridge = client
    billing_dir = _node_id(_children(test_client, "root"), "billing")
    assert billing_dir is not None, "sample repo should expose a billing/ directory"

    service_node = _node_id(_children(test_client, billing_dir), "service.py")
    assert service_node is not None, "billing/ should expose service.py"

    # Dependency edges live on the class/function symbols, not the file-level component node.
    class_node = _node_id(_children(test_client, service_node), "BillingService")
    assert class_node is not None, "billing/service.py should expose BillingService"

    conns = test_client.get(
        f"/repos/main/nodes/{class_node}/connections"
    ).json()

    assert conns, "BillingService calls shared/text_utils.slugify, so it must have edges"
    # The subject (BillingService) is a caller -- its outgoing edge reads depends_on.
    assert any(c["from_id"] == class_node and c["from_to"] == "depends_on" for c in conns)
    # Every connection is labelled with exactly one of the two senses.
    for connection in conns:
        assert connection["from_to"] in ("depends_on", "depended_on_by")


def test_connections_carry_edge_origin_for_a_real_dependency(client):
    test_client, _repo, _bridge = client
    billing_dir = _node_id(_children(test_client, "root"), "billing")
    service_node = _node_id(_children(test_client, billing_dir), "service.py")
    class_node = _node_id(_children(test_client, service_node), "BillingService")

    conns = test_client.get(f"/repos/main/nodes/{class_node}/connections").json()

    outgoing = [c for c in conns if c["from_to"] == "depends_on"]
    assert outgoing, "BillingService's outgoing edges carry an origin"
    # The origin is the caller's own location -- billing/service.py at the class's start line.
    for connection in outgoing:
        assert connection["origin"] is not None
        assert connection["origin"].startswith("billing/service.py:")
