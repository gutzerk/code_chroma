"""The Python and TypeScript `NON_DIAGRAM_LAYERS` sets must list the same layer names."""

import re
from pathlib import Path

from codechroma.canvas.document import NON_DIAGRAM_LAYERS

_CATALOG = Path(__file__).parents[2] / "web" / "src" / "canvas" / "doc" / "diagramCatalog.ts"


def test_non_diagram_layers_parity():
    source = _CATALOG.read_text(encoding="utf-8")
    match = re.search(r"const NON_DIAGRAM_LAYERS = new Set\(\[(.*?)\]\)", source, re.S)
    assert match, "NON_DIAGRAM_LAYERS not found in diagramCatalog.ts"

    ts_layers = set(re.findall(r'"([^"]+)"', match.group(1)))

    assert ts_layers == set(NON_DIAGRAM_LAYERS)
