"""Unit coverage for migrate_if_legacy: converting a pre-036 saved diagram to the shared shape."""

from codechroma.bridge.diagram_migration import migrate_if_legacy, needs_regeneration


def test_new_shape_c1_file_is_a_no_op():
    data = {"type": "c1", "nodes": [{"id": "a", "name": "A"}], "relations": []}

    migrated, changed = migrate_if_legacy("c1", data)

    assert changed is False
    assert migrated is data


def test_new_shape_patterns_file_is_a_no_op():
    data = {"type": "patterns", "nodes": [], "relations": []}

    migrated, changed = migrate_if_legacy("patterns", data)

    assert changed is False
    assert migrated is data


def test_c1_nested_children_flatten_with_parent_set():
    data = {
        "system": {
            "name": "Sample", "description": "A demo",
            "children": [{"id": "billing", "name": "Billing", "path": "billing"}],
        },
        "actors": [],
        "relationships": [],
    }

    migrated, changed = migrate_if_legacy("c1", data)

    assert changed is True
    by_id = {node["id"]: node for node in migrated["nodes"]}
    assert by_id["system"]["name"] == "Sample"
    assert by_id["billing"]["parent"] == "system"
    assert by_id["billing"]["path"] == "billing"


def test_c1_nested_grandchildren_keep_their_true_parent():
    data = {
        "system": {"name": "Sample", "children": [
            {"id": "engine", "name": "Engine", "children": [
                {"id": "graph", "name": "Graph", "path": "src/graph"},
            ]},
        ]},
        "actors": [],
        "relationships": [],
    }

    migrated, _ = migrate_if_legacy("c1", data)

    by_id = {node["id"]: node for node in migrated["nodes"]}
    assert by_id["graph"]["parent"] == "engine"
    assert by_id["engine"]["parent"] == "system"


def test_c1_actors_become_ordinary_nodes_with_kind():
    data = {
        "system": {"name": "Sample", "children": []},
        "actors": [{"id": "stripe", "name": "Stripe", "type": "external_system"}],
        "relationships": [],
    }

    migrated, _ = migrate_if_legacy("c1", data)

    stripe = next(node for node in migrated["nodes"] if node["id"] == "stripe")
    assert stripe["kind"] == "external_system"
    assert stripe.get("parent") is None


def test_c1_relationship_endpoints_remap_to_the_new_flat_ids():
    data = {
        "system": {"name": "Sample", "children": [
            {"id": "billing", "name": "Billing", "path": "billing"},
        ]},
        "actors": [{"id": "stripe", "name": "Stripe", "type": "external_system"}],
        "relationships": [{"from": "system/billing", "to": "stripe", "label": "Charges"}],
    }

    migrated, _ = migrate_if_legacy("c1", data)

    assert migrated["relations"] == [{"from": "billing", "to": "stripe", "label": "Charges"}]


def test_c1_relationship_naming_a_dropped_endpoint_is_dropped():
    data = {
        "system": {"name": "Sample", "children": []},
        "actors": [],
        "relationships": [{"from": "system", "to": "nowhere", "label": "x"}],
    }

    migrated, _ = migrate_if_legacy("c1", data)

    assert migrated["relations"] == []


def test_c1_duplicate_bare_ids_across_branches_are_disambiguated():
    data = {
        "system": {"name": "Sample", "children": [
            {"id": "a", "name": "A", "children": [{"id": "shared", "name": "Shared 1"}]},
            {"id": "b", "name": "B", "children": [{"id": "shared", "name": "Shared 2"}]},
        ]},
        "actors": [],
        "relationships": [],
    }

    migrated, _ = migrate_if_legacy("c1", data)

    ids = [node["id"] for node in migrated["nodes"]]
    assert len(ids) == len(set(ids))


def test_a_file_missing_system_is_not_convertible_and_is_left_untouched():
    data = {"actors": [{"id": "x", "name": "X"}]}

    migrated, changed = migrate_if_legacy("c1", data)

    assert changed is False
    assert migrated is data


def test_patterns_instances_and_participants_flatten_with_parent_set():
    data = {
        "patterns": [
            {
                "id": "strategy::Foo", "type": "strategy", "name": "Strategy", "confirmed": True,
                "confidence": 0.9,
                "participants": [
                    {
                        "id": "class::Foo", "role": "interface", "name": "Foo",
                        "node_id": "class::Foo",
                    },
                ],
            }
        ],
        "unconfirmed": [],
        "nodes": [{"id": "infra::db", "name": "DB", "kind": "infra"}],
        "relations": [],
    }

    migrated, changed = migrate_if_legacy("patterns", data)

    assert changed is True
    by_id = {node["id"]: node for node in migrated["nodes"]}
    assert by_id["strategy::Foo"]["kind"] == "pattern-instance"
    assert by_id["strategy::Foo"]["meta"]["confirmed"] is True
    assert by_id["class::Foo"]["parent"] == "strategy::Foo"
    assert by_id["class::Foo"]["node_id"] == "class::Foo"
    assert by_id["infra::db"]["kind"] == "infra"


def test_impact_and_custom_pass_through_unrecognized_as_not_legacy():
    data = {"nodes": [{"id": "n1", "name": "N1", "node_id": "x"}], "relations": []}

    migrated, changed = migrate_if_legacy("impact", data)

    assert changed is False
    assert migrated is data


def test_missing_or_empty_file_is_not_legacy():
    migrated, changed = migrate_if_legacy("c1", {})

    assert changed is False
    assert migrated == {}


def test_a_malformed_system_value_does_not_crash_and_is_left_untouched():
    data = {"system": "not-a-dict", "actors": []}

    migrated, changed = migrate_if_legacy("c1", data)

    assert changed is False
    assert migrated is data


def test_needs_regeneration_is_false_for_an_already_new_shape_file():
    assert needs_regeneration("c1", {"nodes": [], "relations": []}) is False


def test_needs_regeneration_is_false_for_a_convertible_legacy_file():
    data = {"system": {"name": "Sample", "children": []}, "actors": [], "relationships": []}

    assert needs_regeneration("c1", data) is False


def test_needs_regeneration_is_true_for_a_legacy_shaped_file_the_converter_cant_parse():
    data = {"system": "not-a-dict", "actors": []}

    assert needs_regeneration("c1", data) is True
