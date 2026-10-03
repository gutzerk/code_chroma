"""Every apply_batch op type, each rejection code, and the caps -- a rejection mutates nothing."""

from __future__ import annotations

import pytest

from codechroma.canvas.apply_batch import (
    MASS_DELETE_GUARD,
    MAX_EXPLANATION_CHARS,
    MAX_OPS_PER_BATCH,
    OpError,
    apply_batch,
    apply_batch_chunked,
)
from codechroma.canvas.document import CanvasDoc, Edge, Element


def test_add_element_creates_it_and_maps_the_temp_id():
    doc = CanvasDoc()

    result = apply_batch(
        doc, [{"op": "add_element", "temp_id": "t1", "render": "c1", "label": "Auth"}]
    )

    assert result.ok
    element = result.doc.elements[result.id_map["t1"]]
    assert element.label == "Auth"
    assert element.render == "c1"


def test_add_note_defaults_render_to_note():
    doc = CanvasDoc()

    result = apply_batch(doc, [{"op": "add_note", "temp_id": "t1", "label": "remember this"}])

    assert result.ok
    assert result.doc.elements[result.id_map["t1"]].render == "note"


def test_add_group_defaults_render_to_group():
    doc = CanvasDoc()

    result = apply_batch(doc, [{"op": "add_group", "temp_id": "g1", "label": "Persistence"}])

    assert result.ok
    assert result.doc.elements[result.id_map["g1"]].render == "group"


def test_add_element_sanitizes_style_to_the_allowed_keys():
    doc = CanvasDoc()

    result = apply_batch(doc, [{
        "op": "add_element", "temp_id": "t1", "render": "c1", "label": "Auth",
        "style": {"background": "var(--accent)", "z-index": "999"},
    }])

    assert result.ok
    element = result.doc.elements[result.id_map["t1"]]
    assert element.style == {"background": "var(--accent)"}


def test_add_element_without_a_position_cascades_instead_of_piling_at_origin():
    doc = CanvasDoc()

    result = apply_batch(doc, [
        {"op": "add_element", "temp_id": "a", "render": "c1", "label": "A"},
        {"op": "add_element", "temp_id": "b", "render": "c1", "label": "B"},
    ])

    assert result.ok
    pos_a = result.doc.elements[result.id_map["a"]].position
    pos_b = result.doc.elements[result.id_map["b"]].position
    # Position-less adds spread down-right (routes/canvas.py path), never piling
    # at (0,0) or stacking on each other.
    assert (pos_a.x, pos_a.y) != (0.0, 0.0)
    assert (pos_b.x, pos_b.y) != (0.0, 0.0)
    assert pos_b.x > pos_a.x


def test_explicit_position_still_wins_over_the_default_cascade():
    doc = CanvasDoc()

    result = apply_batch(doc, [
        {"op": "add_element", "temp_id": "a", "render": "c1", "label": "A",
         "position": {"x": 5, "y": 5}},
    ])

    assert result.ok
    assert result.doc.elements[result.id_map["a"]].position.x == 5


def test_add_edge_resolves_temp_ids_from_the_same_batch():
    doc = CanvasDoc()
    ops = [
        {"op": "add_element", "temp_id": "a", "render": "c1", "label": "A"},
        {"op": "add_element", "temp_id": "b", "render": "c1", "label": "B"},
        {"op": "add_edge", "temp_id": "e", "from": "a", "to": "b", "label": "calls"},
    ]

    result = apply_batch(doc, ops)

    assert result.ok
    edge = result.doc.edges[result.id_map["e"]]
    assert edge.from_ == result.id_map["a"]
    assert edge.to == result.id_map["b"]


def test_add_edge_carries_the_authored_transport():
    doc = CanvasDoc()
    ops = [
        {"op": "add_element", "temp_id": "a", "render": "c1", "label": "A"},
        {"op": "add_element", "temp_id": "b", "render": "c1", "label": "B"},
        {
            "op": "add_edge", "temp_id": "e", "from": "a", "to": "b",
            "label": "calls", "transport": "mcp",
        },
    ]

    result = apply_batch(doc, ops)

    assert result.ok
    assert result.doc.edges[result.id_map["e"]].transport == "mcp"


def test_add_edge_sanitizes_style_to_the_allowed_keys():
    doc = CanvasDoc()
    ops = [
        {"op": "add_element", "temp_id": "a", "render": "c1", "label": "A"},
        {"op": "add_element", "temp_id": "b", "render": "c1", "label": "B"},
        {
            "op": "add_edge", "temp_id": "e", "from": "a", "to": "b",
            "style": {"border-color": "var(--warning)", "z-index": "999"},
        },
    ]

    result = apply_batch(doc, ops)

    assert result.ok
    edge = result.doc.edges[result.id_map["e"]]
    assert edge.style == {"border-color": "var(--warning)"}


