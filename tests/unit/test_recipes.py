"""The one reshape()+graph_to_ops: a re-run keeps user edits, drops stale AI, keeps position."""

from __future__ import annotations

import pytest

from codechroma.canvas.apply_batch import apply_batch
from codechroma.canvas.document import CanvasDoc, Edge, Element, Position
from codechroma.canvas.recipes import (
    RecipeEdge,
    RecipeNode,
    RecipeResult,
    build_batch_ops,
    graph_to_ops,
    recipe_for,
    render_for,
    reshape,
    run_recipe,
)


def _to_ops(resolved: dict, render: str) -> RecipeResult:
    return graph_to_ops(reshape(resolved, render))


def test_render_for_maps_every_diagrams_kind():
    assert render_for("c1") == "c1"
    assert render_for("patterns") == "pattern"
    assert render_for("impact") == "impact"
    assert render_for("epics") == "epic"
    assert render_for("sequence") == "sequence"


def test_render_for_maps_any_custom_type_to_custom():
    assert render_for("custom/my-type") == "custom"


def test_render_for_maps_any_feature_plan_slug_to_custom():
    assert render_for("feature-plan/token-auth") == "custom"


def test_render_for_maps_any_epic_id_to_epic():
    assert render_for("epics/EP-4") == "epic"
    assert render_for("epics/EP-4-01") == "epic"


def test_recipe_for_rejects_a_bare_epics_prefix():
    with pytest.raises(KeyError):
        recipe_for("epics/")


def test_reshape_flattens_nodes_and_resolves_edges_by_id():
    resolved = {
        "nodes": [{"id": "auth", "name": "Auth"}, {"id": "cli", "name": "CLI"}],
        "relations": [{"from": "auth", "to": "cli", "label": "used by", "kind": "uses"}],
    }

    result = _to_ops(resolved, "c1")

    assert {node.key for node in result.nodes} == {"auth", "cli"}
    assert result.edges == [RecipeEdge("auth", "cli", "used by", "uses")]


def test_reshape_drops_a_relation_naming_no_real_node():
    resolved = {
        "nodes": [{"id": "auth", "name": "Auth"}],
        "relations": [{"from": "auth", "to": "ghost"}],
    }

    result = _to_ops(resolved, "c1")

    assert result.edges == []
    assert result.dropped[0]["reason"] == "dangling_endpoint"


def test_reshape_carries_node_id_group_and_style():
    resolved = {
        "nodes": [{
            "id": "n1", "name": "Box", "node_id": "component::src", "group": "Persistence",
            "style": {"border-color": "#333"},
        }],
    }

    result = _to_ops(resolved, "custom")

    node = result.nodes[0]
    assert node.node_id == "component::src"
    assert node.group == "Persistence"
    assert node.style == {"border-color": "#333"}


def test_reshape_folds_kind_icon_and_parent_into_meta():
    resolved = {"nodes": [{
        "id": "n1", "name": "Box", "kind": "database", "icon": "postgresql", "parent": "p1",
    }]}

    result = _to_ops(resolved, "c1")

    assert result.nodes[0].meta["kind"] == "database"
    assert result.nodes[0].meta["icon"] == "postgresql"
    assert result.nodes[0].meta["parent"] == "p1"


def test_reshape_folds_seed_into_meta_for_impact():
    resolved = {"nodes": [{"id": "n1", "name": "Box", "seed": False}]}

    result = _to_ops(resolved, "impact")

    assert result.nodes[0].meta["seed"] is False


def test_reshape_preserves_the_authored_meta_bag():
    resolved = {"nodes": [{"id": "n1", "name": "Box", "meta": {"status": "modified", "junk": 1}}]}

    result = _to_ops(resolved, "impact")

    assert result.nodes[0].meta["status"] == "modified"
    assert result.nodes[0].meta["junk"] == 1


def test_reshape_falls_back_to_title_then_id_for_the_epics_index():
    resolved = {"items": [{"id": "LMP-1", "title": "Login", "status": "open", "group": "Auth"}]}

    result = _to_ops(resolved, "epic")

    assert result.nodes[0].label == "Login"
    assert result.nodes[0].group == "Auth"
    assert result.edges == []


