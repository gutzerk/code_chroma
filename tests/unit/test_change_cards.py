"""Change cards over a real analyzed repository: where each change pins, and what pins nowhere."""

import shutil
import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.change_cards import (
    REASON_BINARY,
    REASON_NO_NODE,
    _by_node_status,
    build_change_cards,
)
from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    _git(root, "init")
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    _git(root, "add", "-A")
    _git(root, "commit", "-m", "initial")
    return root


@pytest.fixture
def engine(repo):
    built = GraphEngine(summarizer=AISummarizer())
    built.analyze(str(repo))
    return built


def _reanalyze(engine: GraphEngine, *paths: str) -> None:
    engine.reanalyze(list(paths))


def _cards_for(payload: dict, node_id: str) -> list[dict]:
    return [card for card in payload["cards"] if card["node_id"] == node_id]


def test_an_edited_function_pins_to_its_own_node(repo, engine):
    path = repo / "shared" / "text_utils.py"
    path.write_text(
        path.read_text(encoding="utf-8").replace('" ", "-"', '" ", "_"'), encoding="utf-8"
    )
    _reanalyze(engine, "shared/text_utils.py")

    payload = build_change_cards(engine, repo)

    card = _cards_for(payload, "shared/text_utils.py::function::slugify")[0]
    assert card["kind"] == "modify"
    assert card["status"] == "modified"
    assert card["resolution"] == "exact"
    assert card["target"] == "function"
    assert card["symbol"] == "slugify"
    assert card["text"] == "Modified slugify"


def test_the_line_counts_describe_the_edit(repo, engine):
    path = repo / "shared" / "text_utils.py"
    path.write_text(
        path.read_text(encoding="utf-8").replace('" ", "-"', '" ", "_"'), encoding="utf-8"
    )
    _reanalyze(engine, "shared/text_utils.py")

    payload = build_change_cards(engine, repo)

    card = _cards_for(payload, "shared/text_utils.py::function::slugify")[0]
    assert (card["added_lines"], card["removed_lines"]) == (1, 1)


def test_two_deleted_methods_share_their_class_block_and_the_count_shows_it(repo, engine):
    path = repo / "users" / "service.py"
    source = path.read_text(encoding="utf-8")
    kept = source.split("    def create_user")[0] + source.split("def list_active_users")[1]
    path.write_text(
        kept.replace("(service: UserService) -> list:", "() -> list:"), encoding="utf-8"
    )
    _reanalyze(engine, "users/service.py")

    payload = build_change_cards(engine, repo)

    class_node = "users/service.py::class::UserService"
    on_class = _cards_for(payload, class_node)
    assert payload["by_node"][class_node] == 2
    assert {card["name"] for card in on_class} == {"create_user", "get_user"}
    assert {card["symbol"] for card in on_class} == {
        "UserService.create_user", "UserService.get_user"
    }
    assert all(card["resolution"] == "parent" for card in on_class)
    assert all(card["kind"] == "delete" for card in on_class)


def test_a_deleted_module_level_function_lands_on_its_file(repo, engine):
    path = repo / "users" / "service.py"
    path.write_text(
        path.read_text(encoding="utf-8").split("def list_active_users")[0], encoding="utf-8"
    )
    _reanalyze(engine, "users/service.py")

    payload = build_change_cards(engine, repo)

    on_file = _cards_for(payload, "component::users/service.py")
    # The deleted module-level function pins onto its file, and the file itself (which changed by
    # the removal) now carries its own modified file card too — so the file box shows both.
    assert "service.py" in [card["name"] for card in on_file]
    deleted = [card for card in on_file if card["name"] == "list_active_users"]
    assert deleted and deleted[0]["resolution"] == "parent"


def test_a_deleted_function_is_named_and_marked_delete(repo, engine):
    path = repo / "users" / "service.py"
    path.write_text(
        path.read_text(encoding="utf-8").split("def list_active_users")[0], encoding="utf-8"
    )
    _reanalyze(engine, "users/service.py")

    payload = build_change_cards(engine, repo)

    deleted = [card for card in payload["cards"] if card["name"] == "list_active_users"]
    assert deleted[0]["kind"] == "delete"
    assert deleted[0]["text"] == "Deleted list_active_users"


def test_by_node_status_reports_added_for_a_new_file(repo, engine):
    (repo / "refunds").mkdir()
    (repo / "refunds" / "service.py").write_text(
        "def issue_refund():\n    return 1\n", encoding="utf-8"
    )
    _reanalyze(engine, "refunds/service.py")

    payload = build_change_cards(engine, repo)

    added = [card for card in payload["cards"] if card["file"] == "refunds/service.py"]
    assert payload["by_node_status"][added[0]["node_id"]] == "added"


def test_by_node_status_translates_deleted_cards_to_removed(repo, engine):
    path = repo / "users" / "service.py"
    source = path.read_text(encoding="utf-8")
    kept = source.split("    def create_user")[0] + source.split("def list_active_users")[1]
    path.write_text(
        kept.replace("(service: UserService) -> list:", "() -> list:"), encoding="utf-8"
    )
    _reanalyze(engine, "users/service.py")

    payload = build_change_cards(engine, repo)

    class_node = "users/service.py::class::UserService"
    assert payload["by_node_status"][class_node] == "removed"


