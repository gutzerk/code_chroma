"""Unit coverage for the codechroma-patterns self-check script the skill runs after writing
patterns.json."""

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = (
    Path(__file__).parent.parent.parent
    / ".claude"
    / "skills"
    / "codechroma-draw-diagram"
    / "scripts"
    / "check_diagram.py"
)


def _run(tmp_path, diagram, *extra_args):
    path = tmp_path / "patterns.json"
    path.write_text(json.dumps(diagram))
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--kind", "patterns", "--json", str(path), *extra_args],
        capture_output=True,
        text=True,
    )


def _chain(prefix, members, confirmed=True, wire_instance=True):
    """036: one instance node plus its participant nodes (parent set), flat, not nested.

    A confirmed instance box participates in the graph: a relation links the box to its first
    participant (`wire_instance=True`), so the container is not dead weight the canvas reads
    as an unrelated block (see _check_bare_pattern_markers).
    """
    instance_id = f"pattern::{prefix}"
    participants = [
        {"id": f"{prefix}::{m}", "parent": instance_id, "name": m, "meta": {"role": "role"}}
        for m in members
    ]
    relations = [
        {"from": participants[i]["id"], "to": participants[i + 1]["id"], "kind": "uses"}
        for i in range(len(participants) - 1)
    ]
    if wire_instance:
        relations.append({"from": instance_id, "to": participants[0]["id"], "kind": "uses"})
    instance = {
        "id": instance_id, "name": prefix, "kind": "pattern-instance",
        "meta": {"type": "strategy", "confirmed": confirmed},
    }
    return {"nodes": [instance, *participants], "relations": relations}


