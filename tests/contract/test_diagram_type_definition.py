"""Contract: `DiagramTypeDefinition` -- new declarative fields, FR-011's safe defaults, and
membership checks against a caller-supplied set of known provider/agent names (037,
contracts/diagram-type-definition.md).
"""

from __future__ import annotations

import pytest

from codechroma.diagrams import library
from codechroma.diagrams.registry import CheckConfig, get_definition


@pytest.fixture(autouse=True)
def _isolated_library(tmp_path, monkeypatch):
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))


def _base_definition(**overrides) -> dict:
    return {
        "id": "data-flow",
        "title": "Data flow",
        "style": "boxes-arrows",
        "layout": {"direction": "LR"},
        "grouping": {"enabled": False},
        "relation_kinds": [],
        "instructions": "One box per component that owns or moves data.",
        **overrides,
    }


def test_every_builtin_carries_a_full_check_config():
    for kind in ("c1", "patterns", "impact"):
        definition = get_definition(kind)
        assert isinstance(definition.checks, CheckConfig)
        assert definition.checks.shape in ("hierarchical", "flat")


def test_style_accepts_a_catalog_name_or_an_inline_dict():
    assert library.validate_definition(_base_definition(style="boxes-arrows")) == []
    assert library.validate_definition(_base_definition(style={"supports_groups": True})) == []
    assert library.validate_definition(_base_definition(style="not-a-style")) != []


def test_context_is_optional_and_membership_checked_when_a_known_set_is_given():
    assert library.validate_definition(_base_definition()) == []
    ok = library.validate_definition(
        _base_definition(context="patterns"), known_context_providers={"patterns", "impact"}
    )
    bad = library.validate_definition(
        _base_definition(context="bogus"), known_context_providers={"patterns", "impact"}
    )
    assert ok == []
    assert bad != []


def test_overlays_default_to_empty_and_are_membership_checked_when_known():
    default = _base_definition()
    assert "overlays" not in default
    assert library.validate_definition(default) == []
    bad = library.validate_definition(
        _base_definition(overlays=["not-registered"]), known_overlay_providers={"changes"}
    )
    assert bad != []


def test_review_defaults_to_null_and_is_shape_checked_when_present():
    assert library.validate_definition(_base_definition()) == []
    bad = library.validate_definition(
        _base_definition(review={"axis": "vibes", "agent_factory": "x"})
    )
    assert bad != []


def test_checks_shape_must_be_hierarchical_or_flat_when_present():
    assert library.validate_definition(_base_definition(checks={"shape": "flat"})) == []
    assert library.validate_definition(_base_definition(checks={"shape": "nested"})) != []


def test_a_pre_037_definition_with_none_of_the_new_fields_still_validates():
    """FR-011: an existing `~/.codechroma/diagram-types/*.json` file keeps working unchanged."""
    legacy = _base_definition()
    assert set(legacy) & {"artifact", "context", "addons", "overlays", "review", "checks"} == set()

    assert library.validate_definition(legacy) == []
    saved = library.save_type(legacy)
    definition = get_definition(f"custom/{saved['id']}")

    assert definition.context is None
    assert definition.overlays == []
    assert definition.review is None
    assert definition.addons == {"coverage": False, "staleness": False, "grouping": False}
