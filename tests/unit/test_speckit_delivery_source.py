"""SpeckitDeliverySource: attach-by-Input-line, header counts, and expand-only section parsing."""

from __future__ import annotations

from pathlib import Path

import pytest

from codechroma.requirements.markdown.speckit_source import SpeckitDeliverySource, stage_node_id

FIXTURE_ROOT = Path(__file__).parent.parent / "fixtures" / "requirements_repo"


def test_feature_attaches_to_the_id_named_in_spec_input_line():
    source = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)

    stages = source.stages_for("EP-A-01-01")

    assert {stage.kind for stage in stages} == {
        "spec",
        "plan",
        "tasks",
        "research",
        "data-model",
        "contract-a",
        "contract-b",
        "checklist-requirements",
    }


def test_feature_naming_no_known_id_stays_unattached(tmp_path):
    feature = tmp_path / "specs" / "999-orphan"
    feature.mkdir(parents=True)
    (feature / "spec.md").write_text(
        '**Input**: User description: "no id named here"\n', encoding="utf-8"
    )
    source = SpeckitDeliverySource(tmp_path / "specs", tmp_path)

    stages = source.stages_for("EP-A-01-01")

    assert stages == []


def test_an_id_mentioned_only_in_prose_is_never_mistaken_for_an_attachment(tmp_path):
    feature = tmp_path / "specs" / "999-orphan"
    feature.mkdir(parents=True)
    (feature / "spec.md").write_text(
        '**Input**: User description: "no id named here"\n\nSee also EP-B-02 for background.\n'
, encoding="utf-8")
    source = SpeckitDeliverySource(tmp_path / "specs", tmp_path)

    stages = source.stages_for("EP-B-02")

    assert stages == []


def test_two_features_attaching_to_one_item_both_contribute(tmp_path):
    for slug in ("100-first", "200-second"):
        feature = tmp_path / "specs" / slug
        feature.mkdir(parents=True)
        (feature / "spec.md").write_text(
            '**Input**: User description: "for EP-SHARED-01"\n', encoding="utf-8"
        )
    source = SpeckitDeliverySource(tmp_path / "specs", tmp_path)

    stages = source.stages_for("EP-SHARED-01")

    assert len(stages) == 2


def test_most_specific_id_wins_when_a_feature_names_a_parent_and_a_child(tmp_path):
    feature = tmp_path / "specs" / "001-both"
    feature.mkdir(parents=True)
    (feature / "spec.md").write_text(
        '**Input**: User description: "covers EP-PARENT-01 under EP-PARENT"\n'
, encoding="utf-8")
    source = SpeckitDeliverySource(tmp_path / "specs", tmp_path)

    assert source.stages_for("EP-PARENT-01")
    assert not source.stages_for("EP-PARENT")


def test_task_header_reports_counts_without_parsing_sections():
    source = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)

    stages = source.stages_for("EP-A-01-01")

    tasks = next(stage for stage in stages if stage.kind == "tasks")
    assert (tasks.done, tasks.total) == (3, 4)
    assert tasks.sections == ()


def test_expanding_the_tasks_stage_parses_phases_and_marker_text():
    source = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)
    node_id = stage_node_id("001-first-story-feature", "tasks")

    stages = source.stages_for("EP-A-01-01", expand=node_id)

    tasks = next(stage for stage in stages if stage.kind == "tasks")
    assert [section.title for section in tasks.sections] == ["Phase 1: Setup", "Phase 2: Core"]
    marker_item = tasks.sections[0].items[1]
    assert "[P]" in marker_item.text


def test_deleting_the_tasks_file_removes_its_stage(tmp_path):
    feature = tmp_path / "specs" / "001-first-story-feature"
    feature.mkdir(parents=True)
    (feature / "spec.md").write_text(
        '**Input**: User description: "for EP-A-01-01"\n', encoding="utf-8"
    )
    (feature / "tasks.md").write_text("- [x] T001 one task\n", encoding="utf-8")
    source = SpeckitDeliverySource(tmp_path / "specs", tmp_path)
    assert {stage.kind for stage in source.stages_for("EP-A-01-01")} == {"spec", "tasks"}

    (feature / "tasks.md").unlink()

    assert {stage.kind for stage in source.stages_for("EP-A-01-01")} == {"spec"}