def test_reshape_per_node_render_override_mixes_epic_and_spec_boxes():
    """The epics brief: one node's `render` can force `spec` while the kind-level falls back to
    `epic`, so one epics.json draws the epic box and its user-story/spec boxes differently."""
    resolved = {
        "nodes": [
            {"id": "EP-3", "name": "EP-3", "render": "epic", "group": "settings"},
            {"id": "EP-3::logging", "name": "US1", "render": "spec", "group": "EP-3"},
            {"id": "EP-3::config", "name": "US2", "group": "EP-3"},  # no override -> kind default
        ]
    }

    result = _to_ops(resolved, "epic")

    assert [node.render for node in result.nodes] == ["epic", "spec", "epic"]
    assert [node.key for node in result.nodes] == ["EP-3", "EP-3::logging", "EP-3::config"]


def test_reshape_relationship_kind_reaches_the_edge():
    resolved = {
        "nodes": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        "relations": [{"from": "a", "to": "b", "kind": "writes to"}],
    }

    result = _to_ops(resolved, "custom")

    assert result.edges == [RecipeEdge("a", "b", "", "writes to")]


def test_reshape_edge_style_reaches_the_recipe_edge():
    resolved = {
        "nodes": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        "relations": [{"from": "a", "to": "b", "style": {"color": "blue"}}],
    }

    result = _to_ops(resolved, "pattern")

    assert result.edges[0].style == {"color": "blue"}


def test_reshape_relation_transport_reaches_the_recipe_edge():
    resolved = {
        "nodes": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        "relations": [{"from": "a", "to": "b", "transport": "https"}],
    }

    result = _to_ops(resolved, "custom")

    assert result.edges[0].transport == "https"


def test_relation_without_transport_leaves_the_edge_transport_unset():
    resolved = {
        "nodes": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        "relations": [{"from": "a", "to": "b", "label": "calls"}],
    }

    result = _to_ops(resolved, "custom")

    assert result.edges[0].transport is None


def test_sequence_reshape_turns_relations_into_message_elements():
    """A sequence diagram's relations are dedicated elements, not edges."""
    resolved = {
        "nodes": [
            {"id": "p1", "name": "Client"},
            {"id": "p2", "name": "API"},
        ],
        "relations": [
            {"id": "m1", "from": "p1", "to": "p2", "label": "GET /x", "order": "1"},
            {"id": "m2", "from": "p2", "to": "p1", "label": "200", "order": "2", "return": True},
        ],
    }

    result = _to_ops(resolved, "sequence")

    # Participants become participant elements; messages become message elements -- no edges.
    roles = [node.meta["role"] for node in result.nodes]
    assert roles == ["participant", "participant", "message", "message"]
    assert result.edges == []
    msg1 = result.nodes[2]
    assert msg1.render == "sequence"
    assert msg1.meta["from"] == "p1"
    assert msg1.meta["to"] == "p2"
    assert msg1.meta["order"] == "1"
    assert msg1.meta["return"] is False
    assert result.nodes[3].meta["return"] is True


def test_sequence_reshape_drops_a_message_naming_no_participant():
    resolved = {
        "nodes": [{"id": "p1", "name": "Only"}],
        "relations": [{"id": "m1", "from": "p1", "to": "ghost", "label": "call", "order": "1"}],
    }

    result = _to_ops(resolved, "sequence")

    # graph_to_ops drops a relation whose endpoint matches no node -- just like every other type.
    assert [n.key for n in result.nodes] == ["p1"]
    assert result.edges == []


def test_recipe_for_rejects_a_bare_custom_prefix():
    with pytest.raises(KeyError):
        recipe_for("custom/")


@pytest.mark.parametrize(
    "layer,render",
    [
        ("epics/EP-4", "epic"),
        ("custom/my-type", "custom"),
        ("sequence", "sequence"),
        ("feature-plan/token-auth", "custom"),
    ],
)
def test_recipe_for_maps_to_the_shared_recipe(layer, render):
    recipe = recipe_for(layer)

    resolved = {"nodes": [{"id": "n1", "name": "Box"}], "relations": []}
    assert recipe.layer == layer
    assert recipe.to_ops(resolved).nodes[0].render == render


def test_recipe_for_rejects_a_bare_feature_plan_prefix():
    with pytest.raises(KeyError):
        recipe_for("feature-plan/")


def test_build_batch_ops_adds_new_ai_elements_on_first_run():
    doc = CanvasDoc()
    result = RecipeResult(nodes=[RecipeNode(key="n1", render="impact", label="Auth")])

    ops = build_batch_ops(doc, "impact", result)

    assert ops == [{
        "op": "add_element", "temp_id": "n0", "render": "impact", "layer": "impact",
        "label": "Auth", "description": "", "node_id": None, "group_id": None,
        "meta": {"recipe_key": "n1"}, "created_by": "ai",
    }]