def test_update_edge_clears_style_when_set_to_null():
    doc = CanvasDoc(
        elements={"a": Element(id="a", render="c1"), "b": Element(id="b", render="c1")},
        edges={"e1": Edge(id="e1", **{"from": "a"}, to="b", style={"color": "red"})},
    )

    result = apply_batch(doc, [{"op": "update_edge", "id": "e1", "style": None}])

    assert result.ok
    assert result.doc.edges["e1"].style is None


def test_update_element_patches_position_and_label():
    doc = CanvasDoc(elements={"e1": Element(id="e1", render="c1", label="old")})

    result = apply_batch(doc, [
        {"op": "update_element", "id": "e1", "label": "new", "position": {"x": 10, "y": 20}},
    ])

    assert result.ok
    element = result.doc.elements["e1"]
    assert element.label == "new"
    assert element.position.x == 10


def test_update_element_replaces_style_wholesale_not_merged():
    doc = CanvasDoc(elements={
        "e1": Element(id="e1", render="c1", style={"color": "red", "background": "blue"}),
    })

    result = apply_batch(doc, [
        {"op": "update_element", "id": "e1", "style": {"background": "green"}},
    ])

    assert result.ok
    assert result.doc.elements["e1"].style == {"background": "green"}


def test_update_element_clears_style_when_set_to_null():
    doc = CanvasDoc(elements={"e1": Element(id="e1", render="c1", style={"color": "red"})})

    result = apply_batch(doc, [{"op": "update_element", "id": "e1", "style": None}])

    assert result.ok
    assert result.doc.elements["e1"].style is None


def test_update_edge_patches_label():
    doc = CanvasDoc(
        elements={"a": Element(id="a", render="c1"), "b": Element(id="b", render="c1")},
        edges={"e1": Edge(id="e1", **{"from": "a"}, to="b", label="old")},
    )

    result = apply_batch(doc, [{"op": "update_edge", "id": "e1", "label": "new"}])

    assert result.ok
    assert result.doc.edges["e1"].label == "new"


def test_delete_element_cascades_to_its_edges():
    doc = CanvasDoc(
        elements={"a": Element(id="a", render="c1"), "b": Element(id="b", render="c1")},
        edges={"e1": Edge(id="e1", **{"from": "a"}, to="b")},
    )

    result = apply_batch(doc, [{"op": "delete_element", "id": "a"}])

    assert result.ok
    assert "a" not in result.doc.elements
    assert "e1" not in result.doc.edges


def test_delete_edge_is_a_no_op_once_its_own_batch_already_cascaded_it_away():
    doc = CanvasDoc(
        elements={"a": Element(id="a", render="c1"), "b": Element(id="b", render="c1")},
        edges={"e1": Edge(id="e1", **{"from": "a"}, to="b")},
    )

    result = apply_batch(doc, [
        {"op": "delete_element", "id": "a"},
        {"op": "delete_edge", "id": "e1"},
    ])

    assert result.ok
    assert "e1" not in result.doc.edges


def test_update_edge_is_a_no_op_once_its_own_batch_already_cascaded_it_away():
    doc = CanvasDoc(
        elements={"a": Element(id="a", render="c1"), "b": Element(id="b", render="c1")},
        edges={"e1": Edge(id="e1", **{"from": "a"}, to="b")},
    )

    result = apply_batch(doc, [
        {"op": "delete_element", "id": "a"},
        {"op": "update_edge", "id": "e1", "label": "renamed"},
    ])

    assert result.ok
    assert "e1" not in result.doc.edges


def test_delete_edge_removes_it():
    doc = CanvasDoc(
        elements={"a": Element(id="a", render="c1"), "b": Element(id="b", render="c1")},
        edges={"e1": Edge(id="e1", **{"from": "a"}, to="b")},
    )

    result = apply_batch(doc, [{"op": "delete_edge", "id": "e1"}])

    assert result.ok
    assert "e1" not in result.doc.edges


def test_unknown_target_rejects_whole_batch_and_leaves_doc_untouched():
    doc = CanvasDoc(elements={"a": Element(id="a", render="c1")})

    result = apply_batch(doc, [
        {"op": "update_element", "id": "a", "label": "renamed"},
        {"op": "delete_element", "id": "missing"},
    ])

    assert not result.ok
    assert result.errors[0].code == "unknown_target"
    assert result.errors[0].op_index == 1
    assert doc.elements["a"].label == ""


