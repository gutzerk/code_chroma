"""Unit coverage for resolve_impact_changes: mapping a git diff onto Impact boxes + the review."""

import shutil
import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.overlays import fingerprint_for, resolve_impact_changes
from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _write(root: Path, relative: str, text: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def _commit_all(root: Path) -> None:
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)


def _diagram(nodes=None):
    return {"nodes": nodes or [], "relations": []}


def _box(box_id: str, node_id: str, name: str | None = None) -> dict:
    return {"id": box_id, "name": name or box_id, "node_id": node_id}


def _blocks_by_id(payload):
    return {entry["block"]: entry for entry in payload["blocks"]}


@pytest.fixture
def repo(tmp_path):
    """A committed, plain (unanalyzed) repo -- for fingerprint/ghost/relationship coverage."""
    root = tmp_path / "repo"
    root.mkdir()
    _init_repo(root)
    _write(root, "src/graph/builder.py", "original builder\n")
    _commit_all(root)
    return root


@pytest.fixture
def engine_repo(tmp_path):
    """A real, analyzed copy of tests/fixtures/sample_repo, committed to its own git history."""
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    _init_repo(root)
    _commit_all(root)
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(root))
    return engine, root


CREATE_USER = "users/service.py::function::UserService.create_user"
LIST_USERS = "users/service.py::function::list_active_users"
COMPONENT_USERS = "component::users/service.py"
DIR_USERS = "dir::users"
CREATE_INVOICE = "billing/service.py::function::BillingService.create_invoice"


def test_a_changed_symbol_attributes_to_the_box_that_is_its_exact_node(engine_repo):
    engine, root = engine_repo
    text = (root / "users/service.py").read_text()
    _write(root, "users/service.py", text.replace("return user_id", "return user_id  # x"))
    boxes = [_box("create-user", CREATE_USER)]

    payload = resolve_impact_changes(root, _diagram(boxes), engine=engine)

    assert _blocks_by_id(payload)["create-user"]["files"] == [
        {"path": "users/service.py", "status": "modified"}
    ]


def test_a_changed_symbol_collapses_onto_its_file_level_box(engine_repo):
    engine, root = engine_repo
    _write(root, "users/service.py", (root / "users/service.py").read_text() + "\n# tweak\n")
    boxes = [_box("users-file", COMPONENT_USERS)]

    payload = resolve_impact_changes(root, _diagram(boxes), engine=engine)

    assert _blocks_by_id(payload)["users-file"]["change_count"] == 1


def test_a_changed_symbol_collapses_onto_its_directory_level_box(engine_repo):
    engine, root = engine_repo
    _write(root, "users/service.py", (root / "users/service.py").read_text() + "\n# tweak\n")
    boxes = [_box("users-dir", DIR_USERS)]

    payload = resolve_impact_changes(root, _diagram(boxes), engine=engine)

    assert _blocks_by_id(payload)["users-dir"]["change_count"] == 1


def test_a_changed_symbol_with_no_owning_box_is_unassigned(engine_repo):
    engine, root = engine_repo
    _write(root, "users/service.py", (root / "users/service.py").read_text() + "\n# tweak\n")
    boxes = [_box("invoice", CREATE_INVOICE)]

    payload = resolve_impact_changes(root, _diagram(boxes), engine=engine)

    assert {"path": "users/service.py", "status": "modified"} in payload["unassigned"]


def test_two_changed_symbols_in_one_file_both_roll_onto_the_same_collapsed_box(engine_repo):
    engine, root = engine_repo
    text = (root / "users/service.py").read_text()
    _write(root, "users/service.py", text.replace("return user_id", "return user_id  # x"))
    boxes = [_box("users-file", COMPONENT_USERS)]

    payload = resolve_impact_changes(root, _diagram(boxes), engine=engine)

    assert _blocks_by_id(payload)["users-file"]["status"] == "modified"


def test_an_authored_status_overrides_the_inferred_one(engine_repo):
    engine, root = engine_repo
    _write(root, "users/service.py", (root / "users/service.py").read_text() + "\n# tweak\n")
    boxes = [_box("create-user", CREATE_USER)]
    authored = {"blocks": [{"block": "create-user", "status": "removed"}]}

    payload = resolve_impact_changes(root, _diagram(boxes), authored, engine=engine)

    assert _blocks_by_id(payload)["create-user"]["status"] == "removed"


def test_authored_prose_merges_onto_the_matching_block(engine_repo):
    engine, root = engine_repo
    _write(root, "users/service.py", (root / "users/service.py").read_text() + "\n# tweak\n")
    boxes = [_box("create-user", CREATE_USER)]
    authored = {"blocks": [{"block": "create-user", "after": "Now slugs unicode names too."}]}

    payload = resolve_impact_changes(root, _diagram(boxes), authored, engine=engine)

    assert _blocks_by_id(payload)["create-user"]["after"] == "Now slugs unicode names too."


def test_an_authored_block_with_no_git_changes_still_appears(engine_repo):
    engine, root = engine_repo
    boxes = [_box("create-user", CREATE_USER)]
    authored = {"blocks": [{"block": "create-user", "explanation": "Unrelated context box."}]}

    payload = resolve_impact_changes(root, _diagram(boxes), authored, engine=engine)

    assert _blocks_by_id(payload)["create-user"]["change_count"] == 0