def test_build_batch_ops_groups_stories_into_their_epic_and_epics_into_the_domain():
    """010-epics-tree-render: a story's `group` is its parent epic's id, an epic's `group` is its
    domain -- so build_batch_ops must mint one group element per distinct group
    string and point each node at it, producing the nested frames (domain -> epic
    -> stories) the canvas renders."""
    result = RecipeResult(nodes=[
        RecipeNode(key="EP-3", render="epic", label="EP-3", group="settings"),
        RecipeNode(key="EP-3-01", render="epic", label="s1", group="EP-3"),
        RecipeNode(key="EP-3-02", render="epic", label="s2", group="EP-3"),
    ])

    ops = build_batch_ops(CanvasDoc(), "epics", result)

    group_ops = [op for op in ops if op["op"] == "add_group"]
    assert [op["label"] for op in group_ops] == ["EP-3", "settings"]
    # Groups resolve in sorted order ('EP-3' < 'settings'), so EP-3's group element is temp 'g0' and
    # settings' is 'g1'.
    by_label = {op["label"]: op["temp_id"] for op in group_ops}
    node_by_key = {op["meta"]["recipe_key"]: op for op in ops if op["op"] == "add_element"}
    assert node_by_key["EP-3"]["group_id"] == by_label["settings"]
    assert node_by_key["EP-3-01"]["group_id"] == by_label["EP-3"]
    assert node_by_key["EP-3-02"]["group_id"] == by_label["EP-3"]


def test_build_batch_ops_updates_a_kept_element_without_touching_its_position():
    doc = CanvasDoc(elements={"e1": Element(
        id="e1", render="impact", layer="impact", label="Auth", position=Position(x=50, y=60),
        meta={"recipe_key": "n1"}, created_by="ai",
    )})
    result = RecipeResult(nodes=[RecipeNode(key="n1", render="impact", label="Auth v2")])

    ops = build_batch_ops(doc, "impact", result)

    assert ops == [{
        "op": "update_element", "id": "e1", "label": "Auth v2", "description": "",
        "node_id": None, "group_id": None, "meta": {"recipe_key": "n1"},
    }]
    assert "position" not in ops[0]


def test_build_batch_ops_deletes_a_stale_ai_element():
    doc = CanvasDoc(elements={"e1": Element(
        id="e1", render="impact", layer="impact", label="Gone", meta={"recipe_key": "n1"},
        created_by="ai",
    )})

    ops = build_batch_ops(doc, "impact", RecipeResult())

    assert ops == [{"op": "delete_element", "id": "e1"}]


def test_build_batch_ops_never_touches_a_user_owned_element():
    doc = CanvasDoc(elements={"e1": Element(
        id="e1", render="impact", layer="impact", label="Mine", meta={"recipe_key": "n1"},
        created_by="user",
    )})

    ops = build_batch_ops(doc, "impact", RecipeResult())

    assert ops == []


def test_build_batch_ops_never_double_deletes_an_edge_off_a_dropped_element():
    element_a = Element(
        id="a", render="impact", layer="impact", meta={"recipe_key": "n1"}, created_by="ai",
    )
    element_b = Element(
        id="b", render="impact", layer="impact", meta={"recipe_key": "n2"}, created_by="ai",
    )
    doc = CanvasDoc(
        elements={"a": element_a, "b": element_b},
        edges={"e1": Edge(id="e1", **{"from": "a"}, to="b", label="old", layer="impact")},
    )

    ops = build_batch_ops(doc, "impact", RecipeResult())

    assert ops == [{"op": "delete_element", "id": "a"}, {"op": "delete_element", "id": "b"}]
    assert apply_batch(doc, ops, layer="impact").ok


def test_build_batch_ops_reconciles_an_edge_between_two_kept_elements():
    element_a = Element(
        id="a", render="impact", layer="impact", meta={"recipe_key": "n1"}, created_by="ai",
    )
    element_b = Element(
        id="b", render="impact", layer="impact", meta={"recipe_key": "n2"}, created_by="ai",
    )
    doc = CanvasDoc(
        elements={"a": element_a, "b": element_b},
        edges={"e1": Edge(id="e1", **{"from": "a"}, to="b", label="old", layer="impact")},
    )
    result = RecipeResult(
        nodes=[
            RecipeNode(key="n1", render="impact", label=""),
            RecipeNode(key="n2", render="impact", label=""),
        ],
        edges=[RecipeEdge("n1", "n2", "new")],
    )

    ops = build_batch_ops(doc, "impact", result)

    edge_ops = [op for op in ops if op["op"] in ("update_edge", "add_edge", "delete_edge")]
    assert edge_ops == [
        {"op": "update_edge", "id": "e1", "label": "new", "kind": "uses", "hero": False}
    ]