def test_unknown_op_is_reported_by_index():
    doc = CanvasDoc()

    result = apply_batch(doc, [{"op": "levitate"}])

    assert not result.ok
    assert result.errors == [OpError(0, "unknown_op", "unknown op 'levitate'")]


def test_too_many_ops_rejects_the_batch():
    doc = CanvasDoc()
    ops = [{"op": "add_note", "label": str(i)} for i in range(MAX_OPS_PER_BATCH + 1)]

    result = apply_batch(doc, ops)

    assert not result.ok
    assert result.errors[0].code == "too_many_ops"


def test_mass_delete_guard_rejects_over_the_threshold():
    doc = CanvasDoc(elements={
        f"e{i}": Element(id=f"e{i}", render="c1") for i in range(MASS_DELETE_GUARD + 1)
    })
    ops = [{"op": "delete_element", "id": f"e{i}"} for i in range(MASS_DELETE_GUARD + 1)]

    result = apply_batch(doc, ops)

    assert not result.ok
    assert result.errors[0].code == "mass_delete_guard"


def test_explanation_too_long_rejects_the_batch():
    doc = CanvasDoc()

    result = apply_batch(doc, [], explanation="x" * (MAX_EXPLANATION_CHARS + 1))

    assert not result.ok
    assert result.errors[0].code == "explanation_too_long"


def test_rejected_batch_leaves_the_saved_file_byte_identical(tmp_path):
    core, diagrams = tmp_path / "canvas-core.json", tmp_path / "diagrams"
    doc = CanvasDoc(elements={"a": Element(id="a", render="c1", label="keep")})
    doc.save(core, diagrams)
    before = core.read_bytes()

    result = apply_batch(doc, [{"op": "delete_element", "id": "missing"}])

    assert not result.ok
    assert core.read_bytes() == before


def test_a_non_dict_op_is_rejected_cleanly_instead_of_crashing():
    doc = CanvasDoc()

    result = apply_batch(doc, ["boom"])

    assert not result.ok
    assert result.errors[0].code == "invalid_op"


def test_a_malformed_position_is_rejected_cleanly_instead_of_crashing():
    doc = CanvasDoc()

    result = apply_batch(
        doc, [{"op": "add_element", "render": "note", "position": "top-left"}]
    )

    assert not result.ok
    assert result.errors[0].code == "invalid_field"


def test_an_unknown_render_kind_is_rejected():
    doc = CanvasDoc()

    result = apply_batch(doc, [{"op": "add_element", "render": "spreadsheet"}])

    assert not result.ok
    assert result.errors[0].code == "invalid_field"


@pytest.mark.parametrize(
    "op,label",
    [("add_note", "step 1"), ("add_group", "Persistence")],
    ids=["note", "group"],
)
def test_a_note_or_group_with_a_node_id_is_rejected(op, label):
    doc = CanvasDoc()

    result = apply_batch(doc, [{"op": op, "label": label, "node_id": "component::a.py"}])

    assert not result.ok
    assert result.errors[0].code == "invalid_field"


def test_a_custom_element_with_a_node_id_is_accepted():
    doc = CanvasDoc()

    result = apply_batch(
        doc, [{"op": "add_element", "render": "custom", "node_id": "component::a.py"}]
    )

    assert result.ok


def test_update_element_cannot_attach_a_node_id_to_an_existing_note():
    doc = CanvasDoc()
    added = apply_batch(doc, [{"op": "add_note", "temp_id": "t1", "label": "step 1"}])

    result = apply_batch(
        added.doc,
        [{"op": "update_element", "id": added.id_map["t1"], "node_id": "component::a.py"}],
    )

    assert not result.ok
    assert result.errors[0].code == "invalid_field"


def test_mass_delete_guard_counts_cascaded_edge_deletions_too():
    doc = CanvasDoc(
        elements={"hub": Element(id="hub", render="c1"),
                  **{f"e{i}": Element(id=f"e{i}", render="c1") for i in range(MASS_DELETE_GUARD)}},
        edges={f"edge{i}": Edge(id=f"edge{i}", **{"from": "hub"}, to=f"e{i}")
               for i in range(MASS_DELETE_GUARD)},
    )

    result = apply_batch(doc, [{"op": "delete_element", "id": "hub"}])

    assert not result.ok
    assert result.errors[0].code == "mass_delete_guard"


