"""SourceRegistry + the adapter conformance checklist (contracts/ports.md)."""

from __future__ import annotations

from pathlib import Path

from codechroma.requirements.markdown.epic_source import MarkdownRequirementsSource
from codechroma.requirements.markdown.speckit_source import SpeckitDeliverySource
from codechroma.requirements.source import (
    CompositeDeliverySource,
    DeliverySource,
    RequirementsSource,
    SourceRegistry,
)

FIXTURE_ROOT = Path(__file__).parent.parent / "fixtures" / "requirements_repo"


def test_for_uri_resolves_a_file_scheme_to_markdown_source():
    registry = SourceRegistry.with_defaults()

    source = registry.for_uri("file://plan/epics", FIXTURE_ROOT)

    assert isinstance(source, MarkdownRequirementsSource)
    assert isinstance(source, RequirementsSource)


def test_for_uri_unknown_scheme_returns_none_not_raise():
    registry = SourceRegistry.with_defaults()

    source = registry.for_uri("jira://LMP?initiative=TI-886", FIXTURE_ROOT)

    assert source is None


def test_delivery_for_uri_resolves_a_file_scheme_to_speckit_source():
    registry = SourceRegistry.with_defaults()

    source = registry.delivery_for_uri("file://specs", FIXTURE_ROOT)

    assert isinstance(source, SpeckitDeliverySource)
    assert isinstance(source, DeliverySource)


def test_markdown_adapter_conforms_to_the_checklist():
    source = MarkdownRequirementsSource(FIXTURE_ROOT / "plan" / "epics", FIXTURE_ROOT)

    assert source.scheme == "file"
    assert isinstance(source, RequirementsSource)
    assert source.fetch_item("does-not-exist") is None
    fingerprint_before = source.fingerprint()
    assert source.fingerprint() == fingerprint_before


def test_speckit_adapter_stages_never_prefill_sections():
    source = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)

    stages = source.stages_for("EP-A-01-01")

    assert stages
    assert all(stage.sections == () for stage in stages)


def test_composite_delivery_source_concatenates_members_in_order():
    first = SpeckitDeliverySource(FIXTURE_ROOT / "specs", FIXTURE_ROOT)
    empty = SpeckitDeliverySource(FIXTURE_ROOT / "no-such-dir", FIXTURE_ROOT)
    composite = CompositeDeliverySource([first, empty])

    stages = composite.stages_for("EP-A-01-01")

    assert [stage.kind for stage in stages][:3] == ["spec", "plan", "tasks"]
    assert len(stages) > 3  # 001-first-story-feature also carries research/data-model/etc.
