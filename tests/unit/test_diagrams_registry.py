"""The declarative `DiagramTypeDefinition` registry: built-ins plus synthesized custom types."""

import pytest

from codechroma.diagrams import library
from codechroma.diagrams.registry import BUILTIN_TYPES, get_definition


@pytest.fixture(autouse=True)
def isolated_library(tmp_path, monkeypatch):
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))


def test_every_builtin_kind_resolves_to_its_own_definition():
    for kind in ("c1", "patterns", "impact"):
        definition = get_definition(kind)
        assert definition is not None
        assert definition.id == kind


def test_c1_has_no_generation_data_provider_and_no_longer_opts_into_coverage():
    """042: flat c1 has no sub-blocks for coverage; see check_bare_actors."""
    definition = BUILTIN_TYPES["c1"]

    assert definition.context is None
    assert definition.addons["coverage"] is False
    assert definition.checks.check_bare_actors is False


def test_patterns_names_its_context_provider_and_opts_into_staleness():
    definition = BUILTIN_TYPES["patterns"]

    assert definition.context == "patterns"
    assert definition.addons["staleness"] is True


def test_c1_has_no_review_or_changes_overlay():
    """The review axis moved to impact, and the plan overlay was retired -- c1 has neither."""
    definition = BUILTIN_TYPES["c1"]

    assert definition.review is None
    assert definition.overlays == []


def test_impact_has_the_explanatory_review_and_changes_overlay():
    definition = BUILTIN_TYPES["impact"]

    assert definition.review.axis == "explanatory"
    assert definition.review.agent_factory == "impact-changes"
    assert definition.overlays == ["changes"]


def test_unknown_kind_returns_none():
    assert get_definition("not-a-kind") is None


def test_unsaved_custom_kind_returns_none():
    assert get_definition("custom/nope") is None


def test_saved_custom_type_synthesizes_a_definition_with_fr011_defaults():
    library.save_type(
        {
            "id": "data-flow",
            "title": "Data flow",
            "style": "boxes-arrows",
            "layout": {"direction": "LR"},
            "grouping": {"enabled": False},
            "relation_kinds": [],
            "instructions": "One box per component.",
        }
    )

    definition = get_definition("custom/data-flow")

    assert definition is not None
    assert definition.id == "custom/data-flow"
    assert definition.context is None
    assert definition.overlays == []
    assert definition.review is None
    assert definition.addons == {"coverage": False, "staleness": False, "grouping": False}


def test_saved_custom_type_carries_through_its_own_overlays_and_context():
    library.save_type(
        {
            "id": "data-flow",
            "title": "Data flow",
            "style": "boxes-arrows",
            "layout": {"direction": "LR"},
            "grouping": {"enabled": False},
            "relation_kinds": [],
            "instructions": "One box per component.",
            "context": "patterns",
            "overlays": ["changes"],
            "addons": {"coverage": True},
        }
    )

    definition = get_definition("custom/data-flow")

    assert definition.context == "patterns"
    assert definition.overlays == ["changes"]
    assert definition.addons["coverage"] is True
    assert definition.addons["staleness"] is False
