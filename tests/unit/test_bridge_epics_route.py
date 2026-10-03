"""GET /repos/{id}/epics and /epics/items/{id}: the laziness and error-shape guarantees."""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

FIXTURE_ROOT = Path(__file__).parent.parent / "fixtures" / "requirements_repo"


def _with_requirements_fixture(repo: Path) -> None:
    shutil.copytree(FIXTURE_ROOT / "plan", repo / "plan")
    shutil.copytree(FIXTURE_ROOT / "specs", repo / "specs")


def test_index_payload_has_no_body_fields(make_bridge, make_repo):
    # The portfolio index now lives at /epics/context (epics is a diagram kind; GET /epics serves
    # the resolved diagram). Its shape and lazy no-body guarantee are unchanged.
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)

    response = client.get("/repos/main/epics/context")

    body = response.json()
    assert response.status_code == 200
    for item in body["generation_data"]["items"]:
        assert "requirements" not in item
        assert "children" not in item
        assert "stages" not in item


def test_missing_source_directory_returns_200_with_empty_items(make_bridge, make_repo):
    repo = make_repo()
    client = TestClient(make_bridge(repo).app)

    response = client.get("/repos/main/epics/context")

    assert response.status_code == 200
    assert response.json()["generation_data"]["items"] == []


def test_unknown_item_id_returns_404(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)

    response = client.get("/repos/main/epics/items/NOPE")

    assert response.status_code == 404


def test_malformed_source_item_returns_200_degraded(make_bridge, make_repo):
    def prepare(repo: Path) -> None:
        _with_requirements_fixture(repo)
        (repo / "plan" / "epics" / "broken.md").write_bytes(
            b"---\nid: EP-BROKEN\ntitle: Broken\nstatus: Draft\nkind: epic\n---\n"
            b"bad byte: \xff\xfe\n"
        )

    repo = make_repo(prepare=prepare)
    client = TestClient(make_bridge(repo).app)

    response = client.get("/repos/main/epics/items/EP-BROKEN")

    assert response.status_code == 200
    assert response.json()["title"] == "Broken"
    assert response.json()["requirements"] == []


def test_item_route_returns_full_work_item_shape(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)

    response = client.get("/repos/main/epics/items/EP-A-01")

    body = response.json()
    assert response.status_code == 200
    assert len(body["requirements"]) == 3
    assert len(body["children"]) == 2


def test_expand_query_param_populates_exactly_one_stage(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)

    node_id = "epic-stage::001-first-story-feature::tasks"
    response = client.get("/repos/main/epics/items/EP-A-01-01", params={"expand": node_id})

    stages_by_kind = {stage["kind"]: stage for stage in response.json()["stages"]}
    assert stages_by_kind["tasks"]["sections"] != []
    assert stages_by_kind["spec"]["sections"] == []


def test_item_route_matches_id_case_insensitively(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)

    response = client.get("/repos/main/epics/items/ep-a-01")

    assert response.status_code == 200
    assert response.json()["id"] == "EP-A-01"


def test_epic_diagram_path_points_at_the_per_epic_artifact(make_bridge, make_repo):
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)

    response = client.get("/repos/main/epics/EP-A-01/diagram-path")

    assert response.status_code == 200
    body = response.json()
    assert body["repo_root"] == str(repo)
    assert body["diagram_path"].endswith(
        ".codechroma/diagrams/epics/EP-A-01/EP-A-01.json"
    )


def test_epic_diagram_path_rejects_an_id_that_would_escape_the_epics_dir(make_bridge, make_repo):
    """`item_id` names a path segment on disk -- a `..`-laced id must 404 rather than resolve
    outside `.codechroma/diagrams/epics/`, mirroring the registry's own filesystem-safety check."""
    repo = make_repo(prepare=_with_requirements_fixture)
    client = TestClient(make_bridge(repo).app)

    response = client.get("/repos/main/epics/EP!4/diagram-path")

    assert response.status_code == 404
