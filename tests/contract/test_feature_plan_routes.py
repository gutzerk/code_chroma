"""Contract coverage for the feature-plan/<slug> GET/-path route pair and its recipe run."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from codechroma.io import write_json
from tests.conftest import diagram_json_path


def _write_feature_plan(repo, slug: str, nodes: list, relations: list | None = None) -> None:
    path = diagram_json_path(repo, f"feature-plan/{slug}")
    write_json(path, {"nodes": nodes, "relations": relations or []})


def test_get_feature_plan_path_rejects_a_malformed_slug(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/feature-plan/UPPER_CASE-path")

    assert response.status_code == 400


def test_get_feature_plan_path_returns_the_write_location(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/feature-plan/token-auth-path")

    body = response.json()
    assert body["repo_root"] == str(bridge.repo)
    expected = diagram_json_path(bridge.repo, "feature-plan/token-auth")
    assert body["feature_plan_path"] == str(expected)


def test_get_feature_plan_rejects_a_malformed_slug(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/feature-plan/UPPER_CASE")

    assert response.status_code == 400


def test_get_feature_plan_has_no_diagram_before_any_write(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/feature-plan/token-auth")

    body = response.json()
    assert body["has_diagram"] is False
    assert body["nodes"] == []


def test_get_feature_plan_resolves_a_path_less_planned_block(bridge):
    _write_feature_plan(
        bridge.repo,
        "token-auth",
        [{"id": "n1", "name": "New middleware", "meta": {"plan_kind": "add"}}],
    )

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/feature-plan/token-auth")

    body = response.json()
    assert body["has_diagram"] is True
    assert body["nodes"][0]["meta"]["plan_kind"] == "add"


@pytest.mark.parametrize("slug", ["context", "review"])
def test_get_feature_plan_is_not_shadowed_by_the_generic_context_or_review_route(bridge, slug):
    # ROUTERS order regression -- diagrams.py's generic /{kind}/context|review must not win here.
    with TestClient(bridge.app) as client:
        response = client.get(f"/repos/default/feature-plan/{slug}")

    body = response.json()
    assert response.status_code == 200
    assert body["has_diagram"] is False


def test_delete_feature_plan_rejects_a_malformed_slug(bridge):
    with TestClient(bridge.app) as client:
        response = client.delete("/repos/default/feature-plan/UPPER_CASE")

    assert response.status_code == 400


def test_delete_feature_plan_removes_the_file(bridge):
    _write_feature_plan(bridge.repo, "token-auth", [{"id": "n1", "name": "New middleware"}])
    path = diagram_json_path(bridge.repo, "feature-plan/token-auth")
    assert path.exists()

    with TestClient(bridge.app) as client:
        response = client.delete("/repos/default/feature-plan/token-auth")
        after = client.get("/repos/default/feature-plan/token-auth").json()

    assert response.json() == {"deleted": True}
    assert not path.exists()
    assert after["has_diagram"] is False


def test_delete_feature_plan_on_a_missing_file_reports_not_deleted(bridge):
    with TestClient(bridge.app) as client:
        response = client.delete("/repos/default/feature-plan/token-auth")

    assert response.json() == {"deleted": False}


def test_run_recipe_adds_a_feature_plans_nodes_to_the_canvas(bridge):
    _write_feature_plan(
        bridge.repo,
        "token-auth",
        [{"id": "n1", "name": "New middleware", "meta": {"plan_kind": "add"}}],
    )

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/recipes/feature-plan/token-auth/run")
        canvas = client.get("/repos/default/canvas").json()

    assert response.json()["ok"] is True
    elements = [e for e in canvas["elements"].values() if e["layer"] == "feature-plan/token-auth"]
    assert elements[0]["meta"]["plan_kind"] == "add"
