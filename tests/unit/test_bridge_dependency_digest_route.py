"""TestClient coverage for GET /repos/{id}/dependency-digest."""

import pytest


@pytest.fixture(scope="module")
def client(shared_client):
    """Read-only throughout, so the whole module shares one analyzed repo and one app."""
    return shared_client


def test_whole_digest_lists_every_analyzed_file(client):
    digest = client.get("/repos/default/dependency-digest").json()

    assert {"billing/service.py", "shared/text_utils.py"} <= {
        entry["path"] for entry in digest["files"]
    }


def test_path_filter_returns_just_that_files_entry(client):
    entry = client.get(
        "/repos/default/dependency-digest", params={"path": "billing/service.py"}
    ).json()

    assert entry["path"] == "billing/service.py"
    assert entry["node_id"] == "component::billing/service.py"


def test_unknown_path_returns_404(client):
    response = client.get(
        "/repos/default/dependency-digest", params={"path": "nope/nope.py"}
    )

    assert response.status_code == 404
