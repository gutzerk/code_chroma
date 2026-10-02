"""TestClient coverage for the interactive-run status POST and its WS broadcast."""

from fastapi.testclient import TestClient


def test_post_generating_flips_the_job_and_returns_it(bridge):
    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/c1/status", json={"state": "generating"})
        status = client.get("/repos/default/c1/status")

    assert response.status_code == 200
    assert response.json() == {"state": "generating", "error": None}
    assert status.json() == {"state": "generating", "error": None}


def test_post_idle_resets_a_generating_job(bridge):
    with TestClient(bridge.app) as client:
        client.post("/repos/default/c1/status", json={"state": "generating"})
        response = client.post("/repos/default/c1/status", json={"state": "idle"})

    assert response.json() == {"state": "idle", "error": None}


def test_post_error_carries_the_detail_into_the_job_state(bridge):
    with TestClient(bridge.app) as client:
        response = client.post(
            "/repos/default/c1/status",
            json={"state": "error", "detail": "self-check did not converge after 3 attempts"},
        )

    assert response.json() == {
        "state": "error",
        "error": "self-check did not converge after 3 attempts",
    }


def test_post_error_with_no_detail_still_reports_error_not_idle(bridge):
    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/c1/status", json={"state": "error"})
        status = client.get("/repos/default/c1/status")

    assert response.json() == {"state": "error", "error": "unspecified error"}
    assert status.json() == {"state": "error", "error": "unspecified error"}


def test_post_an_unrecognized_state_is_a_400(bridge):
    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/c1/status", json={"state": "paused"})

    assert response.status_code == 400


def test_post_status_broadcasts_over_the_events_socket(bridge):
    with TestClient(bridge.app) as client:
        with client.websocket_connect("/repos/default/events") as websocket:
            client.post("/repos/default/c1/status", json={"state": "generating"})
            message = websocket.receive_json()

    assert message == {"type": "c1-status", "state": "generating", "error": None}


def test_cancel_resets_a_job_the_status_route_set_even_though_nothing_ever_ran(bridge):
    """The B1 risk: an interrupted interactive run recovers through the existing Stop control."""
    with TestClient(bridge.app) as client:
        client.post("/repos/default/c1/status", json={"state": "generating"})
        cancelled = client.post("/repos/default/c1/cancel")
        status = client.get("/repos/default/c1/status")

    assert cancelled.json() == {"state": "idle", "error": None}
    assert status.json() == {"state": "idle", "error": None}
