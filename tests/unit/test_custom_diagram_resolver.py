"""Unit coverage for grouping_enabled: a custom type's own author-chosen grouping toggle."""

from codechroma.bridge.custom_diagram_resolver import grouping_enabled

_DEFINITION = {"id": "flow", "style": "boxes-arrows", "grouping": {"enabled": True}}


def test_enabled_when_the_style_supports_groups_and_the_definition_wants_them():
    assert grouping_enabled(_DEFINITION) is True


def test_disabled_when_the_definition_turns_grouping_off():
    definition = {**_DEFINITION, "grouping": {"enabled": False}}

    assert grouping_enabled(definition) is False


def test_disabled_when_the_style_does_not_support_groups_even_if_the_definition_wants_them():
    definition = {**_DEFINITION, "style": "state-machine"}

    assert grouping_enabled(definition) is False


def test_disabled_with_no_grouping_key_at_all():
    definition = {"id": "flow", "style": "boxes-arrows"}

    assert grouping_enabled(definition) is False


def test_disabled_for_an_unknown_style():
    definition = {**_DEFINITION, "style": "not-a-real-style"}

    assert grouping_enabled(definition) is False