def test_confirm_mass_delete_bypasses_the_guard():
    doc = CanvasDoc(elements={
        f"e{i}": Element(id=f"e{i}", render="c1") for i in range(MASS_DELETE_GUARD + 1)
    })
    ops = [{"op": "delete_element", "id": f"e{i}"} for i in range(MASS_DELETE_GUARD + 1)]

    result = apply_batch(doc, ops, confirm_mass_delete=True)

    assert result.ok
    assert result.doc.elements == {}


def test_update_element_merges_meta_instead_of_replacing_it():
    doc = CanvasDoc(
        elements={"a": Element(id="a", render="c1", meta={"recipe_key": "k1"})}
    )

    result = apply_batch(doc, [{"op": "update_element", "id": "a", "meta": {"color": "blue"}}])

    assert result.ok
    assert result.doc.elements["a"].meta == {"recipe_key": "k1", "color": "blue"}


def test_update_element_cannot_change_created_by():
    doc = CanvasDoc(elements={"a": Element(id="a", render="c1", created_by="user")})

    result = apply_batch(doc, [{"op": "update_element", "id": "a", "created_by": "ai"}])

    assert result.ok
    assert result.doc.elements["a"].created_by == "user"


def test_deleting_a_group_clears_its_members_group_id():
    doc = CanvasDoc(elements={
        "g1": Element(id="g1", render="group"),
        "m1": Element(id="m1", render="c1", group_id="g1"),
    })

    result = apply_batch(doc, [{"op": "delete_element", "id": "g1"}])

    assert result.ok
    assert result.doc.elements["m1"].group_id is None


def test_chunked_batch_under_the_cap_behaves_like_a_plain_apply_batch():
    doc = CanvasDoc()

    result = apply_batch_chunked(doc, [{"op": "add_note", "temp_id": "t1", "label": "hi"}])

    assert result.ok
    assert result.doc.elements[result.id_map["t1"]].label == "hi"


def test_chunked_batch_over_the_cap_adds_every_element_across_chunks():
    doc = CanvasDoc()
    ops = [
        {"op": "add_element", "temp_id": f"n{i}", "render": "c1", "label": str(i)}
        for i in range(MAX_OPS_PER_BATCH + 5)
    ]

    result = apply_batch_chunked(doc, ops)

    assert result.ok
    assert len(result.doc.elements) == MAX_OPS_PER_BATCH + 5


def test_chunked_batch_rewrites_a_cross_chunk_temp_id_ref():
    doc = CanvasDoc()
    filler = [
        {"op": "add_element", "temp_id": f"n{i}", "render": "c1", "label": str(i)}
        for i in range(MAX_OPS_PER_BATCH - 1)
    ]
    ops = [
        *filler,
        {"op": "add_element", "temp_id": "a", "render": "c1", "label": "A"},
        {"op": "add_element", "temp_id": "b", "render": "c1", "label": "B"},
        {"op": "add_edge", "temp_id": "e", "from": "a", "to": "b", "label": "calls"},
    ]

    result = apply_batch_chunked(doc, ops)

    assert result.ok
    edge = result.doc.edges[result.id_map["e"]]
    assert edge.from_ == result.id_map["a"]
    assert edge.to == result.id_map["b"]


def test_chunked_batch_mass_delete_guard_counts_across_chunks():
    doc = CanvasDoc(elements={
        f"e{i}": Element(id=f"e{i}", render="c1") for i in range(MAX_OPS_PER_BATCH + 5)
    })
    ops = ([{"op": "delete_element", "id": f"e{i}"} for i in range(MASS_DELETE_GUARD + 1)]
           + [{"op": "add_note", "label": str(i)} for i in range(MAX_OPS_PER_BATCH)])

    result = apply_batch_chunked(doc, ops)

    assert not result.ok
    assert result.errors[0].code == "mass_delete_guard"


def test_chunked_batch_confirm_mass_delete_bypasses_the_guard_across_chunks():
    doc = CanvasDoc(elements={
        f"e{i}": Element(id=f"e{i}", render="c1") for i in range(MAX_OPS_PER_BATCH + 5)
    })
    ops = [{"op": "delete_element", "id": f"e{i}"} for i in range(MAX_OPS_PER_BATCH + 5)]

    result = apply_batch_chunked(doc, ops, confirm_mass_delete=True)

    assert result.ok
    assert result.doc.elements == {}


def test_chunked_batch_failure_leaves_the_original_doc_untouched():
    doc = CanvasDoc()
    ops = [
        *[{"op": "add_element", "temp_id": f"n{i}", "render": "c1", "label": str(i)}
          for i in range(MAX_OPS_PER_BATCH)],
        {"op": "update_element", "id": "does-not-exist", "label": "boom"},
    ]

    result = apply_batch_chunked(doc, ops)

    assert not result.ok
    assert doc.elements == {}
