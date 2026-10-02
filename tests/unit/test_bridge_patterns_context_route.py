"""TestClient coverage for GET /repos/{id}/patterns/context and /repos/{id}/patterns-path."""

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

    bridge = make_bridge(repo)
    return bridge, repo


def test_patterns_context_surfaces_class_shapes_and_heuristic_seed(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/patterns/context").json()["generation_data"]

    names = {entry["name"] for entry in payload["classes"]}
    assert "DiscountStrategy" in names
    assert "PercentDiscount" in names
    percent_discount = next(e for e in payload["classes"] if e["name"] == "PercentDiscount")
    assert "DiscountStrategy" in percent_discount["bases"]
    assert any(candidate["type"] == "strategy" for candidate in payload["heuristic_candidates"])


def test_patterns_path_points_at_dot_codechroma(server_module):
    bridge, repo = server_module

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/patterns-path").json()

    assert payload["repo_root"] == str(repo)
    assert payload["patterns_path"] == str(diagram_json_path(repo, "patterns"))
