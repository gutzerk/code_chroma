"""Unit coverage per CheckConfig field: a type using it fails/passes correctly from JSON alone."""

from codechroma.bridge.inspect import InspectContext, inspect
from codechroma.diagrams.registry import CheckConfig


def _flat_diagram(nodes, relations=None):
    return {"type": "custom", "nodes": nodes, "relations": relations or []}


def _hierarchical_diagram(nodes, relations=None):
    return {"type": "c1", "nodes": nodes, "relations": relations or []}


# --- shape: dispatch ---


def test_hierarchical_shape_dispatches_to_the_tree_walk_inspector():
    diagram = _hierarchical_diagram([{"id": "system", "name": "Sys"}])

    report = inspect(diagram, CheckConfig(shape="hierarchical"))

    assert report.node_count == 1


def test_flat_shape_dispatches_to_the_flat_inspector():
    diagram = _flat_diagram([{"id": "a", "name": "A"}])

    report = inspect(diagram, CheckConfig(shape="flat"))

    assert report.node_count == 1


# --- budgets ---


def test_budgets_crowded_fires_over_max_nodes():
    diagram = _flat_diagram([{"id": f"n{i}", "name": f"N{i}"} for i in range(3)])

    report = inspect(diagram, CheckConfig(shape="flat", budgets={"max_nodes": 2}))

    assert any(line.startswith("CROWDED") for line in report.shape)


def test_budgets_edgebomb_fires_over_max_relations():
    nodes = [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}]
    relations = [{"from": "a", "to": "b", "label": "x"}, {"from": "b", "to": "a", "label": "y"}]
    diagram = _flat_diagram(nodes, relations)

    report = inspect(diagram, CheckConfig(shape="flat", budgets={"max_relations": 1}))

    assert any(line.startswith("EDGEBOMB") for line in report.shape)


# --- min_depth ---


def test_min_depth_flags_a_block_below_the_authored_cap():
    nodes = [{"id": "system", "name": "Sys"}]
    parent = "system"
    for depth in range(3):
        child_id = f"child{depth}"
        nodes.append({"id": child_id, "name": child_id, "parent": parent})
        parent = child_id
    diagram = _hierarchical_diagram(nodes)

    report = inspect(diagram, CheckConfig(shape="hierarchical", min_depth=1))

    assert any(line.startswith("DEPTH") for line in report.advisories)


# --- unlabeled ---


