"""Direct coverage for impact_resolver's pure helpers: path, seeded-node filter, status coercion."""

import pytest

from codechroma.bridge.diagram_diagnostics import Diagnostics
from codechroma.bridge.impact_resolver import (
    _coerce_statuses,
    _drop_unseeded,
    _keep_seeded_node,
    impact_path,
)


def test_impact_path_is_the_builtin_artifact_under_the_repo_root(tmp_path):
    path = impact_path(tmp_path)

    assert path == tmp_path / ".codechroma" / "diagrams" / "impact" / "impact.json"


def test_seeded_node_with_a_node_id_is_kept_silently():
    notes = Diagnostics()

    kept = _keep_seeded_node({"id": "a", "node_id": "pkg.a"}, notes)

    assert kept is True
    assert len(notes) == 0


@pytest.mark.parametrize(
    ("item", "reason"),
    [
        ({"id": "a"}, "unresolved_path"),
        ({"id": "a", "node_id": ""}, "unresolved_path"),
        ({"id": "a", "node_id": 7}, "unresolved_path"),
        ({"node_id": ""}, "invalid_shape"),
        ("not-a-dict", "invalid_shape"),
    ],
)
def test_unseeded_node_is_dropped_with_a_reason(item, reason):
    notes = Diagnostics()

    kept = _keep_seeded_node(item, notes)

    assert kept is False
    assert notes.items[0].reason == reason


def test_drop_unseeded_filters_nodes_and_leaves_other_keys():
    notes = Diagnostics()
    authored = {"nodes": [{"id": "a", "node_id": "x"}, {"id": "b"}], "source": "diff"}

    result = _drop_unseeded(authored, notes)

    assert result == {"nodes": [{"id": "a", "node_id": "x"}], "source": "diff"}


def test_drop_unseeded_passes_through_when_nodes_is_not_a_list():
    authored = {"nodes": "oops"}

    result = _drop_unseeded(authored, Diagnostics())

    assert result is authored


def test_coerce_statuses_keeps_plan_roles_and_nulls_unknown_ones():
    resolved = {
        "nodes": [
            {"id": "a", "meta": {"status": "new"}},
            {"id": "b", "meta": {"status": "weird"}},
            {"id": "c"},
        ]
    }

    result = _coerce_statuses(resolved)

    assert [n["meta"].get("status") for n in result["nodes"]] == ["new", None, None]
    assert result["diagnostics"]["dropped"][0]["reason"] == "status_coerced"
    assert result["diagnostics"]["dropped_count"] == 1


def test_coerce_statuses_reports_nothing_when_all_are_valid():
    resolved = {"nodes": [{"id": "a", "meta": {"status": "deleted"}}]}

    result = _coerce_statuses(resolved)

    assert result["diagnostics"]["dropped_count"] == 0
