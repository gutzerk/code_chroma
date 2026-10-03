"""Unit tests for patterns_resolver: the detector-candidate/persisted-authoring merge."""

from dataclasses import dataclass

from codechroma.bridge.patterns_resolver import (
    PatternDiagramAdapter,
    resolve_patterns_diagram,
)
from codechroma.graph.models import (
    Graph,
    PatternInstance,
    PatternParticipant,
    PatternRole,
    PatternType,
)


@dataclass
class _FakeEngine:
    def get_node(self, node_id: str):
        return None


ENGINE = _FakeEngine()

_PARTICIPANT = PatternParticipant(
    id="class::Foo",
    role=PatternRole.IMPLEMENTATION,
    name="Foo",
    qualified_name="pkg.Foo",
    node_id="class::Foo",
    path="pkg/foo.py",
)


def _graph_with_candidate() -> Graph:
    candidate = PatternInstance(
        id="strategy::Foo",
        type=PatternType.STRATEGY,
        name="Strategy — Foo dispatch",
        participants=[_PARTICIPANT],
    )
    return Graph(pattern_candidates=[candidate])


def _nodes_by_id(diagram: dict) -> dict[str, dict]:
    return {node["id"]: node for node in diagram["nodes"]}


def test_adapter_emits_one_node_per_instance_and_one_per_participant():
    shared = PatternDiagramAdapter().to_shared_diagram(_graph_with_candidate().pattern_candidates)

    nodes = _nodes_by_id(shared)
    assert nodes["strategy::Foo"]["kind"] == "pattern-instance"
    assert nodes["class::Foo"]["parent"] == "strategy::Foo"
    assert nodes["class::Foo"]["node_id"] == "class::Foo"


def test_node_id_matched_entry_is_not_appended_twice():
    # Matched via participant overlap; that entry must not also be appended as an extra instance.
    participant = PatternParticipant(
        id="class::Foo", role=PatternRole.IMPLEMENTATION, name="Foo", qualified_name="pkg.Foo",
        node_id="real::Foo", path="pkg/foo.py",
    )
    candidate = PatternInstance(
        id="strategy::pkg/foo.py::class::Foo", type=PatternType.STRATEGY,
        name="Strategy — Foo dispatch", participants=[participant],
    )
    graph = Graph(pattern_candidates=[candidate])
    persisted = {
        "nodes": [
            {"id": "strategy::Foo", "kind": "pattern-instance", "meta": {"confirmed": True}},
            {"id": "class::Foo", "parent": "strategy::Foo", "node_id": "real::Foo"},
        ]
    }

    diagram = resolve_patterns_diagram(ENGINE, graph, persisted)

    instances = [n for n in diagram["nodes"] if n.get("kind") == "pattern-instance"]
    assert len(instances) == 1
    assert instances[0]["meta"]["confirmed"] is True


def test_authorless_diagram_surfaces_heuristic_candidates_but_is_not_an_ordered_diagram():
    diagram = resolve_patterns_diagram(ENGINE, _graph_with_candidate(), {})

    instances = [n for n in diagram["nodes"] if n.get("kind") == "pattern-instance"]
    assert len(instances) == 1
    assert instances[0]["meta"]["confirmed"] is None
    assert diagram["has_diagram"] is False


def test_a_fresh_candidate_participant_with_no_persisted_overlay_keeps_its_own_description():
    persisted = {"nodes": [{"id": "strategy::Foo", "kind": "pattern-instance"}]}

    diagram = resolve_patterns_diagram(ENGINE, _graph_with_candidate(), persisted)

    assert _nodes_by_id(diagram)["class::Foo"]["description"] == ""


def test_merges_authored_participant_description_onto_the_regenerated_candidate():
    persisted = {
        "nodes": [{"id": "class::Foo", "description": "Dispatches by shipping method."}]
    }

    diagram = resolve_patterns_diagram(ENGINE, _graph_with_candidate(), persisted)

    assert _nodes_by_id(diagram)["class::Foo"]["description"] == "Dispatches by shipping method."


def test_merges_authored_participant_style_onto_the_regenerated_candidate():
    persisted = {"nodes": [{"id": "class::Foo", "style": {"color": "#f00"}}]}

    diagram = resolve_patterns_diagram(ENGINE, _graph_with_candidate(), persisted)

    assert _nodes_by_id(diagram)["class::Foo"]["style"] == {"color": "#f00"}


