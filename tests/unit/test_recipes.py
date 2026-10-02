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


def test_render_for_maps_any_custom_type_to_custom():
    assert render_for("custom/my-type") == "custom"


def test_render_for_maps_any_feature_plan_slug_to_custom():
    assert render_for("feature-plan/token-auth") == "custom"


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


def test_recipe_for_maps_any_custom_type_to_the_shared_recipe():
    recipe = recipe_for("custom/my-type")

    resolved = {"nodes": [{"id": "n1", "name": "Box"}], "relations": []}
    assert recipe.layer == "custom/my-type"
    assert recipe.to_ops(resolved).nodes[0].render == "custom"


def test_recipe_for_rejects_a_bare_custom_prefix():
    with pytest.raises(KeyError):
        recipe_for("custom/")


def test_recipe_for_maps_any_feature_plan_slug_to_the_shared_recipe():
    recipe = recipe_for("feature-plan/token-auth")

    resolved = {"nodes": [{"id": "n1", "name": "Box"}], "relations": []}
    assert recipe.layer == "feature-plan/token-auth"
    assert recipe.to_ops(resolved).nodes[0].render == "custom"


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
