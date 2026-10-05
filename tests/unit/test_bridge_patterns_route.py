"""TestClient coverage for GET/POST /repos/{id}/patterns and the "patterns" broadcast."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import diagram_json_path

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"

_STRATEGY_SOURCE = b"""
from abc import ABC, abstractmethod


class DiscountStrategy(ABC):
    @abstractmethod
    def apply(self, price):
        ...


class PercentDiscount(DiscountStrategy):
    def apply(self, price):
        return price * 0.9


class FlatDiscount(DiscountStrategy):
    def apply(self, price):
        return price - 5
"""


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
    (repo / "discounts.py").write_bytes(_STRATEGY_SOURCE)
    _init_repo(repo)
    # No ANTHROPIC_API_KEY (set, not deleted, so a real .env's key can't leak into these tests).
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    yield make_bridge(repo), repo


def test_patterns_route_surfaces_a_heuristic_strategy_candidate(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/patterns").json()

    strategies = [
        n for n in payload["nodes"]
        if n.get("kind") == "pattern-instance" and n["meta"]["type"] == "strategy"
    ]
    assert len(strategies) == 1
    assert strategies[0]["meta"]["confirmed"] is None
    assert payload["has_diagram"] is False


def test_patterns_route_is_never_stale_with_no_confirmation_on_disk(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/patterns").json()

    assert payload["stale"] is False


def test_resolved_patterns_pass_through_authored_nodes_and_relations(server_module):
    bridge, repo = server_module
    patterns_file = diagram_json_path(repo, "patterns")
    patterns_file.parent.mkdir(parents=True, exist_ok=True)
    patterns_file.write_text(
        json.dumps(
            {
                "type": "patterns",
                "nodes": [
                    {"id": "infra::api-app", "name": "API App", "kind": "infra"},
                    {"id": "ext::postgres", "name": "PostgreSQL", "kind": "external"},
                ],
                "relations": [
                    {"from": "infra::api-app", "to": "ext::postgres", "kind": "uses"}
                ],
            }
        )
, encoding="utf-8")

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/patterns").json()

    node_ids = {n["id"] for n in payload["nodes"]}
    assert {"infra::api-app", "ext::postgres"} <= node_ids
    relation_triples = [
        (r["from"], r["to"], r["kind"]) for r in payload["relations"]
    ]
    assert ("infra::api-app", "ext::postgres", "uses") in relation_triples
    # True even with no "generated_at" key in the file -- has_diagram tracks existence, not fields.
    assert payload["has_diagram"] is True


def test_rejected_instances_are_dropped_from_the_resolved_payload(server_module):
    bridge, repo = server_module
    patterns_file = diagram_json_path(repo, "patterns")
    patterns_file.parent.mkdir(parents=True, exist_ok=True)
    patterns_file.write_text(
        json.dumps(
            {
                "type": "patterns",
                "nodes": [
                    {
                        "id": "repository::test_double", "kind": "pattern-instance",
                        "name": "Repository -- [REJECTED] test-only implementation",
                        "description": "A test double, not a real pattern instance.",
                        "meta": {"type": "repository", "confirmed": False, "confidence": 0.1},
                    }
                ],
                "relations": [],
            }
        )
, encoding="utf-8")

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/patterns").json()

    assert "repository::test_double" not in {n["id"] for n in payload["nodes"]}


def test_writing_the_patterns_file_broadcasts_a_patterns_ping(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client, client.websocket_connect("/repos/default/events") as ws:
        bridge.registry.get("default")._watchers.on_diagram_change("patterns")
        message = ws.receive_json()

    assert message == {"type": "patterns"}