def test_unlabeled_shape_pushes_it_to_the_blocking_shape_tier():
    diagram = _hierarchical_diagram(
        [{"id": "system", "name": "Sys"}, {"id": "a", "name": "A", "kind": "external_system"}],
        relations=[{"from": "a", "to": "system"}],
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical", unlabeled="shape"))

    assert any(line.startswith("UNLABELED") for line in report.shape)


def test_unlabeled_advisory_keeps_it_out_of_the_shape_tier():
    diagram = _flat_diagram(
        [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        relations=[{"from": "a", "to": "b"}],
    )

    report = inspect(diagram, CheckConfig(shape="flat", unlabeled="advisory"))

    assert not any(line.startswith("UNLABELED") for line in report.shape)
    assert any(line.startswith("UNLABELED") for line in report.advisories)


# --- coverage_source ---


def test_coverage_source_advisory_fires_under_the_covered_threshold():
    diagram = _hierarchical_diagram([{"id": "system", "name": "Sys"}])
    context = InspectContext(coverage={"total_files": 10, "percent": 10})

    report = inspect(
        diagram, CheckConfig(shape="hierarchical", coverage_source="coverage"), context
    )

    assert any(line.startswith("COVERAGE") for line in report.advisories)


def test_coverage_source_unset_skips_the_check_even_with_data_present():
    diagram = _hierarchical_diagram([{"id": "system", "name": "Sys"}])
    context = InspectContext(coverage={"total_files": 10, "percent": 10})

    report = inspect(diagram, CheckConfig(shape="hierarchical", coverage_source=None), context)

    assert not any(line.startswith("COVERAGE") for line in report.advisories)


# --- check_bare_actors ---


def test_check_bare_actors_default_fires_for_a_childless_external_system():
    diagram = _hierarchical_diagram(
        [{"id": "system", "name": "Sys"}, {"id": "a", "name": "A", "kind": "external_system"}]
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical"))

    assert any(line.startswith("BARE") for line in report.shape)


def test_check_bare_actors_false_skips_the_check_c1s_own_setting_since_042():
    diagram = _hierarchical_diagram(
        [{"id": "system", "name": "Sys"}, {"id": "a", "name": "A", "kind": "external_system"}]
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical", check_bare_actors=False))

    assert not any(line.startswith("BARE") for line in report.shape)


# --- density_source ---


def test_density_source_sparse_fires_for_a_thin_diagram():
    diagram = _flat_diagram([{"id": "a", "name": "A"}])
    context = InspectContext(generation_data={"classes": [{"id": f"c{i}"} for i in range(20)]})

    report = inspect(
        diagram, CheckConfig(shape="flat", density_source="patterns"), context
    )

    assert any(line.startswith("SPARSE") for line in report.shape)


def test_density_source_unset_skips_sparse_even_with_context_present():
    diagram = _flat_diagram([{"id": "a", "name": "A"}])
    context = InspectContext(generation_data={"classes": [{"id": f"c{i}"} for i in range(20)]})

    report = inspect(diagram, CheckConfig(shape="flat", density_source=None), context)

    assert not any(line.startswith("SPARSE") for line in report.shape)


# --- required_meta ---


def test_required_meta_unreviewed_fires_when_the_field_is_missing():
    diagram = _flat_diagram(
        [{"id": "inst", "name": "Inst", "kind": "pattern-instance", "meta": {"confirmed": None}}]
    )

    report = inspect(diagram, CheckConfig(shape="flat", required_meta=["confirmed"]))

    assert any(line.startswith("UNREVIEWED") for line in report.shape)


def test_required_meta_satisfied_does_not_fire():
    diagram = _flat_diagram(
        [{"id": "inst", "name": "Inst", "kind": "pattern-instance", "meta": {"confirmed": True}}]
    )

    report = inspect(diagram, CheckConfig(shape="flat", required_meta=["confirmed"]))

    assert not any(line.startswith("UNREVIEWED") for line in report.shape)


# --- membership_source.ancestor_prefixes ---


def test_membership_source_broken_for_a_node_outside_the_slice():
    diagram = _flat_diagram([{"id": "component::x", "name": "X", "node_id": "component::x"}])
    context = InspectContext(slice_ids={"component::y"})

    report = inspect(
        diagram,
        CheckConfig(shape="flat", membership_source={"ancestor_prefixes": ["dir::"]}),
        context,
    )

    assert any("BROKEN" in line and "component::x" in line for line in report.broken)


def test_membership_source_ancestor_prefix_skips_slice_membership():
    diagram = _flat_diagram([{"id": "dir::x", "name": "X", "node_id": "dir::x"}])
    context = InspectContext(slice_ids={"component::y"}, exists_probe=lambda _id: True)

    report = inspect(
        diagram,
        CheckConfig(shape="flat", membership_source={"ancestor_prefixes": ["dir::"]}),
        context,
    )

    assert not any("dir::x" in line for line in report.broken)


def test_membership_source_ancestor_prefix_still_checks_existence():
    diagram = _flat_diagram([{"id": "dir::x", "name": "X", "node_id": "dir::x"}])
    context = InspectContext(slice_ids={"component::y"}, exists_probe=lambda _id: False)

    report = inspect(
        diagram,
        CheckConfig(shape="flat", membership_source={"ancestor_prefixes": ["dir::"]}),
        context,
    )

    assert any("dir::x" in line for line in report.broken)


# --- allow_self ---


def test_allow_self_false_blocks_a_self_relation():
    diagram = _flat_diagram([{"id": "a", "name": "A"}], relations=[{"from": "a", "to": "a"}])

    report = inspect(diagram, CheckConfig(shape="flat", allow_self=False))

    assert any(line.startswith("SELF") for line in report.broken)


def test_allow_self_true_permits_a_self_relation():
    diagram = _flat_diagram([{"id": "a", "name": "A"}], relations=[{"from": "a", "to": "a"}])

    report = inspect(diagram, CheckConfig(shape="flat", allow_self=True))

    assert not any(line.startswith("SELF") for line in report.broken)


# --- check_islands ---


def test_check_islands_hint_set_flags_a_second_component():
    nodes = [{"id": n, "name": n} for n in ("a", "b", "c", "d")]
    relations = [{"from": "a", "to": "b", "label": "x"}, {"from": "c", "to": "d", "label": "y"}]
    diagram = _flat_diagram(nodes, relations)

    report = inspect(
        diagram, CheckConfig(shape="flat", check_islands={"hint": "wire it in"})
    )

    assert any(line.startswith("ISLAND") and "wire it in" in line for line in report.shape)


def test_check_islands_unset_skips_the_check():
    nodes = [{"id": n, "name": n} for n in ("a", "b", "c", "d")]
    relations = [{"from": "a", "to": "b", "label": "x"}, {"from": "c", "to": "d", "label": "y"}]
    diagram = _flat_diagram(nodes, relations)

    report = inspect(diagram, CheckConfig(shape="flat", check_islands=None))

    assert not any(line.startswith("ISLAND") for line in report.shape)


# --- check_islands: c1's own root-anchored variant ---


def test_c1_two_actors_wired_only_to_each_other_are_an_island_not_orphans():
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
            {"id": "b", "name": "B", "kind": "external_system"},
        ],
        relations=[{"from": "a", "to": "b", "label": "calls"}],
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical", check_islands={"hint": "wire it"}))

    islands = [line for line in report.shape if line.startswith("ISLAND")]
    assert any("'a', 'b'" in line and "wire it" in line for line in islands)
    assert not any(line.startswith("ORPHAN") for line in report.shape)


def test_c1_lone_disconnected_actor_stays_orphan_not_island():
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
        ]
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical", check_islands={"hint": "wire it"}))

    assert any(line.startswith("ORPHAN 'a'") for line in report.shape)
    assert not any(line.startswith("ISLAND") for line in report.shape)


# --- articulation points (bridge/hub advisories) ---


def test_a_bridge_node_is_reported_as_an_articulation_advisory():
    diagram = _flat_diagram(
        [{"id": f"n{i}", "name": f"N{i}"} for i in range(3)],
        relations=[
            {"from": "n0", "to": "n1", "label": "a"},
            {"from": "n1", "to": "n2", "label": "b"},
        ],
    )

    report = inspect(diagram, CheckConfig(shape="flat"))

    assert any("'n1' is a bridge" in line for line in report.advisories)


def test_a_two_node_edge_has_no_bridge():
    diagram = _flat_diagram(
        [{"id": f"n{i}", "name": f"N{i}"} for i in range(2)],
        relations=[{"from": "n0", "to": "n1", "label": "a"}],
    )

    report = inspect(diagram, CheckConfig(shape="flat"))

    assert not any(line.startswith("ARTICULATION") for line in report.advisories)


def test_a_node_inside_a_cycle_is_never_a_bridge():
    diagram = _flat_diagram(
        [{"id": f"n{i}", "name": f"N{i}"} for i in range(3)],
        relations=[
            {"from": "n0", "to": "n1", "label": "a"},
            {"from": "n1", "to": "n2", "label": "b"},
            {"from": "n2", "to": "n0", "label": "c"},
        ],
    )

    report = inspect(diagram, CheckConfig(shape="flat"))

    assert not any(line.startswith("ARTICULATION") for line in report.advisories)


def test_a_complete_k5_every_node_is_a_hub_but_never_a_bridge():
    nodes = [{"id": f"n{i}", "name": f"N{i}"} for i in range(5)]
    relations = [{"from": f"n{i}", "to": f"n{j}", "label": "a"}
                 for i in range(5) for j in range(i + 1, 5)]

    report = inspect(_flat_diagram(nodes, relations), CheckConfig(shape="flat"))

    assert any("'n0' is a hub" in line for line in report.advisories)
    assert not any("is a bridge" in line for line in report.advisories)


def test_c1_nested_leaves_count_as_connected_via_containment():
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
            {"id": "leaf1", "name": "Leaf1", "parent": "a"},
            {"id": "leaf2", "name": "Leaf2", "parent": "a"},
        ],
        relations=[{"from": "a", "to": "system", "label": "uses"}],
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical", check_islands={"hint": "wire it"}))

    assert not any(line.startswith("ISLAND") for line in report.shape)


def test_c1_check_islands_unset_skips_the_check():
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
            {"id": "b", "name": "B", "kind": "external_system"},
        ],
        relations=[{"from": "a", "to": "b", "label": "calls"}],
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical", check_islands=None))

    assert not any(line.startswith("ISLAND") for line in report.shape)


