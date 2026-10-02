"""EpicsAssembler: caps + omitted count, missing-source handling, and reference dedupe (D-14)."""

from __future__ import annotations

from pathlib import Path

from codechroma.config import RequirementsConfig
from codechroma.requirements.assembler import EpicsAssembler
from codechroma.requirements.markdown.epic_source import MarkdownRequirementsSource
from codechroma.requirements.markdown.speckit_source import SpeckitDeliverySource, stage_node_id

FIXTURE_ROOT = Path(__file__).parent.parent / "fixtures" / "requirements_repo"


def _assembler(config: RequirementsConfig | None = None) -> EpicsAssembler:
    requirements = MarkdownRequirementsSource(FIXTURE_ROOT / "plan" / "epics", FIXTURE_ROOT)
    delivery = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)
    return EpicsAssembler(
        requirements=requirements,
        delivery=delivery,
        config=config or RequirementsConfig(),
        source_uri="file://plan/epics",
    )


def test_index_reports_no_omitted_items_under_the_cap():
    index = _assembler().index()

    assert index["omitted"] == 0
    assert len(index["items"]) == 5


def test_index_caps_at_max_items_and_reports_omitted():
    index = _assembler(RequirementsConfig(max_items=2)).index()

    assert len(index["items"]) == 2
    assert index["omitted"] == 3


def test_index_never_carries_body_fields():
    index = _assembler().index()

    for item in index["items"]:
        assert set(item) == {"id", "title", "status", "kind", "group"}


def test_missing_source_directory_returns_empty_index_not_error(tmp_path):
    requirements = MarkdownRequirementsSource(tmp_path / "does-not-exist", tmp_path)
    assembler = EpicsAssembler(
        requirements=requirements, delivery=None, config=RequirementsConfig(), source_uri="x"
    )

    index = assembler.index()

    assert index["items"] == []
    assert index["omitted"] == 0


def test_item_caps_requirements_per_item():
    assembler = _assembler(RequirementsConfig(max_requirements_per_item=1))

    item = assembler.item("EP-A-01")

    assert len(item["requirements"]) == 1


def test_unknown_item_id_returns_none():
    item = _assembler().item("NOPE")

    assert item is None


def test_serialized_item_carries_references_context_and_component_keys():
    item = _assembler().item("EP-A-01")

    assert "references" in item
    assert "context_file" in item
    assert "component" in item


def test_link_resolving_to_an_existing_index_id_is_marked_in_index():
    item = _assembler().item("EP-A-02")

    links_by_id = {link["id"]: link for link in item["links"]}
    assert links_by_id["EP-A-01"]["in_index"] is True


def test_link_to_an_unmatched_id_is_not_marked_in_index():
    item = _assembler().item("EP-A-02")

    links_by_id = {link["id"]: link for link in item["links"]}
    assert links_by_id["EP-Z-99"]["in_index"] is False


def test_item_stage_serialization_carries_story_parallel_done_total_end_to_end():
    node_id = stage_node_id("001-first-story-feature", "tasks")

    item = _assembler().item("EP-A-01-01", expand=node_id)

    tasks_stage = next(stage for stage in item["stages"] if stage["kind"] == "tasks")
    core_section = next(sec for sec in tasks_stage["sections"] if sec["title"] == "Phase 2: Core")
    marker_item = tasks_stage["sections"][0]["items"][1]
    assert set(core_section) == {"title", "items", "done", "total"}
    assert (core_section["done"], core_section["total"]) == (1, 2)
    assert set(marker_item) == {"id", "text", "done", "story", "parallel"}
    assert marker_item["parallel"] is True
