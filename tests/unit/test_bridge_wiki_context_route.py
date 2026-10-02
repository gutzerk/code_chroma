"""TestClient coverage for GET /repos/{id}/wiki-context: no wiki, wiki present, sync failure."""

import shutil
from unittest.mock import patch

from fastapi.testclient import TestClient


def test_no_wiki_directory_returns_has_wiki_false(bridge):
    # Bring-up already auto-generated a wiki (041); remove it to test the route's own no-wiki path.
    shutil.rmtree(bridge.repo / ".codechroma" / "wiki")
    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/wiki-context").json()

    assert payload == {"has_wiki": False, "root": None, "pages": [], "gaps": [], "truncated": False}


def test_no_wiki_directory_never_calls_sync_wiki(bridge):
    shutil.rmtree(bridge.repo / ".codechroma" / "wiki")
    with TestClient(bridge.app) as client:
        ws = bridge.registry.get("default")
        with patch.object(ws.engine, "sync_wiki") as mock_sync:
            client.get("/repos/default/wiki-context")

    mock_sync.assert_not_called()


def test_existing_wiki_populates_root_and_pages(bridge):
    with TestClient(bridge.app) as client:
        ws = bridge.registry.get("default")
        ws.engine.sync_wiki(bridge.repo / ".codechroma" / "wiki")
        payload = client.get("/repos/default/wiki-context?paths=billing").json()

    assert payload["has_wiki"] is True
    assert payload["root"]
    assert any(p["path"] == "billing" for p in payload["pages"])


def test_existing_wiki_calls_sync_wiki_before_serving(bridge):
    with TestClient(bridge.app) as client:
        ws = bridge.registry.get("default")
        ws.engine.sync_wiki(bridge.repo / ".codechroma" / "wiki")
        with patch.object(ws.engine, "sync_wiki", wraps=ws.engine.sync_wiki) as mock_sync:
            client.get("/repos/default/wiki-context")

    mock_sync.assert_called_once()


def test_sync_failure_returns_500_with_detail(bridge):
    with TestClient(bridge.app) as client:
        ws = bridge.registry.get("default")
        ws.engine.sync_wiki(bridge.repo / ".codechroma" / "wiki")
        with patch.object(ws.engine, "sync_wiki", side_effect=RuntimeError("boom")):
            response = client.get("/repos/default/wiki-context")

    assert response.status_code == 500
    assert response.json()["detail"] == "wiki sync failed: boom"