# --- meta.plan_kind: Planned block (055-diagram-feature-plan) ---


def test_hierarchical_planned_leaf_without_path_is_not_broken():
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
            {
                "id": "new_fn",
                "name": "new_fn",
                "parent": "a",
                "meta": {"plan_kind": "add"},
            },
        ]
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical"))

    assert not any(line.startswith("BROKEN") for line in report.broken)


def test_hierarchical_leaf_without_path_or_plan_kind_is_still_broken():
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
            {"id": "orphan_leaf", "name": "orphan_leaf", "parent": "a"},
        ]
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical"))

    assert any(line.startswith("BROKEN orphan_leaf") for line in report.broken)


def test_hierarchical_planned_leaf_still_counts_toward_density_budget():
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
            {"id": "new_fn", "name": "new_fn", "parent": "a", "meta": {"plan_kind": "create"}},
        ]
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical", budgets={"max_nodes": 1}))

    assert any(line.startswith("CROWDED") for line in report.shape)


def test_hierarchical_unwired_planned_leaf_is_still_an_orphan():
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
            {"id": "new_fn", "name": "new_fn", "parent": "a", "meta": {"plan_kind": "add"}},
        ],
        relations=[{"from": "a", "to": "system", "label": "uses"}],
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical"))

    assert any(line.startswith("ORPHAN 'new_fn'") for line in report.shape)


