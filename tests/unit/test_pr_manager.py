"""prs.json: round-tripping, the cap, dropping junk, and flagging a vanished worktree."""

import json

import pytest

from codechroma.bridge.prs.manager import (
    PrLimitError,
    PrManager,
    PrRecord,
    UnknownPrError,
    max_pr_workspaces,
)


def _record(number: int, worktree: str, **overrides) -> PrRecord:
    fields = {
        "number": number,
        "title": f"PR {number}",
        "url": f"https://github.com/acme/app/pull/{number}",
        "head_ref": "feature/refunds",
        "head_sha": "abc1234",
        "base_ref": "main",
        "worktree": worktree,
        "imported_at": "2026-07-29T12:00:00Z",
        "fetched_at": "2026-07-29T12:00:00Z",
        **overrides,
    }
    return PrRecord(**fields)


@pytest.fixture
def manager(tmp_path):
    return PrManager(tmp_path / "repo")


def test_the_registry_lives_in_the_main_repository(tmp_path):
    created = PrManager(tmp_path / "repo")

    assert created.registry_path == (tmp_path / "repo" / ".codechroma" / "prs.json").resolve()


def test_an_id_is_derived_from_the_number_not_stored():
    record = _record(12, "/repo/.codechroma/worktrees/pr-12")

    assert record.id == "pr-12"
    assert "id" not in record.to_json()


def test_a_record_round_trips_through_disk(manager, tmp_path):
    manager.upsert(_record(12, str(tmp_path / "wt"), is_fork=True, changed_files=7))

    reloaded = PrManager(tmp_path / "repo")

    assert reloaded.get(12).is_fork
    assert reloaded.get(12).changed_files == 7
    assert reloaded.get(12).head_sha == "abc1234"


def test_an_unknown_number_raises(manager):
    with pytest.raises(UnknownPrError):
        manager.get(99)


def test_find_admits_ignorance_instead_of_raising(manager):
    assert manager.find(99) is None


def test_unknown_keys_on_disk_are_dropped(tmp_path):
    path = tmp_path / "repo" / ".codechroma" / "prs.json"
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps({"version": 1, "prs": [{"number": 12, "worktree": "/wt", "kind": "pr"}]})
, encoding="utf-8")

    loaded = PrManager(tmp_path / "repo")

    assert loaded.get(12).number == 12
    assert not hasattr(loaded.get(12), "kind")


@pytest.mark.parametrize(
    "entry",
    [
        {"worktree": "/wt"},
        {"number": "12", "worktree": "/wt"},
        {"number": True, "worktree": "/wt"},
        {"number": 0, "worktree": "/wt"},
        {"number": -1, "worktree": "/wt"},
        {"number": 12},
        {"number": 12, "worktree": ""},
        "not a dict",
    ],
)
def test_an_untrustworthy_entry_is_skipped(tmp_path, entry):
    path = tmp_path / "repo" / ".codechroma" / "prs.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"version": 1, "prs": [entry]}), encoding="utf-8")

    loaded = PrManager(tmp_path / "repo")

    assert loaded.list() == []


def test_a_malformed_registry_file_degrades_to_no_reviews(tmp_path):
    path = tmp_path / "repo" / ".codechroma" / "prs.json"
    path.parent.mkdir(parents=True)
    path.write_text("{ not json", encoding="utf-8")

    loaded = PrManager(tmp_path / "repo")

    assert loaded.list() == []


def test_the_cap_refuses_one_more_review(manager, tmp_path):
    for number in range(1, max_pr_workspaces() + 1):
        manager.upsert(_record(number, str(tmp_path / f"wt-{number}")))

    with pytest.raises(PrLimitError):
        manager.upsert(_record(99, str(tmp_path / "wt-99")))


def test_refetching_an_open_review_is_not_capped(manager, tmp_path):
    for number in range(1, max_pr_workspaces() + 1):
        manager.upsert(_record(number, str(tmp_path / f"wt-{number}")))

    updated = manager.upsert(_record(1, str(tmp_path / "wt-1"), head_sha="def5678"))

    assert updated.head_sha == "def5678"
    assert len(manager.list()) == max_pr_workspaces()


def test_deleting_frees_a_slot(manager, tmp_path):
    for number in range(1, max_pr_workspaces() + 1):
        manager.upsert(_record(number, str(tmp_path / f"wt-{number}")))

    manager.delete(1)

    assert not manager.at_capacity()
    assert manager.find(1) is None


def test_deleting_an_unknown_number_raises(manager):
    with pytest.raises(UnknownPrError):
        manager.delete(99)


def test_reconcile_flags_a_hand_deleted_worktree_instead_of_dropping_the_card(manager, tmp_path):
    manager.upsert(_record(12, str(tmp_path / "gone")))

    manager.reconcile()

    assert manager.get(12).worktree_lost
    assert manager.find(12) is not None


def test_reconcile_leaves_a_present_worktree_alone(manager, tmp_path):
    present = tmp_path / "present"
    present.mkdir()
    manager.upsert(_record(12, str(present)))

    manager.reconcile()

    assert not manager.get(12).worktree_lost


def test_reconcile_backfills_canvas_doc_for_a_pr_imported_before_seeding_existed(manager, tmp_path):
    canvas = tmp_path / "repo" / ".codechroma" / "canvas-core.json"
    canvas.parent.mkdir(parents=True)
    canvas.write_text('{"elements": {"root": {}}}', encoding="utf-8")
    present = tmp_path / "present"
    present.mkdir()
    manager.upsert(_record(12, str(present)))

    manager.reconcile()

    canvas_core = present / ".codechroma" / "canvas-core.json"
    assert canvas_core.read_text(encoding="utf-8") == '{"elements": {"root": {}}}'


def test_the_payload_carries_the_id_and_the_runtime_flag(manager, tmp_path):
    manager.upsert(_record(12, str(tmp_path / "gone")))
    manager.reconcile()

    payload = manager.get(12).to_payload()

    assert payload["id"] == "pr-12"
    assert payload["worktree_lost"] is True


def test_the_registry_never_records_the_active_workspace(manager, tmp_path):
    manager.upsert(_record(12, str(tmp_path / "wt")))

    written = json.loads(manager.registry_path.read_text(encoding="utf-8"))

    assert set(written) == {"version", "prs"}


def test_comments_round_trip_through_disk(manager, tmp_path):
    review_comments = [{"author": "jane", "body": "Why?", "path": "a.py", "line": 1}]
    general_comments = [{"author": "jane", "body": "LGTM", "path": None, "line": None}]
    manager.upsert(
        _record(
            12,
            str(tmp_path / "wt"),
            review_comments=review_comments,
            general_comments=general_comments,
        )
    )

    reloaded = PrManager(tmp_path / "repo")

    assert reloaded.get(12).review_comments == review_comments
    assert reloaded.get(12).general_comments == general_comments


def test_a_malformed_comments_field_degrades_to_empty(tmp_path):
    path = tmp_path / "repo" / ".codechroma" / "prs.json"
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {"version": 1, "prs": [{"number": 12, "worktree": "/wt", "review_comments": "nope"}]}
        )
, encoding="utf-8")

    loaded = PrManager(tmp_path / "repo")

    assert loaded.get(12).review_comments == []