def test_a_review_comment_resolves_to_its_owning_function_when_engine_is_given(engine_repo):
    engine, root = engine_repo
    boxes = [_box("create-user", CREATE_USER)]
    comment = {"author": "jane", "body": "Why?", "path": "users/service.py", "line": 13}

    payload = resolve_impact_changes(
        root, _diagram(boxes), review_comments=[comment], engine=engine
    )

    resolved = _blocks_by_id(payload)["create-user"]["pr_comments"][0]
    assert resolved["symbol"] == "UserService.create_user"


def test_a_review_comment_with_no_owning_box_is_general(engine_repo):
    engine, root = engine_repo
    boxes = [_box("invoice", CREATE_INVOICE)]
    comment = {"author": "jane", "body": "Why?", "path": "users/service.py", "line": 13}

    payload = resolve_impact_changes(
        root, _diagram(boxes), review_comments=[comment], engine=engine
    )

    assert payload["general_pr_comments"] == [
        {**comment, "node_id": CREATE_USER, "symbol": "UserService.create_user"}
    ]


def test_general_comments_are_appended_to_unattributed_review_comments(engine_repo):
    engine, root = engine_repo
    general = {"author": "jane", "body": "LGTM.", "path": None, "line": None}

    payload = resolve_impact_changes(root, _diagram([]), general_comments=[general], engine=engine)

    assert payload["general_pr_comments"] == [general]


def test_a_review_of_a_different_diff_is_reported_stale(engine_repo):
    engine, root = engine_repo
    _write(root, "users/service.py", (root / "users/service.py").read_text() + "\n# tweak\n")

    payload = resolve_impact_changes(
        root, _diagram([]), {"fingerprint": "stale-hash"}, engine=engine
    )

    assert (payload["has_review"], payload["stale"]) == (True, True)


def test_a_review_of_the_current_diff_is_not_stale(engine_repo):
    engine, root = engine_repo
    _write(root, "users/service.py", (root / "users/service.py").read_text() + "\n# tweak\n")
    current = resolve_impact_changes(root, _diagram([]), engine=engine)["fingerprint"]

    payload = resolve_impact_changes(root, _diagram([]), {"fingerprint": current}, engine=engine)

    assert payload["stale"] is False


def test_no_review_file_reports_neither_review_nor_staleness(repo):
    payload = resolve_impact_changes(repo, _diagram([]))

    assert (payload["has_review"], payload["stale"]) == (False, False)


def test_a_ghost_block_carries_its_parents_own_id(repo):
    boxes = [_box("graph", "component::src/graph/builder.py")]
    authored = {
        "ghosts": [
            {
                "parent": "graph",
                "id": "clustering",
                "name": "Reference clustering",
                "before": "Union-find over call edges.",
            }
        ]
    }

    payload = resolve_impact_changes(repo, _diagram(boxes), authored)

    assert payload["ghosts"][0]["parent_node_id"] == "graph"


def test_a_ghost_under_an_unknown_parent_is_dropped(repo):
    boxes = [_box("graph", "component::src/graph/builder.py")]
    authored = {"ghosts": [{"parent": "nope", "id": "x", "name": "X"}]}

    payload = resolve_impact_changes(repo, _diagram(boxes), authored)

    assert payload["ghosts"] == []


def test_a_relationship_delta_between_known_boxes_survives(repo):
    boxes = [
        _box("graph", "component::src/graph/builder.py"),
        {"id": "git", "name": "Git", "node_id": "git"},
    ]
    authored = {
        "relationships": [{"from": "graph", "to": "git", "label": "Reads", "status": "added"}]
    }

    payload = resolve_impact_changes(repo, _diagram(boxes), authored)

    assert payload["relationships"][0]["status"] == "added"


def test_a_relationship_naming_a_box_that_no_longer_exists_is_dropped(repo):
    boxes = [_box("graph", "component::src/graph/builder.py")]
    authored = {"relationships": [{"from": "graph", "to": "stripe", "label": "Charges"}]}

    payload = resolve_impact_changes(repo, _diagram(boxes), authored)

    assert payload["relationships"] == []


def test_outside_a_git_repo_the_payload_is_empty_but_well_formed(tmp_path):
    payload = resolve_impact_changes(tmp_path, _diagram([]))

    assert (payload["blocks"], payload["changed_file_count"]) == ([], 0)


def test_no_engine_means_no_attribution_but_still_a_well_formed_payload(repo):
    _write(repo, "src/graph/builder.py", "changed builder\n")
    boxes = [_box("graph", "component::src/graph/builder.py")]

    payload = resolve_impact_changes(repo, _diagram(boxes))

    assert payload["blocks"] == []
    assert payload["unassigned"] == [{"path": "src/graph/builder.py", "status": "modified"}]


def test_the_fingerprint_ignores_the_order_files_were_reported_in():
    one = fingerprint_for({"a.py": "modified", "b.py": "added"})

    two = fingerprint_for({"b.py": "added", "a.py": "modified"})

    assert one == two
