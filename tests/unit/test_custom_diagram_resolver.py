"""Unit coverage for grouping_enabled: a custom type's own author-chosen grouping toggle."""

import pytest

from codechroma.bridge.custom_diagram_resolver import grouping_enabled

_DEFINITION = {"id": "flow", "style": "boxes-arrows", "grouping": {"enabled": True}}


def test_enabled_when_the_style_supports_groups_and_the_definition_wants_them():
    assert grouping_enabled(_DEFINITION) is True


@pytest.mark.parametrize(
    "definition",
    [
        {**_DEFINITION, "grouping": {"enabled": False}},
        {**_DEFINITION, "style": "state-machine"},
        {"id": "flow", "style": "boxes-arrows"},
        {**_DEFINITION, "style": "not-a-real-style"},
    ],
    ids=[
        "definition-turns-grouping-off",
        "style-does-not-support-groups",
        "no-grouping-key",
        "unknown-style",
    ],
)
def test_disabled(definition):
    assert grouping_enabled(definition) is False