def test_confirmed_pattern_matches_candidate_by_participant_node_id_when_top_level_ids_differ():
    # A renamed instance id must still match its confirmed entry via participant node_id overlap.
    participant = PatternParticipant(
        id="class::KnowledgeBaseClient", role=PatternRole.IMPLEMENTATION,
        name="KnowledgeBaseClient", qualified_name="src.knowledge_clients.KnowledgeBaseClient",
        node_id="src/knowledge_clients/abs_client.py::class::KnowledgeBaseClient",
        path="src/knowledge_clients/abs_client.py",
    )
    candidate = PatternInstance(
        id="adapter::src/knowledge_clients/abs_client.py::class::KnowledgeBaseClient",
        type=PatternType.ADAPTER, name="Adapter — knowledge source normalization",
        participants=[participant],
    )
    graph = Graph(pattern_candidates=[candidate])
    persisted = {
        "nodes": [
            {
                "id": "adapter::knowledge_clients", "kind": "pattern-instance",
                "name": "Adapter — knowledge source normalization",
                "meta": {"confirmed": True, "confidence": 0.95},
            },
            {
                "id": "knowledge_base_client_interface", "parent": "adapter::knowledge_clients",
                "node_id": "src/knowledge_clients/abs_client.py::class::KnowledgeBaseClient",
            },
        ]
    }

    diagram = resolve_patterns_diagram(ENGINE, graph, persisted)

    instances = [n for n in diagram["nodes"] if n.get("kind") == "pattern-instance"]
    assert len(instances) == 1
    assert instances[0]["id"].startswith("adapter::")
    assert instances[0]["meta"]["confirmed"] is True


def test_context_node_node_ids_survive_resolution():
    # A merged infra box's authored node_ids[] must flow through untouched (multi-open per box).
    persisted = {
        "nodes": [
            {
                "id": "infra::logging", "name": "Logging System", "kind": "infra",
                "path": "backend/internal/logging",
                "node_id": "backend/internal/logging/logging.go::class::New",
                "node_ids": [
                    "backend/internal/logging/logging.go::class::New",
                    "backend/internal/logging/logging.go::class::newLogger",
                ],
            }
        ]
    }

    diagram = resolve_patterns_diagram(ENGINE, _graph_with_candidate(), persisted)

    infra = _nodes_by_id(diagram)["infra::logging"]
    assert infra["node_ids"] == [
        "backend/internal/logging/logging.go::class::New",
        "backend/internal/logging/logging.go::class::newLogger",
    ]


def test_a_free_standing_node_outside_infra_external_is_dropped_as_unknown_kind():
    persisted = {"nodes": [{"id": "bogus", "name": "Bogus", "kind": "not-a-real-kind"}]}

    diagram = resolve_patterns_diagram(ENGINE, _graph_with_candidate(), persisted)

    assert "bogus" not in _nodes_by_id(diagram)
    reasons = {entry["id"]: entry["reason"] for entry in diagram["diagnostics"]["dropped"]}
    assert reasons["bogus"] == "unknown_kind"


def test_a_free_standing_self_relation_survives_regardless_of_style():
    persisted = {
        "nodes": [{"id": "infra-db", "name": "PostgreSQL", "kind": "infra"}],
        "relations": [{"from": "infra-db", "to": "infra-db", "kind": "reads"}],
    }

    diagram = resolve_patterns_diagram(ENGINE, _graph_with_candidate(), persisted)

    relation = diagram["relations"][0]
    assert (relation["from"], relation["to"]) == ("infra-db", "infra-db")


def test_authored_participant_description_does_not_leak_onto_other_participants():
    graph = _graph_with_candidate()
    graph.pattern_candidates[0].participants.append(
        PatternParticipant(
            id="class::Bar", role=PatternRole.INTERFACE, name="Bar", qualified_name="pkg.Bar"
        )
    )
    persisted = {
        "nodes": [{"id": "class::Foo", "description": "Dispatches by shipping method."}]
    }

    diagram = resolve_patterns_diagram(ENGINE, graph, persisted)

    nodes = _nodes_by_id(diagram)
    assert nodes["class::Foo"]["description"] == "Dispatches by shipping method."
    assert nodes["class::Bar"]["description"] == ""


