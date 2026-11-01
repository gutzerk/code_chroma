"""The Python and TypeScript `NON_DIAGRAM_LAYERS` sets must list the same layer names."""

import re
from pathlib import Path

from codechroma.canvas.document import (
    CANVAS_ONLY_LAYER_PREFIX,
    NON_DIAGRAM_LAYERS,
    is_canvas_only_layer,
)

_CATALOG = Path(__file__).parents[2] / "web" / "src" / "canvas" / "doc" / "diagramCatalog.ts"


def test_non_diagram_layers_parity():
    source = _CATALOG.read_text(encoding="utf-8")
    match = re.search(r"const NON_DIAGRAM_LAYERS = new Set\(\[(.*?)\]\)", source, re.S)
    assert match, "NON_DIAGRAM_LAYERS not found in diagramCatalog.ts"

    ts_layers = set(re.findall(r'"([^"]+)"', match.group(1)))

    assert ts_layers == set(NON_DIAGRAM_LAYERS)


def test_decisions_prefix_rule_parity():
    source = _CATALOG.read_text(encoding="utf-8")

    assert f'"{CANVAS_ONLY_LAYER_PREFIX}"' in source


def test_per_question_decision_layers_are_canvas_only_and_other_layers_are_not():
    assert is_canvas_only_layer("decisions/abc123")
    assert is_canvas_only_layer("questions")
    assert not is_canvas_only_layer("c1")
    assert not is_canvas_only_layer("decisionsx/abc")