@pytest.mark.parametrize(
    ("kind", "relpath", "content"),
    [
        ("research", "research.md", "# Research\n\n**Status**: Complete\n"),
        ("data-model", "data-model.md", "# Data Model\n\n**Status**: Complete\n"),
        ("quickstart", "quickstart.md", "# Quickstart\n\n**Status**: Complete\n"),
        ("contract-a", "contracts/a.md", "# Contract A\n\n**Status**: Complete\n"),
        ("checklist-req", "checklists/req.md", "## Checklist\n\n- [ ] one\n"),
    ],
)
def test_new_artifact_kind_appears_then_disappears_with_its_file(tmp_path, kind, relpath, content):
    feature = tmp_path / "specs" / "001-x"
    feature.mkdir(parents=True)
    (feature / "spec.md").write_text(
        '**Input**: User description: "for EP-A-01-01"\n', encoding="utf-8"
    )
    artifact = feature / relpath
    artifact.parent.mkdir(parents=True, exist_ok=True)
    artifact.write_text(content, encoding="utf-8")
    source = SpeckitDeliverySource(tmp_path / "specs", tmp_path)
    assert kind in {stage.kind for stage in source.stages_for("EP-A-01-01")}

    artifact.unlink()

    assert kind not in {stage.kind for stage in source.stages_for("EP-A-01-01")}


def test_contract_files_produce_uniquely_named_stage_kinds():
    source = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)

    stages = source.stages_for("EP-A-01-01")

    kinds = {stage.kind for stage in stages}
    assert {"contract-a", "contract-b"}.issubset(kinds)


def test_lmp_style_id_on_a_continuation_line_attaches_via_widened_regex():
    source = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)

    stages = source.stages_for("LMP-123")

    assert {stage.kind for stage in stages} == {"spec", "plan"}


def test_frontmatter_epic_wins_over_any_input_block_id():
    source = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)

    frontmatter_stages = source.stages_for("LMP-999")
    input_block_stages = source.stages_for("EP-OTHER-01") + source.stages_for("EP-OTHER-02")

    assert {stage.kind for stage in frontmatter_stages} == {"spec", "plan"}
    assert input_block_stages == []


def test_widened_regex_id_does_not_spuriously_attach_across_unrelated_features(tmp_path):
    first = tmp_path / "specs" / "100-first"
    first.mkdir(parents=True)
    (first / "spec.md").write_text(
        '**Input**: User description: "Implements FR-001 for EP-SHARED-01"\n'
, encoding="utf-8")
    second = tmp_path / "specs" / "200-second"
    second.mkdir(parents=True)
    (second / "spec.md").write_text(
        '**Input**: User description: "Implements FR-002 for EP-SHARED-02"\n'
, encoding="utf-8")
    source = SpeckitDeliverySource(tmp_path / "specs", tmp_path)

    stages = source.stages_for("FR-001")

    assert {stage.name for stage in stages} == {"100-first"}


def test_expanding_data_model_stage_parses_the_field_table():
    source = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)
    node_id = stage_node_id("001-first-story-feature", "data-model")

    stages = source.stages_for("EP-A-01-01", expand=node_id)

    data_model = next(stage for stage in stages if stage.kind == "data-model")
    items = data_model.sections[0].items
    assert [item.id for item in items] == ["path", "cache_ttl", "strict"]
    assert "—" in items[0].text


def test_expanding_research_stage_parses_bold_leadin_bullets():
    source = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)
    node_id = stage_node_id("001-first-story-feature", "research")

    stages = source.stages_for("EP-A-01-01", expand=node_id)

    research = next(stage for stage in stages if stage.kind == "research")
    item_ids = {item.id for item in research.sections[0].items}
    assert item_ids == {"Caching strategy", "Fallback order"}


def test_checkbox_section_reports_done_total_and_non_checkbox_section_reports_none():
    source = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)
    tasks_node = stage_node_id("001-first-story-feature", "tasks")
    research_node = stage_node_id("001-first-story-feature", "research")

    tasks_stages = source.stages_for("EP-A-01-01", expand=tasks_node)
    research_stages = source.stages_for("EP-A-01-01", expand=research_node)

    tasks = next(stage for stage in tasks_stages if stage.kind == "tasks")
    research = next(stage for stage in research_stages if stage.kind == "research")
    core_section = next(section for section in tasks.sections if section.title == "Phase 2: Core")
    assert (core_section.done, core_section.total) == (1, 2)
    assert (research.sections[0].done, research.sections[0].total) == (None, None)


def test_checklist_stage_section_reports_done_total():
    source = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)
    node_id = stage_node_id("001-first-story-feature", "checklist-requirements")

    stages = source.stages_for("EP-A-01-01", expand=node_id)

    checklist = next(stage for stage in stages if stage.kind == "checklist-requirements")
    assert (checklist.sections[0].done, checklist.sections[0].total) == (2, 3)