def test_a_rejected_instance_and_its_participants_are_dropped():
    persisted = {
        "nodes": [{"id": "strategy::Foo", "kind": "pattern-instance", "meta": {"confirmed": False}}]
    }

    diagram = resolve_patterns_diagram(ENGINE, _graph_with_candidate(), persisted)

    assert diagram["nodes"] == []


def test_a_rejected_instances_relations_are_dropped_with_its_participants():
    """Rejecting an instance drops its attr-participant boxes AND the relations that pointed at
    them -- otherwise the resolver reports 'points at a box that isn't there' endpooints."""
    from codechroma.graph.models import PatternRelation, PatternRelationKind

    attr_participant = PatternParticipant(
        id="attr::class::Foo::field", role=PatternRole.IMPLEMENTATION, name="field",
        qualified_name="field",
    )
    candidate = PatternInstance(
        id="strategy::Foo", type=PatternType.STRATEGY, name="Strategy — Foo dispatch",
        participants=[_PARTICIPANT, attr_participant],
        relations=[
            PatternRelation(
                from_id="class::Foo", to_id="attr::class::Foo::field",
                kind=PatternRelationKind.USES,
            )
        ],
    )
    graph = Graph(pattern_candidates=[candidate])
    persisted = {
        "nodes": [{"id": "strategy::Foo", "kind": "pattern-instance", "meta": {"confirmed": False}}]
    }

    diagram = resolve_patterns_diagram(ENGINE, graph, persisted)

    assert diagram["nodes"] == []
    # The relation's only endpoint (the attr box) was dropped with the instance, so the relation
    # must not survive either -- a dangling endpoint would be flagged as "not drawn".
    assert all(rel["from"] != "class::Foo" for rel in diagram["relations"])
    assert diagram["diagnostics"]["dropped_count"] == 0


def test_instance_internal_relations_surface_as_shared_relations():
    from codechroma.graph.models import PatternRelation, PatternRelationKind

    participant = PatternParticipant(
        id="class::Bar", role=PatternRole.IMPLEMENTATION, name="Bar", qualified_name="pkg.Bar",
    )
    candidate = PatternInstance(
        id="strategy::Foo", type=PatternType.STRATEGY, name="Strategy",
        participants=[_PARTICIPANT, participant],
        relations=[
            PatternRelation(
                from_id="class::Bar", to_id="class::Foo", kind=PatternRelationKind.IMPLEMENTS
            )
        ],
    )
    graph = Graph(pattern_candidates=[candidate])

    diagram = resolve_patterns_diagram(ENGINE, graph, {})

    assert {"from": "class::Bar", "to": "class::Foo", "kind": "implements", "label": None} in [
        {k: r[k] for k in ("from", "to", "kind", "label")} for r in diagram["relations"]
    ]


def test_a_participant_shared_by_two_instances_becomes_one_node_not_a_duplicate():
    shared = PatternParticipant(
        id="class::Settings", role=PatternRole.DISPATCHER, name="Settings",
        qualified_name="Settings", node_id="class::Settings",
    )
    dispatcher_only = PatternParticipant(
        id="class::Foo", role=PatternRole.IMPLEMENTATION, name="Foo", qualified_name="pkg.Foo",
    )
    strategy = PatternInstance(
        id="strategy::Foo", type=PatternType.STRATEGY, name="Strategy",
        participants=[dispatcher_only, shared],
    )
    registry = PatternInstance(
        id="registry::Settings", type=PatternType.REGISTRY, name="Registry",
        participants=[shared],
    )
    graph = Graph(pattern_candidates=[strategy, registry])

    diagram = resolve_patterns_diagram(ENGINE, graph, {})

    settings_nodes = [n for n in diagram["nodes"] if n["id"] == "class::Settings"]
    assert len(settings_nodes) == 1
    assert settings_nodes[0]["parent"] == "strategy::Foo"


def test_staleness_follows_the_candidate_sets_own_fingerprint():
    graph = _graph_with_candidate()
    from codechroma.patterns.serialize import fingerprint_for

    current = fingerprint_for(graph.pattern_candidates)

    stale = resolve_patterns_diagram(ENGINE, graph, {"fingerprint": "not-" + current})
    fresh = resolve_patterns_diagram(ENGINE, graph, {"fingerprint": current})

    assert stale["stale"] is True
    assert fresh["stale"] is False
