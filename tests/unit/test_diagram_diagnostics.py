"""Unit coverage for Diagnostics: the drop record, the reported cap, and merging two stages."""

from __future__ import annotations

import pytest

from codechroma.bridge.diagram_diagnostics import (
    REASONS,
    Diagnostics,
    entries_are_usable,
    merge_dropped,
)
from codechroma.config import settings


def test_a_recorded_drop_names_what_reason_and_detail():
    notes = Diagnostics()

    notes.drop("node", "pg-client", "unresolved_path", "src/db/pg.py")

    assert notes.as_payload()["dropped"] == [
        {"what": "node", "id": "pg-client", "reason": "unresolved_path", "detail": "src/db/pg.py"}
    ]


def test_an_empty_run_reports_nothing_dropped():
    payload = Diagnostics().as_payload()

    assert payload == {"dropped": [], "dropped_count": 0, "shown": 0, "truncated": False}


def test_a_non_string_id_becomes_null_so_the_payload_stays_json_safe():
    notes = Diagnostics()

    notes.drop("node", {"unhashable": True}, "invalid_shape")

    assert notes.as_payload()["dropped"][0]["id"] is None


def test_the_cap_reports_the_total_it_hid_rather_than_reading_as_complete():
    # 🔴 Silent truncation reads as complete coverage; dropped_count is what makes the cap honest.
    notes = Diagnostics()
    over_cap = settings.diagram_diagnostics.max_reported + 5
    for index in range(over_cap):
        notes.drop("relation", f"r{index}", "dangling_endpoint")

    payload = notes.as_payload()

    assert payload["shown"] == settings.diagram_diagnostics.max_reported
    assert payload["dropped_count"] == over_cap
    assert payload["truncated"] is True


def test_merging_two_stages_keeps_both_lists_and_the_summed_total():
    resolver = Diagnostics()
    resolver.drop("node", "a", "invalid_shape")
    recipe = Diagnostics()
    recipe.drop("relation", "a -> b", "dangling_endpoint")

    merged = merge_dropped(resolver.as_payload(), recipe.as_payload())

    assert merged["dropped_count"] == 2
    assert {entry["reason"] for entry in merged["dropped"]} == {
        "invalid_shape",
        "dangling_endpoint",
    }


def test_merging_trusts_a_stage_count_so_an_already_capped_input_is_not_undercounted():
    already_capped = {"dropped": [{"what": "node", "id": "a", "reason": "invalid_shape"}],
                      "dropped_count": 40, "shown": 1, "truncated": True}

    merged = merge_dropped(already_capped)

    assert merged["dropped_count"] == 40


@pytest.mark.parametrize("payload", [None, "nope", 7, []])
def test_merging_ignores_a_stage_that_reported_no_payload_at_all(payload):
    merged = merge_dropped(payload)

    assert merged["dropped_count"] == 0


def test_every_reason_a_resolver_uses_is_in_the_closed_vocabulary():
    # The web groups by these slugs, so a typo'd reason must fail here, not render as a blank label.
    assert "unresolved_path" in REASONS
    assert "dangling_endpoint" in REASONS
    assert len(set(REASONS)) == len(REASONS)


def test_an_absent_or_empty_list_stays_usable_so_clearing_a_diagram_keeps_working():
    # ⚠ Writing an empty shape is the documented way to clear a diagram, not a failure.
    assert entries_are_usable({}, "nodes") is True
    assert entries_are_usable({"nodes": []}, "nodes") is True


def test_a_list_where_no_entry_has_a_string_id_is_not_usable():
    # 🔴 `{"nodes": [{"foo": 1}]}` passed the old check, reported a clean run, resolved to zero.
    assert entries_are_usable({"nodes": [{"foo": 1}, "junk"]}, "nodes") is False


def test_one_usable_entry_among_broken_ones_is_enough():
    assert entries_are_usable({"nodes": [{"foo": 1}, {"id": "a"}]}, "nodes") is True
