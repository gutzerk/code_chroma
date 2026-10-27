"""advise_relations: the bridge's mirror of check_diagram.py's edge/message-kind advisories."""

import pytest

from codechroma.bridge.diagram_diagnostics import Diagnostics, advise_relations


def _reasons(relations: list, kind: str | None) -> list[str]:
    notes = Diagnostics()
    advise_relations(relations, kind, notes)
    return [item.reason for item in notes.items]


@pytest.mark.parametrize(
    ("relation", "reason"),
    [
        ({"from": "a", "to": "b", "kind": "bogus"}, "bad_edge_kind"),
        ({"from": "a", "to": "b", "label": "spawns a worker process"}, "edge_kind_spawn"),
        ({"from": "a", "to": "b", "label": "writes to the sqlite store"}, "edge_kind_data"),
    ],
)
def test_edge_advisories_fire_for_a_plain_diagram(relation, reason):
    reasons = _reasons([relation], "feature-plan")

    assert reasons == [reason]


def test_a_correctly_kinded_edge_is_silent():
    relation = {"from": "a", "to": "b", "label": "spawns a worker process", "kind": "spawns"}

    reasons = _reasons([relation], "patterns")

    assert reasons == []


def test_structural_diagrams_accept_free_form_edge_kinds():
    relation = {"from": "a", "to": "b", "kind": "observes"}

    reasons = [_reasons([relation], kind) for kind in ("c1", "patterns", "impact")]

    assert reasons == [[], [], []]


def test_an_authored_removed_edge_is_silent():
    relation = {"from": "a", "to": "b", "kind": "removed"}

    reasons = _reasons([relation], "impact")

    assert reasons == []


def test_sequence_checks_message_kinds_and_not_edge_kinds():
    relations = [
        {"id": "m1", "kind": "shout", "label": "hi"},
        {"id": "m2", "label": "request failed"},
        {"id": "m3", "from": "a", "to": "b", "label": "spawns a worker process"},
    ]

    reasons = _reasons(relations, "sequence")

    assert reasons == ["bad_message_kind", "failure_kind"]


def test_custom_diagrams_are_skipped():
    relations = [{"from": "a", "to": "b", "kind": "bogus"}]

    reasons = _reasons(relations, "custom")

    assert reasons == []


@pytest.mark.parametrize("kind", [5, ["calls"], {"k": 1}])
def test_a_non_string_edge_kind_is_a_bad_kind_for_a_plain_diagram(kind):
    relation = {"from": "a", "to": "b", "kind": kind}

    reasons = _reasons([relation], "feature-plan")

    assert reasons == ["bad_edge_kind"]


def test_a_non_string_edge_kind_is_tolerated_on_a_structural_diagram():
    relation = {"from": "a", "to": "b", "kind": 5}

    reasons = _reasons([relation], "c1")

    assert reasons == []
