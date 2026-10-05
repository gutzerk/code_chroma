"""Unit coverage for the codechroma-impact self-check script the skill runs after writing
impact.json."""

import argparse
import importlib.util
import json
import subprocess
import sys
import urllib.error
from pathlib import Path

SCRIPT = (
    Path(__file__).parent.parent.parent
    / ".claude"
    / "skills"
    / "codechroma-draw-diagram"
    / "scripts"
    / "check_diagram.py"
)


def _load_module():
    """Imports the script by path, registering it in sys.modules first so its @dataclass works."""
    spec = importlib.util.spec_from_file_location("check_impact", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_impact"] = module
    spec.loader.exec_module(module)
    return module


def _run_json(tmp_path, diagram, *extra_args):
    path = tmp_path / "impact.json"
    path.write_text(json.dumps(diagram), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--kind", "impact", "--json", str(path), *extra_args],
        capture_output=True,
        text=True,
    )


def test_json_mode_still_allows_dir_and_component_ids_free(tmp_path):
    diagram = {
        "nodes": [
            {"id": "a", "node_id": "dir::gateway-orchestration/internal/blueprint/fit"},
            {"id": "b", "node_id": "component::gateway-orchestration/cmd/server/main.go"},
        ],
        "relations": [{"from": "a", "to": "b"}],
    }

    result = _run_json(tmp_path, diagram)

    assert result.returncode == 0
    # Advisory lines (here UNLABELED) may print above OK; only the exit code gates the run.
    assert "OK:" in result.stdout


def _node(name):
    return {"id": name, "name": name.upper(), "node_id": f"component::src/{name}.py"}


def test_two_boxes_wired_only_to_each_other_are_reported_as_an_island(tmp_path):
    diagram = {
        "nodes": [_node("a"), _node("b"), _node("c"), _node("d")],
        "relations": [{"from": "a", "to": "b"}, {"from": "c", "to": "d"}],
    }

    result = _run_json(tmp_path, diagram)

    assert result.returncode == 3
    assert "ISLAND" in result.stdout


def test_shape_advisory_reports_the_impact_island_without_failing(tmp_path):
    diagram = {
        "nodes": [_node("a"), _node("b"), _node("c"), _node("d")],
        "relations": [{"from": "a", "to": "b"}, {"from": "c", "to": "d"}],
    }

    result = _run_json(tmp_path, diagram, "--shape-advisory")

    assert result.returncode == 0
    assert "ISLAND" in result.stdout


def _inspect_against_slice(module, diagram, slice_ids, exists):
    """Runs the impact inspection with a stubbed slice, the way bridge mode would supply one."""

    def _fake_fetch(url):
        if url.endswith("/impact/context?source=diff"):
            nodes = [{"node_id": node_id} for node_id in slice_ids]
            return {"generation_data": {"nodes": nodes}}
        node_id = url.rsplit("/nodes/", 1)[-1]
        if exists(node_id):
            return {}
        raise urllib.error.HTTPError(url, 404, "not found", None, None)

    module._fetch_json = _fake_fetch
    args = argparse.Namespace(json_path=None, url="http://x", repo="default",
                              source="diff", feature=None, shape_advisory=False, type=None)
    checks = dict(module._BUILTIN_CHECKS["impact"])
    return module._inspect_flat(diagram, checks, args)


def test_bridge_mode_flags_a_directory_merged_under_the_component_prefix():
    module = _load_module()
    diagram = {
        "nodes": [
            {"id": "a", "node_id": "component::real.go"},
            {"id": "b", "node_id": "component::gateway-orchestration/internal/blueprint/deploy"},
        ],
        "relations": [{"from": "a", "to": "b"}],
    }

    report = _inspect_against_slice(
        module, diagram, {"component::real.go"}, lambda nid: nid == "component::real.go"
    )

    assert any("does not exist" in line for line in report.broken)


def test_bridge_mode_accepts_an_ancestor_id_that_resolves():
    module = _load_module()
    diagram = {
        "nodes": [
            {"id": "a", "node_id": "component::real.go"},
            {"id": "b", "node_id": "dir::gateway-orchestration/internal/blueprint/fit"},
        ],
        "relations": [{"from": "a", "to": "b"}],
    }

    report = _inspect_against_slice(
        module, diagram, {"component::real.go"}, lambda _nid: True
    )

    assert report.broken == []
