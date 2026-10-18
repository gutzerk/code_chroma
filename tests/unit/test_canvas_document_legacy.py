"""CanvasDoc.load drops the retired code-tree ("hierarchy") block of an old canvas-core.json."""

from codechroma.canvas.document import CanvasDoc
from codechroma.io import write_json


def test_load_drops_a_legacy_hierarchy_element_but_keeps_the_rest(tmp_path):
    core = tmp_path / "canvas-core.json"
    elements = {
        "seed-hierarchy": {"id": "seed-hierarchy", "render": "hierarchy", "layer": "hierarchy"},
        "n1": {"id": "n1", "render": "note", "label": "hi"},
    }
    write_json(core, {"elements": elements})

    doc = CanvasDoc.load(core, tmp_path / "diagrams")

    assert list(doc.elements) == ["n1"]
