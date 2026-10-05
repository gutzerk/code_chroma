"""TestClient coverage for the Impact change-review endpoints and the "impact-changes" broadcast."""


import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import diagram_json_path
from tests.unit.fake_claude import CLI_MISSING

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _tweak_billing_service(repo: Path) -> None:
    """Edits inside create_invoice's body -- a whole-file overwrite reads as the symbol deleted."""
    path = repo / "billing" / "service.py"
    path.write_text(
        path.read_text(encoding="utf-8").replace("return invoice_id", "return invoice_id  # x"),
        encoding="utf-8",
    )


_IMPACT = {
    "type": "impact",
    "nodes": [
        {"id": "svc", "name": "Billing service", "node_id": "component::billing/service.py"},
    ],
    "relations": [],
}


@pytest.fixture
def server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    # No ANTHROPIC_API_KEY (set, not deleted, so a real .env's key can't leak into the bootstrap).
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    bridge = make_bridge(repo)
    return bridge, repo


def test_with_no_diagram_and_no_review_the_payload_is_still_well_formed(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/impact-changes").json()

    assert (payload["blocks"], payload["has_review"]) == ([], False)


def test_a_changed_file_badges_its_block_without_any_review(server_module):
    bridge, repo = server_module
    _write_json(diagram_json_path(repo, "impact"), _IMPACT)
    _tweak_billing_service(repo)

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/impact-changes").json()

    assert [(b["block"], b["status"]) for b in payload["blocks"]] == [("svc", "modified")]


def test_an_authored_review_supplies_the_before_after_prose(server_module):
    bridge, repo = server_module
    _write_json(diagram_json_path(repo, "impact"), _IMPACT)
    (repo / "billing" / "service.py").write_text("changed\n", encoding="utf-8")
    _write_json(
        repo / ".codechroma" / "impact-changes.json",
        {
            "summary": "Billing got a discount rule.",
            "blocks": [
                {"block": "svc", "before": "Flat price.", "after": "Discounted."}
            ],
        },
    )

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/impact-changes").json()

    assert payload["summary"] == "Billing got a discount rule."


def test_the_path_route_reports_where_to_write_and_which_diff_to_review(server_module):
    bridge, repo = server_module
    _write_json(diagram_json_path(repo, "impact"), _IMPACT)
    (repo / "billing" / "service.py").write_text("changed\n", encoding="utf-8")

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/impact-changes-path").json()

    assert payload["impact_changes_path"] == str(repo / ".codechroma" / "impact-changes.json")


def test_the_path_routes_fingerprint_matches_the_changes_route(server_module):
    bridge, repo = server_module
    (repo / "billing" / "service.py").write_text("changed\n", encoding="utf-8")

    with TestClient(bridge.app) as client:
        from_path = client.get("/repos/default/impact-changes-path").json()["fingerprint"]
        from_changes = client.get("/repos/default/impact-changes").json()["fingerprint"]

    assert from_path == from_changes


def test_review_status_defaults_to_idle(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/impact-changes/status").json()

    assert payload == {"state": "idle", "error": None}


def test_generate_reports_an_error_when_the_claude_cli_is_missing(server_module, monkeypatch):
    bridge, _repo = server_module
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)

    with TestClient(bridge.app) as client:
        payload = client.post("/repos/default/impact-changes/generate").json()

    assert payload == {"state": "error", "error": CLI_MISSING}


def test_writing_the_review_file_broadcasts_an_impact_changes_ping(server_module):
    bridge, repo = server_module

    with TestClient(bridge.app) as client, client.websocket_connect("/repos/default/events") as ws:
        bridge.main._watchers.on_impact_changes_change()
        message = ws.receive_json()

    assert message == {"type": "impact-changes"}
