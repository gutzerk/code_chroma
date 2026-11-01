"""wiki_general_naming.py: deterministic id/name assignment, generalized for generate + update."""

import pytest

from codechroma.bridge.wiki_general_naming import assign_ids, dedupe_id, deterministic_name, slugify


@pytest.mark.parametrize(
    ("text", "expected"), [("Auth & Billing!!", "auth-billing"), ("###", "group")]
)
def test_slugify_dashes_hostile_text_and_falls_back_to_group(text, expected):
    assert slugify(text) == expected


@pytest.mark.parametrize(("taken", "expected"), [(set(), "auth"), ({"auth", "auth-2"}, "auth-3")])
def test_dedupe_id_appends_a_counter_only_on_collision(taken, expected):
    assert dedupe_id("auth", taken) == expected


def test_deterministic_name_picks_heaviest_parent_folder_for_component():
    real_id, display = deterministic_name(
        ["app/auth/login.py", "app/auth/tokens.py", "app/billing/plans.py"], top_level=False
    )

    assert (real_id, display) == ("auth", "Auth")


def test_deterministic_name_picks_heaviest_top_level_folder_for_container():
    files = ["backend/app.py", "backend/db.py", "web/App.tsx"]

    real_id, display = deterministic_name(files, top_level=True)

    assert (real_id, display) == ("backend", "Backend")


def test_assign_ids_dedupes_same_name_across_groups():
    groups = [
        ("cluster-1", ["app/auth/login.py"]),
        ("cluster-2", ["lib/auth/login.py"]),
    ]

    resolved = assign_ids(groups, top_level=False)

    assert resolved["cluster-1"][0] == "auth"
    assert resolved["cluster-2"][0] == "auth-2"
