"""wiki_general_naming.py: deterministic id/name assignment, generalized for generate + update."""

from codechroma.bridge.wiki_general_naming import assign_ids, dedupe_id, deterministic_name, slugify


def test_slugify_lowercases_and_dashes_hostile_text():
    result = slugify("Auth & Billing!!")

    assert result == "auth-billing"


def test_slugify_falls_back_to_group_for_empty_input():
    result = slugify("###")

    assert result == "group"


def test_dedupe_id_returns_candidate_when_free():
    result = dedupe_id("auth", set())

    assert result == "auth"


def test_dedupe_id_appends_counter_on_collision():
    result = dedupe_id("auth", {"auth", "auth-2"})

    assert result == "auth-3"


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
