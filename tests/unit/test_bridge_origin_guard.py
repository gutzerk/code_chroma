"""Cross-origin pages must not be able to drive the bridge's write routes."""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from codechroma.bridge.origin_guard import is_cross_origin


@pytest.fixture
def client(make_bridge, make_repo):
    return TestClient(make_bridge(make_repo()).app)


def test_a_cross_origin_post_is_refused_before_it_reaches_the_handler(client):
    response = client.post(
        "/branches", content='{"branch": "x"}', headers={"origin": "https://evil.example"}
    )

    assert response.status_code == 403


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_every_unsafe_method_is_guarded(client, method):
    response = getattr(client, method)("/branches/br_x", headers={"origin": "https://evil.example"})

    assert response.status_code == 403


def test_a_request_without_an_origin_header_passes(client):
    response = client.post("/branches", json={})

    assert response.status_code == 400


def test_the_servers_own_loopback_origin_passes(client):
    response = client.post(
        "/branches", json={}, headers={"origin": "http://127.0.0.1:8000", "host": "127.0.0.1:8000"}
    )

    assert response.status_code == 400


def test_a_rebound_host_that_matches_its_own_origin_is_refused(client):
    response = client.post(
        "/branches", json={}, headers={"origin": "http://evil.example", "host": "evil.example"}
    )

    assert response.status_code == 403


def test_a_cross_origin_websocket_handshake_is_closed(client):
    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect("/ws/terminal", headers={"origin": "https://evil.example"}):
            pass

    assert closed.value.code == 1008


def test_the_dev_server_origin_passes(client):
    response = client.post("/branches", json={}, headers={"origin": "http://localhost:5173"})

    assert response.status_code == 400


def test_a_cross_origin_read_is_not_blocked(client):
    response = client.get("/health", headers={"origin": "https://evil.example"})

    assert response.status_code == 200


@pytest.mark.parametrize(
    ("origin", "host", "expected"),
    [
        ("http://127.0.0.1:5000", "127.0.0.1:5000", False),
        ("http://127.0.0.1:5000", "127.0.0.1:5001", True),
        ("http://localhost:5173", "127.0.0.1:5000", False),
        ("https://evil.example", "127.0.0.1:5000", True),
        ("http://evil.example:5000", "evil.example:5000", True),
    ],
)
def test_is_cross_origin(origin, host, expected):
    assert is_cross_origin(origin, host, {"http://localhost:5173"}) is expected
