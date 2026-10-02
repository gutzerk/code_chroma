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
    path.write_text(json.dumps(diagram))
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
