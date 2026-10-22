"""The draw skill's router must not send named non-sequence diagrams to the sequence row."""

from pathlib import Path

import pytest

ROUTER = Path(__file__).resolve().parents[2] / "skills" / "codechroma-draw-diagram" / "SKILL.md"


@pytest.fixture
def router_text():
    return ROUTER.read_text(encoding="utf-8")


def test_router_says_to_draw_the_type_the_user_named(router_text):
    named_rule = "Never substitute a different type"

    assert named_rule in router_text


def test_router_says_data_flow_is_never_sequence(router_text):
    data_flow_rule = "is **never** `sequence`"

    assert data_flow_rule in router_text


def test_sequence_row_no_longer_claims_any_request_flow(router_text):
    old_triggers = ['"show me how a request is handled"', "Any mention of a trace flow"]

    assert not any(trigger in router_text for trigger in old_triggers)