def test_wrapped_bold_leadin_paragraph_joins_its_continuation_lines(tmp_path):
    # A bare bold-leadin paragraph that wraps across lines must read as one item with the wrapped
    # lines joined, not be cut to its first line (008-model-shaped-serving-units regression).
    feature = tmp_path / "specs" / "002-wrapped"
    feature.mkdir(parents=True)
    (feature / "spec.md").write_text(
        '**Input**: User description: "for EP-C-03-03"\n', encoding="utf-8"
    )
    continuation = (
        "**Structure Decision**: single project, extending the existing `servingunits` package in\n"
        "the application repo's Go service core. The model-hardware-fit is a cross-repo call,\n"
        "modeled as a port so nobody blocks.\n"
    )
    (feature / "plan.md").write_text(
        f"## Project Structure\n\n{continuation}\n\n## Other\n", encoding="utf-8"
    )
    source = SpeckitDeliverySource(tmp_path / "specs", tmp_path)
    node_id = stage_node_id("002-wrapped", "plan")

    stages = source.stages_for("EP-C-03-03", expand=node_id)

    plan = next(stage for stage in stages if stage.kind == "plan")
    section = next(section for section in plan.sections if section.title == "Project Structure")
    assert len(section.items) == 1
    assert section.items[0].text == (
        "**Structure Decision**: single project, extending the existing `servingunits` package in "
        "the application repo's Go service core. The model-hardware-fit is a cross-repo call, "
        "modeled as a port so nobody blocks."
    )


def test_wrapped_checklist_task_joins_its_continuation_lines(tmp_path):
    # A checklist task that wraps across lines must read as one item with the wrapped lines joined,
    # never cut to its first line (LMP-123 regression: T013 truncated at "reads `fits: false`,").
    feature = tmp_path / "specs" / "003-wrapped-check"
    feature.mkdir(parents=True)
    (feature / "spec.md").write_text(
        '**Input**: User description: "for EP-D-04-04"\n', encoding="utf-8"
    )
    task = (
        "- [ ] T013 [P] [US2] Test: every candidate undersized → every `ShapeFitResult` reads "
        "`fits: false`,\n"
        "      each with `excluded_reason`, and `AssessShapes` returns no error — in\n"
        "      `internal/modelfit/assess_shapes_test.go`\n"
    )
    (feature / "tasks.md").write_text(f"## Phase 1\n\n{task}\n", encoding="utf-8")
    source = SpeckitDeliverySource(tmp_path / "specs", tmp_path)
    node_id = stage_node_id("003-wrapped-check", "tasks")

    stages = source.stages_for("EP-D-04-04", expand=node_id)

    tasks = next(stage for stage in stages if stage.kind == "tasks")
    item = tasks.sections[0].items[0]
    assert item.id == "T013"
    assert item.text == (
        "T013 [P] [US2] Test: every candidate undersized → every `ShapeFitResult` reads "
        "`fits: false`, each with `excluded_reason`, and `AssessShapes` returns no error — in "
        "`internal/modelfit/assess_shapes_test.go`"
    )


def test_parallel_and_story_markers_parse_from_item_text(tmp_path):
    feature = tmp_path / "specs" / "001-marked"
    feature.mkdir(parents=True)
    (feature / "spec.md").write_text(
        '**Input**: User description: "for EP-A-01-01"\n', encoding="utf-8"
    )
    (feature / "tasks.md").write_text(
        "## Phase 1\n\n- [ ] T003 [P] [US1] do the thing\n", encoding="utf-8"
    )
    source = SpeckitDeliverySource(tmp_path / "specs", tmp_path)
    node_id = stage_node_id("001-marked", "tasks")

    stages = source.stages_for("EP-A-01-01", expand=node_id)

    tasks = next(stage for stage in stages if stage.kind == "tasks")
    item = tasks.sections[0].items[0]
    assert (item.parallel, item.story) == (True, "US1")


def test_editing_the_older_attach_source_file_invalidates_the_cache(tmp_path):
    # The cache key is the (spec.md, plan.md) mtime pair -- NOT their max. Editing the OLDER of the
    # two files (so only its mtime changes, the newer one's stays) must still invalidate; a single
    # max() key would silently keep serving the stale attach set.
    feature = tmp_path / "specs" / "001-cache"
    feature.mkdir(parents=True)
    spec = feature / "spec.md"
    plan = feature / "plan.md"
    spec.write_text('**Input**: User description: "for EP-A-01-01"\n', encoding="utf-8")
    plan.write_text('**Input**: User description: "for EP-B-02-02"\n', encoding="utf-8")
    source = SpeckitDeliverySource(tmp_path / "specs", tmp_path)
    assert source.stages_for("EP-A-01-01")

    # Force plan.md (the newer attach source) to have a LATER mtime than spec.md.
    import os
    spec_mtime = spec.stat().st_mtime
    os.utime(plan, (spec_mtime + 10, spec_mtime + 10))

    # Editing only spec.md -- the older file -- must invalidate the cache and drop the stale attach.
    spec.write_text('**Input**: User description: "no id named here"\n', encoding="utf-8")
    assert source.stages_for("EP-A-01-01") == []
