"""TestClient coverage for GET /health and the built-SPA mount the desktop app loads."""

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


@pytest.fixture
def server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)

    bridge = make_bridge(repo)
    return bridge, repo


@pytest.fixture
def spa_server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    spa = tmp_path / "spa"
    spa.mkdir()
    (spa / "index.html").write_text("<!doctype html><title>CodeChroma</title>", encoding="utf-8")
    (spa / "assets").mkdir()
    (spa / "assets" / "index.js").write_text("console.log('canvas')", encoding="utf-8")
    monkeypatch.setattr(
        "codechroma.bridge.resources.resource_path",
        lambda kind, *parts: spa.joinpath(*parts) if kind == "web" else Path("/nonexistent"),
    )

    bridge = make_bridge(repo)
    return bridge


@pytest.fixture
def no_spa_server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    monkeypatch.setattr(
        "codechroma.bridge.resources.resource_path",
        lambda _kind, *parts: tmp_path.joinpath("never-built", *parts),
    )

    bridge = make_bridge(repo)
    return bridge


def test_health_reports_the_repo_the_bridge_analyzed(server_module):
    bridge, repo = server_module

    with TestClient(bridge.app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "repo": str(repo)}


def test_root_serves_the_built_spa_when_the_bundle_is_present(spa_server_module):
    with TestClient(spa_server_module.app) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert "CodeChroma" in response.text


def test_spa_assets_are_served_from_the_mount(spa_server_module):
    with TestClient(spa_server_module.app) as client:
        response = client.get("/assets/index.js")

    assert response.status_code == 200
    assert "canvas" in response.text


def test_api_routes_still_win_over_the_catch_all_mount(spa_server_module):
    with TestClient(spa_server_module.app) as client:
        response = client.get("/repos/default/nodes/root/children")

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_health_still_wins_over_the_catch_all_mount(spa_server_module):
    with TestClient(spa_server_module.app) as client:
        response = client.get("/health")

    assert response.json()["status"] == "ok"


def test_app_starts_without_a_built_spa_so_dev_checkouts_are_unaffected(no_spa_server_module):
    with TestClient(no_spa_server_module.app) as client:
        api = client.get("/repos/default/nodes/root/children")
        root = client.get("/")

    assert api.status_code == 200
    assert root.status_code == 404
