"""TestClient coverage for POST /repos/{id}/recipes/{recipe}/run against the real app factory."""

from __future__ import annotations

from fastapi.testclient import TestClient

from codechroma.io import write_json
from tests.conftest import diagram_json_path


def _write_impact(repo, nodes: list, relations: list) -> None:
    write_json(
        diagram_json_path(repo, "impact"),
        {"nodes": nodes, "relations": relations},
    )


def _impact_elements(canvas: dict) -> dict:
    """Just the impact layer of the canvas document."""
    return {k: v for k, v in canvas["elements"].items() if v["layer"] == "impact"}


def test_run_recipe_404s_for_an_unknown_recipe(bridge):
    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/recipes/not-a-recipe/run")

    assert response.status_code == 404


def test_run_recipe_adds_impact_nodes_to_the_canvas(bridge):
    _write_impact(bridge.repo, [{"id": "n1", "name": "Auth", "node_id": "component::src"}], [])

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/recipes/impact/run")
        canvas = client.get("/repos/default/canvas").json()

    assert response.json()["ok"] is True
    element = next(iter(_impact_elements(canvas).values()))
    assert element["label"] == "Auth"
    assert element["created_by"] == "ai"


def test_run_recipe_a_second_time_keeps_a_user_moved_position(bridge):
    _write_impact(bridge.repo, [{"id": "n1", "name": "Auth", "node_id": "component::src"}], [])

    with TestClient(bridge.app) as client:
        client.post("/repos/default/recipes/impact/run")
        element_id = next(iter(_impact_elements(client.get("/repos/default/canvas").json())))
        client.patch("/repos/default/canvas", json={"ops": [
            {"op": "update_element", "id": element_id, "position": {"x": 99, "y": 5}},
        ]})
        client.post("/repos/default/recipes/impact/run")
        after = client.get("/repos/default/canvas").json()

    assert after["elements"][element_id]["position"]["x"] == 99


def test_run_recipe_deletes_an_ai_node_no_longer_in_the_resolved_slice(bridge):
    _write_impact(bridge.repo, [{"id": "n1", "name": "Auth", "node_id": "component::src"}], [])

    with TestClient(bridge.app) as client:
        client.post("/repos/default/recipes/impact/run")
        _write_impact(bridge.repo, [], [])
        client.post("/repos/default/recipes/impact/run")
        after = client.get("/repos/default/canvas").json()

    assert _impact_elements(after) == {}


def test_run_recipe_can_reconcile_a_refresh_larger_than_the_mass_delete_guard(bridge):
    # A real diagram routinely exceeds MASS_DELETE_GUARD (20) on refresh: rebuilding a large layer
    # deletes many stale AI elements + their cascaded edges. The reconcile only ever touches its own
    # AI-owned layer, so it confirms the delete internally -- swapping out more than 20 items on
    # refresh is deliberate replacement, not a suspicious mass delete.
    before = [{"id": f"n{i}", "name": f"Node {i}", "node_id": "component::src"} for i in range(25)]
    _write_impact(bridge.repo, before, [])

    with TestClient(bridge.app) as client:
        first = client.post("/repos/default/recipes/impact/run")
        assert first.json()["ok"] is True

        # Same run again deletes nothing (keys match); shrink it instead to force >20 deletes.
        _write_impact(bridge.repo, before[:2], [])
        second = client.post("/repos/default/recipes/impact/run")
        assert second.json()["ok"] is True
        assert second.status_code == 200
        leftover = _impact_elements(client.get("/repos/default/canvas").json())
        assert len(leftover) == 2


def test_run_recipe_reports_what_it_could_not_draw_without_failing_the_run(bridge):
    # 🔴 Soft mode: the diagram still renders; the drop is reported beside it, never as an error.
    _write_impact(
        bridge.repo,
        [{"id": "n1", "name": "Auth", "node_id": "component::src"}, {"name": "no id"}],
        [{"from": "n1", "to": "ghost"}],
    )

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/recipes/impact/run")

    body = response.json()
    assert body["ok"] is True
    assert body["diagnostics"]["dropped_count"] == 2
    assert {entry["reason"] for entry in body["diagnostics"]["dropped"]} == {
        "invalid_shape",
        "dangling_endpoint",
    }


def test_run_recipe_reports_nothing_dropped_for_a_clean_diagram(bridge):
    _write_impact(
        bridge.repo,
        [
            {"id": "n1", "name": "Auth", "node_id": "component::src"},
            {"id": "n2", "name": "Db", "node_id": "component::src"},
        ],
        [{"from": "n1", "to": "n2"}],
    )

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/recipes/impact/run")

    assert response.json()["diagnostics"]["dropped_count"] == 0