def test_build_batch_ops_reconciles_an_edges_style():
    element_a = Element(
        id="a", render="impact", layer="impact", meta={"recipe_key": "n1"}, created_by="ai",
    )
    element_b = Element(
        id="b", render="impact", layer="impact", meta={"recipe_key": "n2"}, created_by="ai",
    )
    doc = CanvasDoc(
        elements={"a": element_a, "b": element_b},
        edges={"e1": Edge(id="e1", **{"from": "a"}, to="b", layer="impact")},
    )
    result = RecipeResult(
        nodes=[
            RecipeNode(key="n1", render="impact", label=""),
            RecipeNode(key="n2", render="impact", label=""),
        ],
        edges=[RecipeEdge("n1", "n2", style={"color": "red"})],
    )

    ops = build_batch_ops(doc, "impact", result)

    edge_op = next(op for op in ops if op["op"] == "update_edge")
    assert edge_op["style"] == {"color": "red"}


def test_build_batch_ops_does_not_reemit_an_edge_whose_optional_field_went_absent():
    # A doc edge carrying a stale origin, re-run with no origin, must converge -- a field that is
    # now None is never shipped, so it must not flip `changed` and re-emit `update_edge` forever.
    element_a = Element(
        id="a", render="impact", layer="impact", meta={"recipe_key": "n1"}, created_by="ai",
    )
    element_b = Element(
        id="b", render="impact", layer="impact", meta={"recipe_key": "n2"}, created_by="ai",
    )
    doc = CanvasDoc(
        elements={"a": element_a, "b": element_b},
        edges={
            "e1": Edge(
                id="e1", **{"from": "a"}, to="b", label="", origin="src/a.py:1",
                layer="impact",
            ),
        },
    )
    result = RecipeResult(
        nodes=[
            RecipeNode(key="n1", render="impact", label=""),
            RecipeNode(key="n2", render="impact", label=""),
        ],
        edges=[RecipeEdge("n1", "n2")],
    )

    ops = build_batch_ops(doc, "impact", result)

    assert [op for op in ops if op["op"] == "update_edge"] == []


def test_run_recipe_round_trips_through_apply_batch():
    doc = CanvasDoc()
    resolved = {"items": [{"id": "LMP-1", "title": "Login"}]}

    ops = run_recipe(doc, "epics", resolved)
    result = apply_batch(doc, ops, layer="epics")

    assert result.ok
    assert list(result.doc.elements.values())[0].label == "Login"


def test_flat_to_ops_reports_a_relation_no_box_claims():
    resolved = {
        "nodes": [{"id": "n1", "name": "Auth"}],
        "relations": [{"from": "n1", "to": "gone"}],
    }

    result = _to_ops(resolved, "impact")

    assert result.edges == []
    assert result.dropped[0]["reason"] == "dangling_endpoint"


def test_a_fully_drawable_diagram_reports_nothing_dropped():
    resolved = {
        "nodes": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        "relations": [{"from": "a", "to": "b"}],
    }

    result = _to_ops(resolved, "custom")

    assert result.dropped == []


def test_build_batch_ops_omits_style_key_when_recipe_node_style_is_none():
    doc = CanvasDoc()
    result = RecipeResult(nodes=[RecipeNode(key="n1", render="impact", label="Auth")])

    ops = build_batch_ops(doc, "impact", result)

    assert "style" not in ops[0]


def test_build_batch_ops_never_re_emits_style_on_an_unrelated_regenerate():
    doc = CanvasDoc(elements={"e1": Element(
        id="e1", render="impact", layer="impact", label="Auth",
        meta={"recipe_key": "n1"}, created_by="ai", style={"color": "#f00"},
    )})
    result = RecipeResult(nodes=[RecipeNode(key="n1", render="impact", label="Auth v2")])

    ops = build_batch_ops(doc, "impact", result)

    assert "style" not in ops[0]


def test_build_batch_ops_includes_style_key_when_recipe_node_style_is_set():
    doc = CanvasDoc()
    result = RecipeResult(nodes=[
        RecipeNode(key="n1", render="impact", label="Auth", style={"color": "#f00"})
    ])

    ops = build_batch_ops(doc, "impact", result)

    assert ops[0]["style"] == {"color": "#f00"}