def test_fully_connected_diagram_has_no_island_finding(tmp_path):
    chain = _chain("adapter", ["s3_client", "model_iface"])
    diagram = {
        "nodes": [*chain["nodes"], {"id": "infra::startup", "name": "Startup", "kind": "infra"}],
        "relations": [
            *chain["relations"],
            {"from": "infra::startup", "to": "adapter::s3_client", "kind": "uses"},
        ],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 0
    assert "ISLAND" not in result.stdout
    assert "OK:" in result.stdout


def test_adapter_wired_only_to_its_external_target_is_reported_as_island(tmp_path):
    chain = _chain("facade", ["api_app", "guardrails_facade", "policy_service", "audit_log"])
    diagram = {
        "nodes": [
            *chain["nodes"],
            {"id": "class::s3_model_client", "name": "S3ModelClient", "kind": "infra"},
            {"id": "ext::s3", "name": "S3", "kind": "external"},
        ],
        "relations": [
            *chain["relations"], {"from": "class::s3_model_client", "to": "ext::s3", "kind": "uses"}
        ],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 3
    assert "ISLAND" in result.stdout
    assert "'class::s3_model_client'" in result.stdout
    assert "'ext::s3'" in result.stdout


def test_shape_advisory_reports_island_without_failing(tmp_path):
    chain = _chain("facade", ["api_app", "guardrails_facade", "policy_service"])
    diagram = {
        "nodes": [
            *chain["nodes"],
            {"id": "class::s3_model_client", "name": "S3ModelClient", "kind": "infra"},
            {"id": "ext::s3", "name": "S3", "kind": "external"},
        ],
        "relations": [
            *chain["relations"], {"from": "class::s3_model_client", "to": "ext::s3", "kind": "uses"}
        ],
    }

    result = _run(tmp_path, diagram, "--shape-advisory")

    assert result.returncode == 0
    assert "ISLAND" in result.stdout
    assert "OK:" in result.stdout


def test_unconfirmed_instance_is_reported_and_fails_the_run(tmp_path):
    chain = _chain("registry", ["tool_registry", "tool_base"], confirmed=None)
    diagram = {"nodes": chain["nodes"], "relations": chain["relations"]}

    result = _run(tmp_path, diagram)

    assert result.returncode == 3
    assert "UNREVIEWED 'pattern::registry'" in result.stdout


def test_two_equal_size_disconnected_components_flags_exactly_one(tmp_path):
    alpha = _chain("alpha", ["a1", "a2", "a3"])
    beta = _chain("beta", ["b1", "b2", "b3"])
    diagram = {
        "nodes": [*alpha["nodes"], *beta["nodes"]],
        "relations": [*alpha["relations"], *beta["relations"]],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 3
    assert result.stdout.count("ISLAND") == 1
    assert "'beta::b1'" in result.stdout
    # Both instance boxes are wired to a participant, so the container guard never flags them.
    assert "ORPHAN 'pattern::alpha'" not in result.stdout
    assert "ORPHAN 'pattern::beta'" not in result.stdout


def test_single_small_pattern_instance_does_not_false_positive(tmp_path):
    chain = _chain("singleton", ["config_loader", "config"])
    diagram = {"nodes": chain["nodes"], "relations": chain["relations"]}

    result = _run(tmp_path, diagram)

    assert result.returncode == 0
    assert "ISLAND" not in result.stdout


def test_merged_node_with_node_ids_and_path_is_not_broken(tmp_path):
    # A merged infra box collapses several real classes into node_ids[], not a single node_id.
    diagram = {
        "nodes": [
            {
                "id": "infra::logging",
                "name": "Logging System",
                "kind": "infra",
                "path": "backend/internal/logging",
                "node_ids": [
                    "backend/internal/logging/logging.go::class::New",
                    "backend/internal/logging/logging.go::class::newLogger",
                ],
            }
        ],
        "relations": [],
    }

    result = _run(tmp_path, diagram, "--shape-advisory")

    assert "BROKEN" not in result.stdout
    assert result.returncode in (0, 3)  # ORPHAN may still flag it as unconnected; BROKEN never does


def test_existing_orphan_check_still_owns_lone_top_level_nodes(tmp_path):
    diagram = {
        "nodes": [{"id": "ext::redis", "name": "Redis", "kind": "external"}],
        "relations": [],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 3
    assert "ORPHAN 'ext::redis'" in result.stdout
    assert "ISLAND" not in result.stdout


def test_dangling_relation_does_not_crash_the_island_check(tmp_path):
    diagram = {
        "nodes": [{"id": "infra::x", "name": "X", "kind": "infra"}],
        "relations": [{"from": "infra::x", "to": "ghost::nothing", "kind": "uses"}],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 1
    assert "DANGLING" in result.stdout


def test_a_participant_with_no_relation_of_its_own_is_never_orphan(tmp_path):
    """A participant "connects" via its instance -- ORPHAN scopes to free-standing nodes only."""
    chain = _chain("lonely", ["only_member"])
    diagram = {"nodes": chain["nodes"], "relations": []}

    result = _run(tmp_path, diagram, "--shape-advisory")

    assert "ORPHAN 'lonely::only_member'" not in result.stdout


def test_confirmed_instance_box_with_no_relation_of_its_own_is_orphaned(tmp_path):
    """A container box with participants but no edge of its own reads as dead weight."""
    chain = _chain("facade", ["gateway", "store"])
    diagram = {
        "nodes": chain["nodes"],
        # Instance box never appears in a relation -- only its participants do.
        "relations": [r for r in chain["relations"] if r["from"] != "pattern::facade"],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 3
    assert "ORPHAN 'pattern::facade'" in result.stdout
    assert "with no relation of its own" in result.stdout


def test_confirmed_instance_box_wired_to_participant_is_not_orphaned(tmp_path):
    """Once the box is linked to a participant it participates -- the guard stays quiet."""
    chain = _chain("facade", ["gateway", "store"])

    result = _run(tmp_path, chain)

    assert result.returncode == 0
    assert "ORPHAN 'pattern::facade'" not in result.stdout
    assert "OK:" in result.stdout
