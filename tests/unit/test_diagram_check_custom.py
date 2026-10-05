"""Custom's own findings in the unified self-check -- the one kind that had no coverage before."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = (
    Path(__file__).parent.parent.parent
    / ".claude"
    / "skills"
    / "codechroma-draw-diagram"
    / "scripts"
    / "check_diagram.py"
)


def _run(tmp_path, diagram, *extra):
    path = tmp_path / "flow.json"
    path.write_text(json.dumps(diagram), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--kind", "custom", "--type", "flow",
         "--json", str(path), *extra],
        capture_output=True,
        text=True,
    )


def _node(name):
    return {"id": name, "name": name.upper(), "node_id": f"component::src/{name}.py"}


def test_a_clean_two_box_diagram_passes(tmp_path):
    diagram = {"nodes": [_node("a"), _node("b")],
               "relations": [{"from": "a", "to": "b", "label": "writes"}]}

    result = _run(tmp_path, diagram)

    assert result.returncode == 0


def test_a_relation_naming_an_unknown_box_is_reported_as_dangling(tmp_path):
    diagram = {"nodes": [_node("a")], "relations": [{"from": "a", "to": "ghost"}]}

    result = _run(tmp_path, diagram)

    assert result.returncode == 1
    assert "DANGLING" in result.stdout


def test_a_repeated_id_is_reported_because_relations_address_boxes_by_bare_id(tmp_path):
    diagram = {"nodes": [_node("a"), _node("a")], "relations": []}

    result = _run(tmp_path, diagram)

    assert result.returncode == 3
    assert "DUPLICATE" in result.stdout


def test_a_cluster_that_relates_only_to_itself_is_reported_as_an_island(tmp_path):
    diagram = {
        "nodes": [_node("a"), _node("b"), _node("c"), _node("d")],
        "relations": [{"from": "a", "to": "b"}, {"from": "c", "to": "d"}],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 3
    assert "ISLAND" in result.stdout


@pytest.mark.parametrize(
    ("style", "expected_code"),
    [("boxes-arrows", 1), ("dependency-graph", 0)],
)
def test_a_self_relation_is_noise_everywhere_but_a_dependency_graph(tmp_path, style, expected_code):
    # 🔴 There a node relating to itself is real data (recursion), not a mistake to clean up.
    diagram = {"nodes": [_node("a")], "relations": [{"from": "a", "to": "a"}], "style": style}

    result = _run(tmp_path, diagram, "--shape-advisory")

    assert result.returncode == expected_code
