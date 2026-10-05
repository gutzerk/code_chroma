"""feature-plan's own kind in the unified self-check -- no saved definition, custom's defaults."""

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


def _run(tmp_path, diagram, *extra):
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(diagram), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--kind", "feature-plan", "--slug", "token-auth",
         "--json", str(path), *extra],
        capture_output=True,
        text=True,
    )


def test_kind_feature_plan_requires_a_slug():
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--kind", "feature-plan"],
        capture_output=True, text=True,
    )

    assert result.returncode == 2
    assert "--slug" in result.stderr


def test_a_path_less_add_block_passes_clean(tmp_path):
    diagram = {
        "nodes": [
            {"id": "existing", "name": "AUTH", "node_id": "component::src/auth.py"},
            {"id": "new-mw", "name": "NEW MIDDLEWARE", "meta": {"plan_kind": "add"}},
        ],
        "relations": [{"from": "new-mw", "to": "existing", "label": "wraps"}],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 0
    assert "BROKEN" not in result.stdout


def test_a_relation_naming_an_unknown_box_is_reported_as_dangling(tmp_path):
    diagram = {
        "nodes": [{"id": "new-mw", "name": "NEW MIDDLEWARE", "meta": {"plan_kind": "add"}}],
        "relations": [{"from": "new-mw", "to": "ghost"}],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 1
    assert "DANGLING" in result.stdout


def test_density_budgets_match_customs_defaults(tmp_path):
    nodes = [{"id": f"n{i}", "name": f"N{i}", "meta": {"plan_kind": "add"}} for i in range(61)]

    result = _run(tmp_path, {"nodes": nodes, "relations": []}, "--shape-advisory")
    assert "CROWDED" in result.stdout


def test_parent_without_group_and_without_relation_is_orphan(tmp_path):
    """A `parent`-only block draws no canvas frame (only `group` does) -- without either it
    detaches like a free-standing node. This is the C2 `parent`-vs-`group` trap."""
    diagram = {
        "nodes": [
            {"id": "web", "name": "Web", "group": "UI"},
            {"id": "web-src", "name": "Src", "parent": "web"},
        ],
        "relations": [],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 3
    assert "ORPHAN 'web-src'" in result.stdout


def test_parent_block_with_a_group_of_its_own_is_not_orphan(tmp_path):
    """`group` on the inner box is the legit way to nest it on the canvas -- parent alone is not."""
    diagram = {
        "nodes": [
            {"id": "web", "name": "Web", "group": "UI"},
            {"id": "web-src", "name": "Src", "parent": "web", "group": "Web"},
            {"id": "api", "name": "API"},
        ],
        "relations": [{"from": "web", "to": "api", "kind": "uses"}],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 0
    assert "ORPHAN" not in result.stdout


def test_parent_block_with_an_edge_of_its_own_is_not_orphan(tmp_path):
    """A parent-under block that participates in a relation is connected -- not bare."""
    diagram = {
        "nodes": [
            {"id": "web", "name": "Web", "group": "UI"},
            {"id": "web-src", "name": "Src", "parent": "web"},
        ],
        "relations": [{"from": "web-src", "to": "web", "kind": "uses"}],
    }

    result = _run(tmp_path, diagram)

    assert result.returncode == 0
    assert "ORPHAN" not in result.stdout


def test_participant_under_a_pattern_instance_is_not_orphan(tmp_path):
    """A box nested under a `pattern-instance` parent connects via its instance box -- the C2
    orphan rule would otherwise flag it. An instance box is never a generic orphan either: its
    diagnostics are owned by the patterns marker check, not this rule."""
    diagram = {
        "nodes": [
            {"id": "pattern::adapter", "name": "Adapter", "kind": "pattern-instance"},
            {"id": "adapter::s3", "name": "S3Client", "parent": "pattern::adapter"},
        ],
        "relations": [],
    }

    result = _run(tmp_path, diagram)

    assert "ORPHAN 'adapter::s3'" not in result.stdout
    assert "ORPHAN 'pattern::adapter'" not in result.stdout