def test_by_node_status_is_modified_for_an_edited_function(repo, engine):
    path = repo / "shared" / "text_utils.py"
    path.write_text(
        path.read_text(encoding="utf-8").replace('" ", "-"', '" ", "_"'), encoding="utf-8"
    )
    _reanalyze(engine, "shared/text_utils.py")

    payload = build_change_cards(engine, repo)

    node_id = "shared/text_utils.py::function::slugify"
    assert payload["by_node_status"][node_id] == "modified"


def test_by_node_status_collapses_a_mixed_kind_node_to_modified():
    cards = [
        {"node_id": "users/service.py::class::UserService", "status": "deleted"},
        {"node_id": "users/service.py::class::UserService", "status": "added"},
    ]
    assert _by_node_status(cards) == {"users/service.py::class::UserService": "modified"}


def test_a_new_file_in_a_new_directory_pins_to_the_nearest_existing_folder(repo, engine):
    (repo / "refunds").mkdir()
    (repo / "refunds" / "service.py").write_text(
        "def issue_refund():\n    return 1\n", encoding="utf-8"
    )
    _reanalyze(engine, "refunds/service.py")

    payload = build_change_cards(engine, repo)

    added = [card for card in payload["cards"] if card["file"] == "refunds/service.py"]
    assert added
    assert all(card["kind"] == "add" for card in added)


def test_a_changed_markdown_file_is_a_card_not_a_silent_drop(repo, engine):
    (repo / "README.md").write_text("# Sample\n\nTwo lines.\n", encoding="utf-8")

    payload = build_change_cards(engine, repo)

    card = [c for c in payload["cards"] if c["file"] == "README.md"][0]
    assert card["target"] == "file"
    assert card["kind"] == "add"
    assert card["added_lines"] == 3
    assert not card["binary"]


def test_a_changed_binary_file_is_carded_without_pretending_to_count_lines(repo, engine):
    (repo / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n\x00\xff\xfe")

    payload = build_change_cards(engine, repo)

    card = [c for c in payload["cards"] if c["file"] == "logo.png"][0]
    assert card["binary"]
    assert (card["added_lines"], card["removed_lines"]) == (0, 0)


def test_a_deleted_non_code_file_still_gets_a_card(repo, engine):
    (repo / "NOTES.md").write_text("notes\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "notes")
    (repo / "NOTES.md").unlink()

    payload = build_change_cards(engine, repo)

    card = [c for c in payload["cards"] if c["file"] == "NOTES.md"][0]
    assert card["kind"] == "delete"
    assert card["removed_lines"] == 1


def test_nothing_changed_means_no_cards_but_a_resolved_base(repo, engine):
    payload = build_change_cards(engine, repo)

    assert payload["cards"] == []
    assert payload["card_count"] == 0
    assert payload["base_resolved"]


def test_an_unreachable_base_says_so_instead_of_reporting_an_empty_change_set(repo, engine):
    path = repo / "shared" / "text_utils.py"
    path.write_text(
        path.read_text(encoding="utf-8").replace('" ", "-"', '" ", "_"'), encoding="utf-8"
    )

    payload = build_change_cards(engine, repo, base="refs/heads/no-such-branch")

    assert not payload["base_resolved"]
    assert payload["cards"] == []


def test_a_directory_that_is_not_a_repository_reports_an_unresolved_base(tmp_path):
    engine = GraphEngine(summarizer=AISummarizer())

    payload = build_change_cards(engine, tmp_path)

    assert not payload["base_resolved"]
    assert payload["unassigned"] == []


def test_our_own_graph_db_is_out_of_scope_rather_than_a_change(repo, engine):
    payload = build_change_cards(engine, repo)

    assert (repo / ".codechroma" / "graph.db").exists()
    assert not [card for card in payload["cards"] if ".codechroma" in card["file"]]
    assert not [entry for entry in payload["unassigned"] if ".codechroma" in entry["path"]]


def test_a_change_the_graph_has_no_node_for_is_reported_not_dropped(repo):
    empty = GraphEngine(summarizer=AISummarizer())
    (repo / "README.md").write_text("# Sample\n", encoding="utf-8")

    payload = build_change_cards(empty, repo)

    assert payload["cards"] == []
    assert payload["unassigned"] == [
        {"path": "README.md", "status": "added", "reason": REASON_NO_NODE}
    ]


def test_a_committed_change_still_shows_against_an_earlier_base(repo, engine):
    path = repo / "shared" / "text_utils.py"
    base = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    path.write_text(
        path.read_text(encoding="utf-8").replace('" ", "-"', '" ", "_"'), encoding="utf-8"
    )
    _git(repo, "commit", "-am", "tweak the slug separator")
    _reanalyze(engine, "shared/text_utils.py")

    payload = build_change_cards(engine, repo, base=base)

    assert _cards_for(payload, "shared/text_utils.py::function::slugify")


def test_every_card_carries_the_plan_step_fields_the_canvas_renders(repo, engine):
    path = repo / "shared" / "text_utils.py"
    path.write_text(
        path.read_text(encoding="utf-8").replace('" ", "-"', '" ", "_"'), encoding="utf-8"
    )
    _reanalyze(engine, "shared/text_utils.py")

    payload = build_change_cards(engine, repo)

    required = {"id", "text", "details", "node_id", "kind", "resolution", "file", "symbol"}
    assert all(required <= set(card) for card in payload["cards"])


def test_the_binary_reason_constant_is_reserved_for_unreadable_content():
    assert REASON_BINARY == "binary"
