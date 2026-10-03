"""Unit coverage for the one shared resolve_diagram(): node/relation validation, style priority."""

import shutil
from pathlib import Path

import pytest

from codechroma.bridge.diagram_resolver import (
    attach_coverage,
    attach_staleness,
    merge_by_id,
    resolve_diagram,
)
from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


@pytest.fixture
def engine(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    graph_engine = GraphEngine(summarizer=AISummarizer())
    graph_engine.analyze(str(repo))
    return graph_engine


def _diagram(nodes=None, relations=None, style=None):
    data = {"type": "c1", "nodes": nodes or [], "relations": relations or []}
    if style is not None:
        data["style"] = style
    return data


def test_malformed_diagram_passes_through_unchanged(engine):
    assert resolve_diagram(engine, "junk") == "junk"


def test_empty_diagram_still_produces_a_full_stable_shape(engine):
    resolved = resolve_diagram(engine, {})

    assert resolved["nodes"] == []
    assert resolved["relations"] == []
    assert resolved["groups"] == []
    assert resolved["diagnostics"]["dropped_count"] == 0


@pytest.mark.parametrize(
    "path,expected",
    [
        ("shared/text_utils.py", "component::shared/text_utils.py"),
        ("shared", "dir::shared"),
    ],
    ids=["component", "dir"],
)
def test_path_resolves(engine, path, expected):
    data = _diagram(nodes=[{"id": "a", "name": "A", "path": path}])

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"][0]["node_id"] == expected


def test_unknown_path_resolves_to_none_with_a_diagnostic(engine):
    data = _diagram(nodes=[{"id": "a", "name": "A", "path": "shared/missing.py"}])

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"][0]["node_id"] is None
    assert resolved["diagnostics"]["dropped_count"] == 1
    assert resolved["diagnostics"]["dropped"][0]["reason"] == "unresolved_path"


def test_authored_node_id_survives_when_there_is_no_path(engine):
    data = _diagram(nodes=[{"id": "a", "name": "A", "node_id": "component::shared/text_utils.py"}])

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"][0]["node_id"] == "component::shared/text_utils.py"


def test_existing_node_id_is_never_reresolved_from_a_coexisting_path(engine):
    # A participant carries both a detector-given symbol node_id and a source path; path must lose.
    data = _diagram(
        nodes=[{"id": "a", "name": "A", "node_id": "class::Foo", "path": "shared/text_utils.py"}]
    )

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"][0]["node_id"] == "class::Foo"
    assert resolved["diagnostics"]["dropped_count"] == 0


def test_node_without_an_id_is_dropped(engine):
    data = _diagram(nodes=[{"name": "No id"}])

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"] == []
    assert resolved["diagnostics"]["dropped"][0]["reason"] == "invalid_shape"


def test_duplicate_node_id_keeps_only_the_first(engine):
    data = _diagram(nodes=[{"id": "a", "name": "First"}, {"id": "a", "name": "Second"}])

    resolved = resolve_diagram(engine, data)

    assert [n["name"] for n in resolved["nodes"]] == ["First"]
    assert resolved["diagnostics"]["dropped"][0]["reason"] == "duplicate_sibling_id"


def test_valid_parent_reference_is_kept(engine):
    data = _diagram(nodes=[{"id": "a", "name": "A"}, {"id": "b", "name": "B", "parent": "a"}])

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"][1]["parent"] == "a"


def test_dangling_parent_reference_is_dropped(engine):
    data = _diagram(nodes=[{"id": "a", "name": "A", "parent": "nowhere"}])

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"][0]["parent"] is None
    assert resolved["diagnostics"]["dropped"][0]["reason"] == "dangling_endpoint"


def test_relation_between_real_nodes_is_kept(engine):
    data = _diagram(
        nodes=[{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        relations=[{"from": "a", "to": "b", "kind": "uses"}],
    )

    resolved = resolve_diagram(engine, data)

    assert len(resolved["relations"]) == 1


def test_a_relations_own_hero_flag_survives_untouched(engine):
    data = _diagram(
        nodes=[{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        relations=[{"from": "a", "to": "b", "kind": "uses", "hero": True}],
    )

    resolved = resolve_diagram(engine, data)

    assert resolved["relations"][0]["hero"] is True


def test_relation_with_a_dangling_endpoint_is_dropped(engine):
    data = _diagram(
        nodes=[{"id": "a", "name": "A"}],
        relations=[{"from": "a", "to": "nowhere", "kind": "uses"}],
    )

    resolved = resolve_diagram(engine, data)

    assert resolved["relations"] == []
    assert resolved["diagnostics"]["dropped"][0]["reason"] == "dangling_endpoint"


def test_self_relation_is_dropped_by_default(engine):
    data = _diagram(
        nodes=[{"id": "a", "name": "A"}], relations=[{"from": "a", "to": "a", "kind": "calls"}]
    )

    resolved = resolve_diagram(engine, data)

    assert resolved["relations"] == []


def test_self_relation_survives_when_style_allows_it(engine):
    data = _diagram(
        nodes=[{"id": "a", "name": "A"}],
        relations=[{"from": "a", "to": "a", "kind": "calls"}],
        style="dependency-graph",
    )

    resolved = resolve_diagram(engine, data)

    assert len(resolved["relations"]) == 1


def test_item_style_wins_over_the_diagram_edge_style(engine):
    data = _diagram(
        nodes=[{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        relations=[{"from": "a", "to": "b", "kind": "uses", "style": {"color": "blue"}}],
        style="patterns-yellow-arrows",
    )

    resolved = resolve_diagram(engine, data)

    assert resolved["relations"][0]["style"] == {"color": "blue"}


def test_diagram_edge_style_applies_when_the_relation_has_none(engine):
    data = _diagram(
        nodes=[{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        relations=[{"from": "a", "to": "b", "kind": "uses"}],
        style="patterns-yellow-arrows",
    )

    resolved = resolve_diagram(engine, data)

    assert resolved["relations"][0]["style"] == {"border-color": "var(--warning)"}


def test_unknown_style_name_degrades_to_no_overrides(engine):
    data = _diagram(nodes=[{"id": "a", "name": "A"}], style="not-a-real-style")

    resolved = resolve_diagram(engine, data)

    assert resolved["groups"] == []


def test_groups_are_computed_only_when_the_style_supports_them(engine):
    data = _diagram(
        nodes=[{"id": "a", "name": "A", "group": "Storage"}], style="boxes-arrows"
    )

    resolved = resolve_diagram(engine, data)

    assert resolved["groups"] == ["Storage"]


def test_groups_stay_empty_when_the_style_does_not_support_them(engine):
    data = _diagram(nodes=[{"id": "a", "name": "A", "group": "Storage"}])

    resolved = resolve_diagram(engine, data)

    assert resolved["groups"] == []


def test_explicit_style_source_overrides_the_diagrams_own_style(engine):
    data = _diagram(
        nodes=[{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        relations=[{"from": "a", "to": "b", "kind": "uses"}],
        style="boxes-arrows",
    )

    resolved = resolve_diagram(engine, data, style_source="patterns-yellow-arrows")

    assert resolved["relations"][0]["style"] == {"border-color": "var(--warning)"}


def test_meta_is_passed_through_untouched(engine):
    data = _diagram(nodes=[{"id": "a", "name": "A", "meta": {"status": "modified", "junk": 1}}])

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"][0]["meta"] == {
        "status": "modified", "junk": 1, "no_code_reason": "conceptual"
    }


def test_planned_block_without_a_path_resolves_cleanly_with_no_diagnostic(engine):
    # 055-diagram-feature-plan: an add/create Planned block is authored with no path at all.
    data = _diagram(nodes=[{"id": "a", "name": "A", "meta": {"plan_kind": "add"}}])

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"][0].get("node_id") is None
    assert resolved["diagnostics"]["dropped_count"] == 0
    assert resolved["nodes"][0]["meta"] == {"plan_kind": "add", "no_code_reason": "planned"}


def test_pathless_node_with_no_meta_is_stamped_conceptual(engine):
    data = _diagram(nodes=[{"id": "a", "name": "A"}])

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"][0]["meta"] == {"no_code_reason": "conceptual"}


def test_unresolved_path_is_stamped_with_the_failed_path_as_detail(engine):
    data = _diagram(nodes=[{"id": "a", "name": "A", "path": "shared/missing.py"}])

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"][0]["meta"] == {
        "no_code_reason": "unresolved", "no_code_detail": "shared/missing.py"
    }


def test_modify_plan_kind_with_unresolved_path_is_unresolved_not_planned(engine):
    # modify/delete point at real, already-existing code -- planned only covers add/create.
    node = {"id": "a", "name": "A", "path": "shared/missing.py", "meta": {"plan_kind": "modify"}}
    data = _diagram(nodes=[node])

    resolved = resolve_diagram(engine, data)

    assert resolved["nodes"][0]["meta"]["no_code_reason"] == "unresolved"


def test_resolved_node_gets_no_no_code_reason_key(engine):
    node = {"id": "a", "name": "A", "path": "shared/text_utils.py", "meta": {"x": 1}}
    data = _diagram(nodes=[node])

    resolved = resolve_diagram(engine, data)

    assert "no_code_reason" not in resolved["nodes"][0]["meta"]


def test_attach_coverage_lists_uncovered_top_level_directories(engine):
    resolved = {"nodes": [{"id": "a", "path": "shared"}]}

    with_coverage = attach_coverage(resolved, engine)

    assert [entry["path"] for entry in with_coverage["unmapped"]] == ["billing", "users", "web"]


def test_attach_staleness_is_stale_when_fingerprints_differ():
    resolved = attach_staleness({}, fingerprint="new", reviewed_fingerprint="old")

    assert resolved["stale"] is True
    assert resolved["fingerprint"] == "new"


def test_attach_staleness_is_not_stale_with_no_prior_review():
    resolved = attach_staleness({}, fingerprint="new", reviewed_fingerprint=None)

    assert resolved["stale"] is False


def test_merge_by_id_overlays_matched_fields_by_id():
    current = [{"id": "a", "confirmed": None}]
    persisted = [{"id": "a", "confirmed": True}]

    merged, matched = merge_by_id(current, persisted, fields=("confirmed",))

    assert merged[0]["confirmed"] is True
    assert matched == {"a"}


def test_merge_by_id_falls_back_to_the_match_callback():
    current = [{"id": "a", "confirmed": None}]
    persisted = [{"id": "b", "confirmed": True}]

    merged, matched = merge_by_id(
        current, persisted, fields=("confirmed",), match=lambda c, p: True
    )

    assert merged[0]["confirmed"] is True
    assert matched == {"b"}


def test_merge_by_id_leaves_an_unmatched_item_untouched():
    current = [{"id": "a", "confirmed": None}]

    merged, matched = merge_by_id(current, [], fields=("confirmed",))

    assert merged[0]["confirmed"] is None
    assert matched == set()


class _OriginEngine:
    def __init__(self, origins_by_node):
        self._origins = origins_by_node

    def edge_origin(self, from_id):
        return self._origins.get(from_id)


def test_attach_origins_stamps_meta_origin_on_matching_relations():
    # Origin is per-source-node: both a->b and a->c share a's origin (crucial for capturing the
    # "closing over a dynamic variable" class of bugs, and they also genuinely share the caller).
    engine = _OriginEngine({"component::a.py": "a.py:12"})
    resolved = {
        "nodes": [
            {"id": "a", "node_id": "component::a.py"},
            {"id": "b", "node_id": "component::b.py"},
            {"id": "c", "node_id": "component::c.py"},
        ],
        "relations": [
            {"from": "a", "to": "b", "kind": "uses"},
            {"from": "b", "to": "c", "kind": "uses"},
            {"from": "a", "to": "c", "kind": "uses"},
        ],
    }
    from codechroma.bridge.diagram_resolver import attach_origins

    out = attach_origins(engine, resolved)

    by_pair = {(rel["from"], rel["to"]): rel.get("meta") for rel in out["relations"]}
    # a is the source of a->b and a->c -- both get a's origin.
    assert by_pair[("a", "b")]["origin"] == "a.py:12"
    assert by_pair[("a", "c")]["origin"] == "a.py:12"
    # b has no origin in the engine: its meta stays untouched (absent).
    assert by_pair[("b", "c")] is None
