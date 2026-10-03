"""TestClient coverage for the Impact diagram routes: diff-seeded and plan-seeded slices."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import diagram_json_path

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"

SLUGIFY = "shared/text_utils.py::function::slugify"
TEXT_UTILS_COMPONENT = "component::shared/text_utils.py"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


def _edit_slugify(repo: Path) -> None:
    path = repo / "shared" / "text_utils.py"
    path.write_text(path.read_text().replace('" ", "-"', '" ", "_"'))


def _write_feature(repo: Path, feature: str = "feature/specs") -> None:
    """A feature dir whose plan.md/tasks.md name code paths the graph resolves."""
    feature_dir = repo / feature
    feature_dir.mkdir(parents=True, exist_ok=True)
    (feature_dir / "plan.md").write_text(
        "# Plan\n- [x] T1 Implement `shared/text_utils.py` tweaks\n"
    )
    (feature_dir / "tasks.md").write_text(
        "# Tasks\n- [x] T2 Create `users/service.py` users\n"
    )


@pytest.fixture
def bridge(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    return make_bridge(repo), repo


def test_impact_context_carries_reason_and_anchor_evidence(bridge):
    test_client, repo = bridge
    _edit_slugify(repo)

    with TestClient(test_client.app) as client:
        body = client.get("/repos/default/impact/context?source=diff").json()["generation_data"]

    assert body["source"] == "diff"
    # Impact diff (git_diff.py) seeds both the changed file's whole-text `component::` box and the
    # per-function diff, so an edit to one file surfaces two seeds.
    assert body["seed_count"] == 2
    slugify_ctx = next(node for node in body["nodes"] if node["id"] == SLUGIFY)
    assert slugify_ctx["seed"] is True
    assert slugify_ctx["reason"] == "modified"
    assert slugify_ctx["path"] == "shared/text_utils.py"
    assert slugify_ctx["level"] == "function"
    # The file-level whole-text diff is a second seed, reason-inherited from the child.
    component_ctx = next(node for node in body["nodes"] if node["id"] == TEXT_UTILS_COMPONENT)
    assert component_ctx["seed"] is True
    assert component_ctx["reason"] == "modified"
    # One-hop neighbours carry no reason but keep their real ids.
    caller = next(node for node in body["nodes"] if node["name"] == "UserService")
    assert caller["seed"] is False
    assert caller["reason"] is None


def test_impact_context_diff_source_ignores_ide_clutter(bridge):
    test_client, repo = bridge
    # An untouched dev machine's bare tree shows .idea/ as untracked; it must never seed impact.
    idea = repo / ".idea"
    idea.mkdir()
    (idea / ".gitignore").write_text("")
    (idea / "modules.xml").write_text("workspace.xml")

    with TestClient(test_client.app) as client:
        body = client.get("/repos/default/impact/context?source=diff").json()["generation_data"]

    assert body["seed_count"] == 0
    assert all(".idea" not in node["id"] for node in body["nodes"])
    assert body["nodes"] == []


def test_impact_context_plan_source_seeds_from_feature_specs(bridge):
    test_client, repo = bridge
    _write_feature(repo)

    with TestClient(test_client.app) as client:
        body = client.get(
            "/repos/default/impact/context?source=plan&feature=feature/specs"
        ).json()["generation_data"]

    assert body["source"] == "plan"
    assert body["feature"] == "feature/specs"
    # A mined path resolves (with no symbol) to its file-level component node as the seed.
    text_ctx = next(node for node in body["nodes"] if node["id"] == TEXT_UTILS_COMPONENT)
    assert text_ctx["seed"] is True
    # The reason comes from the spec line naming the path, not a git status word.
    assert "shared/text_utils.py" in text_ctx["reason"]
    # A second mined path resolves to its own seed.
    service_node = next(
        node for node in body["nodes"] if node["id"] == "component::users/service.py"
    )
    assert service_node["seed"] is True


def test_impact_context_plan_source_with_no_feature_is_empty(bridge):
    test_client, _repo = bridge

    with TestClient(test_client.app) as client:
        body = client.get("/repos/default/impact/context?source=plan").json()["generation_data"]

    assert body["source"] == "plan"
    assert body["seed_count"] == 0
    assert body["nodes"] == []


def test_impact_get_without_authored_file_is_not_a_diagram(bridge):
    test_client, _repo = bridge

    with TestClient(test_client.app) as client:
        body = client.get("/repos/default/impact").json()

    assert body["has_diagram"] is False
    assert body["nodes"] == []


def test_impact_get_serves_an_authored_file(bridge):
    test_client, repo = bridge
    impact_path = diagram_json_path(repo, "impact")
    impact_path.parent.mkdir(parents=True, exist_ok=True)
    impact_path.write_text(json.dumps({
        "nodes": [
            {"id": SLUGIFY, "name": "slugify", "node_id": SLUGIFY, "seed": True},
        ],
        "relations": [],
        "fingerprint": "irrelevant",
    }))

    with TestClient(test_client.app) as client:
        body = client.get("/repos/default/impact").json()

    assert body["has_diagram"] is True
    assert body["nodes"][0]["name"] == "slugify"


def test_impact_get_preserves_plan_status_and_relation_label(bridge):
    test_client, repo = bridge
    impact_path = diagram_json_path(repo, "impact")
    impact_path.parent.mkdir(parents=True, exist_ok=True)
    impact_path.write_text(json.dumps({
        "nodes": [
            {
                "id": SLUGIFY, "name": "slugify", "node_id": SLUGIFY, "seed": True,
                "meta": {"status": "modified"},
            },
            {
                "id": "component::shared/text_utils.py", "name": "text_utils.py",
                "node_id": TEXT_UTILS_COMPONENT, "seed": True, "meta": {"status": "new"},
            },
            # A node with a bogus status drops the field rather than mis-colouring the box.
            {
                "id": "other", "name": "Other", "node_id": "other", "seed": True,
                "meta": {"status": "bogus"},
            },
        ],
        "relations": [
            {"from": SLUGIFY, "to": TEXT_UTILS_COMPONENT, "label": "defined in"},
        ],
        "fingerprint": "irrelevant",
    }))

    with TestClient(test_client.app) as client:
        body = client.get("/repos/default/impact").json()

    nodes = {node["id"]: node for node in body["nodes"]}
    assert nodes[SLUGIFY]["meta"]["status"] == "modified"
    assert nodes[TEXT_UTILS_COMPONENT]["meta"]["status"] == "new"
    # An invalid status is dropped (None) instead of leaking through.
    assert nodes["other"]["meta"]["status"] is None
    assert body["relations"][0]["label"] == "defined in"


def test_impact_drops_a_node_with_no_resolved_node_id(bridge):
    test_client, repo = bridge
    impact_path = diagram_json_path(repo, "impact")
    impact_path.parent.mkdir(parents=True, exist_ok=True)
    impact_path.write_text(json.dumps({
        "nodes": [
            {"id": SLUGIFY, "name": "slugify", "node_id": SLUGIFY, "seed": True},
            {"id": "unseeded", "name": "No node_id yet"},
        ],
        "relations": [],
        "fingerprint": "irrelevant",
    }))

    with TestClient(test_client.app) as client:
        body = client.get("/repos/default/impact").json()

    ids = {node["id"] for node in body["nodes"]}
    assert ids == {SLUGIFY}
    reasons = {entry["id"]: entry["reason"] for entry in body["diagnostics"]["dropped"]}
    assert reasons["unseeded"] == "unresolved_path"


def test_impact_staleness_follows_the_authored_source(bridge):
    test_client, repo = bridge
    _write_feature(repo)
    # Authored under the plan sponsor with a fingerprint stale vs the current plan slice.
    impact_path = diagram_json_path(repo, "impact")
    impact_path.parent.mkdir(parents=True, exist_ok=True)
    impact_path.write_text(json.dumps({
        "source": "plan",
        "feature": "feature/specs",
        "fingerprint": "old",
        "generated_at": "t",
        "nodes": [], "relations": [],
    }))

    with TestClient(test_client.app) as client:
        body = client.get("/repos/default/impact").json()

    assert body["source"] == "plan"
    assert body["feature"] == "feature/specs"
    assert body["fingerprint"] != "old"
    assert body["seed_count"] == 2  # two spec-mined seeds, not the (empty) diff
    assert body["stale"] is True


def test_impact_staleness_follows_a_mismatched_feature(bridge):
    test_client, repo = bridge
    _write_feature(repo)
    impact_path = diagram_json_path(repo, "impact")
    impact_path.parent.mkdir(parents=True, exist_ok=True)
    impact_path.write_text(json.dumps({
        "source": "plan",
        "feature": "feature/other",  # a different feature dir: different seeds -> stale
        "fingerprint": "old",
        "generated_at": "t",
        "nodes": [], "relations": [],
    }))

    with TestClient(test_client.app) as client:
        body = client.get("/repos/default/impact").json()

    assert body["feature"] == "feature/other"
    assert body["stale"] is True
