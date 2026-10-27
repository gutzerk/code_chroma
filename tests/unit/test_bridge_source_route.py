"""TestClient coverage for the source-fragment route on bridge/routes/graph.py — the text an
epics block links to, sliced to a 1-based inclusive line range, confined to the workspace root."""

import pytest
from fastapi.testclient import TestClient


def test_source_fragment_returns_whole_file_without_range(shared_client):
    client: TestClient = shared_client
    response = client.get("/repos/default/source", params={"path": "web/widget.ts"})
    assert response.status_code == 200
    body = response.json()
    assert body["path"] == "web/widget.ts"
    assert "renderUserSlug" in body["content"]
    assert body["language"] == "typescript"


def test_source_fragment_slices_inclusive_line_range(shared_client):
    client: TestClient = shared_client
    response = client.get(
        "/repos/default/source",
        params={"path": "web/widget.ts", "start": 2, "end": 4},
    )
    assert response.status_code == 200
    lines = response.json()["content"].split("\n")
    # widget.ts line 2 opens the function, line 3 computes the slug; the slice is lines 2..4.
    assert len(lines) == 3
    assert lines[0].lstrip().startswith("export function renderUserSlug")
    assert "slug" in lines[1]


@pytest.mark.parametrize("path", ["../outside.txt", "nope/missing.ts"])
def test_source_fragment_404_outside_root_or_missing(shared_client, path):
    response = shared_client.get("/repos/default/source", params={"path": path})

    assert response.status_code == 404