def test_hierarchical_conceptual_leaf_is_not_broken():
    # diagram_resolver.py's _stamp_no_code_reason: a real conceptual box, resolver-stamped.
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
            {
                "id": "concept_leaf", "name": "concept_leaf", "parent": "a",
                "meta": {"no_code_reason": "conceptual"},
            },
        ]
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical"))

    assert not any(line.startswith("BROKEN") for line in report.broken)


def test_hierarchical_unresolved_leaf_is_still_broken():
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
            {
                "id": "bad_leaf", "name": "bad_leaf", "parent": "a",
                "meta": {"no_code_reason": "unresolved", "no_code_detail": "src/gone.py"},
            },
        ]
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical"))

    assert any(line.startswith("BROKEN bad_leaf") for line in report.broken)


def test_hierarchical_modify_leaf_with_unresolved_path_is_still_broken():
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
            {
                "id": "changed_fn",
                "name": "changed_fn",
                "parent": "a",
                "path": "src/gone.py",
                "node_id": None,
                "meta": {"plan_kind": "modify"},
            },
        ]
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical"))

    assert any(line.startswith("BROKEN changed_fn") for line in report.broken)


def test_flat_planned_node_without_path_is_not_broken():
    diagram = _flat_diagram([{"id": "new_fn", "name": "new_fn", "meta": {"plan_kind": "add"}}])

    report = inspect(diagram, CheckConfig(shape="flat"))

    assert not any(line.startswith("BROKEN") for line in report.broken)


def test_node_icon_kind_badkind_is_unaffected_by_plan_kind():
    diagram = _hierarchical_diagram(
        [
            {"id": "system", "name": "Sys"},
            {"id": "a", "name": "A", "kind": "external_system"},
            {"id": "bad", "name": "Bad", "parent": "a", "kind": "not-a-real-kind", "path": "x.py"},
        ]
    )

    report = inspect(diagram, CheckConfig(shape="hierarchical"))

    assert any(line.startswith("BADKIND bad") for line in report.advisories)
