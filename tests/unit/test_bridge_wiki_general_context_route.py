"""TestClient coverage for GET /repos/{id}/wiki-general-context: no tree, tree present."""

from fastapi.testclient import TestClient

from tests.integration.test_wiki_general_end_to_end import _write_wiki_general_tree


def test_no_wiki_general_directory_returns_has_wiki_general_false(bridge):
    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/wiki-general-context").json()

    assert payload == {
        "has_wiki_general": False,
        "generated_at": None,
        "root": None,
        "containers": [],
        "truncated": False,
    }


def test_existing_tree_populates_root_and_containers(bridge):
    _write_wiki_general_tree(bridge.repo)

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/wiki-general-context").json()

    assert payload == {
        "has_wiki_general": True,
        "generated_at": "2026-09-14T00:00:00Z",
        "root": "# Sample — Architecture Map\n\n## Containers\n\n"
        "- [Backend](c2/backend.md) — the backend.\n",
        "containers": [
            {
                "id": "backend",
                "name": "Backend",
                "content": "# Backend\n\n## Components\n\n"
                "- [Billing](../c3/billing.md) — billing logic.\n",
            }
        ],
        "truncated": False,
    }
