"""AgentManager against a real temporary repository: worktree migration and id shadowing."""

import json
import os
import shutil
import subprocess
import threading
from pathlib import Path

import pytest

from codechroma.bridge.agents import worktree
from codechroma.bridge.agents.manager import AgentManager, UnknownAgentError, WorktreeProvisioner
from codechroma.bridge.agents.worktree import WorktreeError
from tests.conftest import diagram_json_path, pr_record


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    (root / "app.py").write_text("value = 1\n")
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    root.mkdir()
    _init_repo(root)
    monkeypatch.setattr(worktree, "legacy_worktrees_root", lambda: tmp_path / "legacy")
    monkeypatch.delenv(worktree.WORKSPACES_DIR_ENV, raising=False)
    return root


def _legacy_worktree(repo: Path, tmp_path: Path, name: str, branch: str) -> Path:
    path = tmp_path / "legacy" / "repo" / name
    worktree.add(repo, branch, path)
    return path


def test_migrate_moves_a_legacy_worktree_into_the_repository(repo, tmp_path):
    old = _legacy_worktree(repo, tmp_path, "refund-flow", "agent/refund-flow")

    moved = AgentManager(repo).migrate_worktrees()

    assert moved == [(old, repo / ".codechroma" / "worktrees" / "refund-flow")]
    assert (repo / ".codechroma" / "worktrees" / "refund-flow" / "app.py").exists()


def test_migrate_keeps_the_branch_the_worktree_was_on(repo, tmp_path):
    _legacy_worktree(repo, tmp_path, "refund-flow", "agent/refund-flow")

    AgentManager(repo).migrate_worktrees()

    entries = worktree.list_worktrees(repo)
    matching = [entry for entry in entries if entry["branch"] == "agent/refund-flow"]
    assert Path(matching[0]["path"]) == repo / ".codechroma" / "worktrees" / "refund-flow"


def test_migrate_moves_a_worktree_with_no_registry_record(repo, tmp_path):
    _legacy_worktree(repo, tmp_path, "orphan", "agent/orphan")

    moved = AgentManager(repo).migrate_worktrees()

    assert [target.name for _source, target in moved] == ["orphan"]


def test_migrate_repoints_the_record_and_persists_it(repo, tmp_path):
    old = _legacy_worktree(repo, tmp_path, "refund-flow", "agent/refund-flow")
    _write_registry(repo, [_record("refund-flow", "agent/refund-flow", old)])

    manager = AgentManager(repo)
    manager.migrate_worktrees()

    stored = json.loads((repo / ".codechroma" / "agents.json").read_text())
    assert manager.get("refund-flow").worktree == str(
        repo / ".codechroma" / "worktrees" / "refund-flow"
    )
    expected_worktree = repo / ".codechroma" / "worktrees" / "refund-flow"
    assert stored["agents"][0]["worktree"] == str(expected_worktree)


def test_migrate_carries_uncommitted_agent_work_across(repo, tmp_path):
    old = _legacy_worktree(repo, tmp_path, "wip", "agent/wip")
    (old / "app.py").write_text("value = 42\n")

    AgentManager(repo).migrate_worktrees()

    assert (repo / ".codechroma" / "worktrees" / "wip" / "app.py").read_text() == "value = 42\n"


def test_migrate_leaves_a_worktree_already_in_the_repository_alone(repo):
    path = worktree.worktree_path(repo, "already")
    worktree.add(repo, "agent/already", path)

    moved = AgentManager(repo).migrate_worktrees()

    assert moved == []
    assert path.is_dir()


def test_migrate_does_nothing_when_the_workspaces_dir_is_configured(repo, tmp_path, monkeypatch):
    old = _legacy_worktree(repo, tmp_path, "chosen", "agent/chosen")
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "elsewhere"))

    moved = AgentManager(repo).migrate_worktrees()

    assert moved == []
    assert old.is_dir()


def test_migrate_skips_a_name_that_already_exists_at_the_target(repo, tmp_path):
    old = _legacy_worktree(repo, tmp_path, "clash", "agent/clash")
    (repo / ".codechroma" / "worktrees" / "clash").mkdir(parents=True)

    moved = AgentManager(repo).migrate_worktrees()

    assert moved == []
    assert old.is_dir()


def test_migrate_removes_the_emptied_legacy_directory(repo, tmp_path):
    _legacy_worktree(repo, tmp_path, "last-one", "agent/last-one")

    AgentManager(repo).migrate_worktrees()

    assert not (tmp_path / "legacy" / "repo").exists()


def test_reconcile_migrates_and_does_not_report_the_worktree_as_lost(repo, tmp_path):
    old = _legacy_worktree(repo, tmp_path, "refund-flow", "agent/refund-flow")
    _write_registry(repo, [_record("refund-flow", "agent/refund-flow", old)])

    manager = AgentManager(repo)
    manager.reconcile()

    assert manager.get("refund-flow").worktree_lost is False


def test_reconcile_backfills_a_diagram_an_agent_never_got_seeded_with(repo):
    diagram_json_path(repo, "patterns").parent.mkdir(parents=True, exist_ok=True)
    diagram_json_path(repo, "patterns").write_text('{"nodes": ["main"]}')
    manager = AgentManager(repo)
    created = manager.create("refund flow")
    diagram_json_path(Path(created.worktree), "patterns").unlink()

    manager.reconcile()

    seeded = diagram_json_path(Path(created.worktree), "patterns")
    assert seeded.read_text() == '{"nodes": ["main"]}'


def test_reconcile_resyncs_skills_into_an_existing_agent_worktree(repo, monkeypatch):
    from codechroma.bridge import skill_sync

    manager = AgentManager(repo)
    created = manager.create("refund flow")
    worktree_root = Path(created.worktree)
    skill_dir = worktree_root / skill_sync.skill_relative_path("codechroma-draw-diagram")

    # Simulate an agent made before a skill existed: drop the installed copy entirely.
    shutil.rmtree(skill_dir.parent, ignore_errors=True)

    manager.reconcile()

    assert skill_dir.is_dir()


def test_reconcile_never_overwrites_an_agent_that_already_diverged(repo):
    diagram_json_path(repo, "patterns").parent.mkdir(parents=True, exist_ok=True)
    diagram_json_path(repo, "patterns").write_text('{"nodes": ["main"]}')
    manager = AgentManager(repo)
    created = manager.create("refund flow")
    own_diagram = diagram_json_path(Path(created.worktree), "patterns")
    own_diagram.write_text('{"nodes": ["own"]}')

    manager.reconcile()

    assert own_diagram.read_text() == '{"nodes": ["own"]}'


def test_recreate_worktree_reseeds_diagrams_into_the_fresh_checkout(repo):
    diagram_json_path(repo, "patterns").parent.mkdir(parents=True, exist_ok=True)
    diagram_json_path(repo, "patterns").write_text('{"nodes": ["main"]}')
    manager = AgentManager(repo)
    created = manager.create("refund flow")
    worktree.remove(repo, Path(created.worktree), force=True)
    manager.reconcile()
    assert manager.get(created.id).worktree_lost is True

    manager.recreate_worktree(created.id)

    seeded = diagram_json_path(Path(created.worktree), "patterns")
    assert seeded.read_text() == '{"nodes": ["main"]}'


def test_recreate_worktree_clears_worktree_lost_on_every_sibling_sharing_it(repo):
    manager = AgentManager(repo)
    target = manager.create("main line")
    helper = manager.create("helper", attach_to=target.id)
    worktree.remove(repo, Path(target.worktree), force=True)
    manager.reconcile()
    assert manager.get(target.id).worktree_lost is True
    assert manager.get(helper.id).worktree_lost is True

    manager.recreate_worktree(target.id)

    assert manager.get(target.id).worktree_lost is False
    assert manager.get(helper.id).worktree_lost is False


def test_attach_to_the_same_workspace_twice_yields_two_agents_sharing_one_worktree(repo):
    manager = AgentManager(repo)
    target = manager.create("main line")

    first = manager.create("helper-one", attach_to=target.id)
    second = manager.create("helper-two", attach_to=target.id)

    assert first.id != second.id
    assert first.worktree == second.worktree == target.worktree
    assert first.branch == second.branch == target.branch


def _write_transcript(
    projects: Path, project: str, session_id: str, cwd: str, mtime: float
) -> None:
    directory = projects / project
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{session_id}.jsonl"
    path.write_text(json.dumps({"type": "user", "cwd": cwd, "sessionId": session_id}) + "\n")
    os.utime(path, (mtime, mtime))


def test_an_agent_never_resumes_a_session_a_worktree_sibling_claimed(repo, tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "claude_home"))
    projects = tmp_path / "claude_home" / "projects"
    manager = AgentManager(repo)
    target = manager.create("main line")
    helper = manager.create("helper", attach_to=target.id)
    cwd = str(Path(target.worktree).resolve())
    _write_transcript(projects, "-shared", "targets-only-session", cwd, 1000)

    assert manager.capture_session_id(target.id) == "targets-only-session"
    # Both records share a worktree, so without exclusion helper would also match this transcript.
    assert manager.capture_session_id(helper.id) is None


def test_an_agent_still_resumes_its_own_session_among_siblings(repo, tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "claude_home"))
    projects = tmp_path / "claude_home" / "projects"
    manager = AgentManager(repo)
    target = manager.create("main line")
    helper = manager.create("helper", attach_to=target.id)
    cwd = str(Path(target.worktree).resolve())
    _write_transcript(projects, "-shared", "helpers-own-session", cwd, 1000)
    _write_transcript(projects, "-shared", "targets-newer-session", cwd, 2000)

    assert manager.capture_session_id(target.id) == "targets-newer-session"
    assert manager.capture_session_id(helper.id) == "helpers-own-session"


def test_a_new_agent_never_takes_the_id_that_shadows_the_main_workspace(repo):
    manager = AgentManager(repo)

    record = manager.create("main")

    assert record.id == "main-2"


def test_reconcile_renames_an_existing_agent_that_shadows_the_main_workspace(repo, tmp_path):
    old = _legacy_worktree(repo, tmp_path, "main", "agent/main")
    _write_registry(repo, [_record("main", "agent/main", old)])

    manager = AgentManager(repo)
    manager.reconcile()

    assert [record.id for record in manager.list()] == ["main-2"]


def test_the_renamed_agent_keeps_its_branch_and_its_worktree(repo, tmp_path):
    old = _legacy_worktree(repo, tmp_path, "main", "agent/main")
    _write_registry(repo, [_record("main", "agent/main", old)])

    manager = AgentManager(repo)
    manager.reconcile()

    record = manager.get("main-2")
    assert record.branch == "agent/main"
    assert record.worktree == str(repo / ".codechroma" / "worktrees" / "main")


def test_a_new_agent_never_takes_the_id_of_a_leftover_worktree(repo):
    manager = AgentManager(repo)
    first = manager.create("agent1")
    manager.delete(first.id)

    second = manager.create("agent1")

    assert second.id != first.id


def test_a_new_agent_reuses_an_id_whose_worktree_and_branch_were_both_removed(repo):
    manager = AgentManager(repo)
    first = manager.create("agent1")
    manager.delete(first.id, remove_worktree=True, remove_branch=True)

    second = manager.create("agent1")

    assert second.id == first.id


def test_a_new_agent_never_takes_an_id_whose_branch_survives_a_pruned_worktree(repo):
    manager = AgentManager(repo)
    first = manager.create("agent1")
    manager.delete(first.id)
    shutil.rmtree(first.worktree)

    second = manager.create("agent1")

    assert second.id != first.id


def test_a_new_agent_never_takes_an_id_that_shadows_a_pull_request(repo):
    manager = AgentManager(repo)

    record = manager.create("PR 12")

    assert record.id == "pr-12-2"


def test_reconcile_renames_an_existing_agent_that_shadows_a_pull_request(repo, tmp_path):
    old = _legacy_worktree(repo, tmp_path, "pr-12", "agent/pr-12")
    _write_registry(repo, [_record("pr-12", "agent/pr-12", old)])

    manager = AgentManager(repo)
    manager.reconcile()

    assert [record.id for record in manager.list()] == ["pr-12-2"]


def test_a_registered_non_agent_workspace_can_become_active(repo):
    manager = AgentManager(repo)
    manager.workspace_guard = lambda workspace_id: workspace_id == "pr-12"

    manager.set_active_workspace("pr-12")

    assert manager.active_workspace == "pr-12"


def test_an_unregistered_workspace_still_cannot_become_active(repo):
    manager = AgentManager(repo)

    with pytest.raises(UnknownAgentError):
        manager.set_active_workspace("pr-12")


def test_an_active_pull_request_survives_a_restart_once_it_is_registered(repo, tmp_path):
    manager = AgentManager(repo)
    manager.workspace_guard = lambda workspace_id: workspace_id == "pr-12"
    manager.set_active_workspace("pr-12")

    reloaded = AgentManager(repo)
    reloaded.workspace_guard = lambda workspace_id: workspace_id == "pr-12"
    reloaded.revalidate_active_workspace()

    assert reloaded.active_workspace == "pr-12"


def test_an_active_workspace_that_is_gone_falls_back_to_main(repo):
    manager = AgentManager(repo)
    manager.workspace_guard = lambda workspace_id: workspace_id == "pr-12"
    manager.set_active_workspace("pr-12")

    reloaded = AgentManager(repo)
    reloaded.revalidate_active_workspace()

    assert reloaded.active_workspace == "main"


def test_revalidating_leaves_an_agent_workspace_alone(repo):
    manager = AgentManager(repo)
    created = manager.create("refund flow")
    manager.set_active_workspace(created.id)

    reloaded = AgentManager(repo)
    reloaded.revalidate_active_workspace()

    assert reloaded.active_workspace == created.id


def test_attach_to_survives_a_reload_from_disk(repo):
    manager = AgentManager(repo)
    target = manager.create("main line")
    helper = manager.create("helper", attach_to=target.id)

    reloaded = AgentManager(repo)

    assert reloaded.get(helper.id).shares_workspace_with == target.id
    assert reloaded.get(target.id).shares_workspace_with is None


def test_attaching_to_main_on_a_detached_head_is_refused(repo):
    subprocess.run(
        ["git", "checkout", "--detach", "HEAD"], cwd=repo, check=True, capture_output=True
    )
    manager = AgentManager(repo)

    with pytest.raises(worktree.WorktreeError):
        manager.create("sidecar", attach_to="main")


def test_a_new_agent_records_the_branch_main_was_on(repo):
    subprocess.run(["git", "checkout", "-b", "dataflow"], cwd=repo, check=True, capture_output=True)
    manager = AgentManager(repo)

    created = manager.create("refund flow")

    assert created.base_branch == "dataflow"


def test_the_base_branch_is_not_the_agents_own_working_branch(repo):
    manager = AgentManager(repo)

    created = manager.create("refund flow")

    assert (created.branch, created.base_branch) == ("agent/refund-flow", "main")


def test_a_freshly_created_agent_has_no_source_pr(repo):
    manager = AgentManager(repo)

    created = manager.create("refund flow")

    assert created.source_pr is None


def test_the_base_branch_survives_a_reload_from_disk(repo):
    manager = AgentManager(repo)
    created = manager.create("refund flow")

    reloaded = AgentManager(repo)

    assert reloaded.get(created.id).base_branch == "main"


def test_context_is_persisted_and_cleared_on_consume(repo):
    manager = AgentManager(repo)
    record = manager.create("refund flow", context="the C1 diagram")

    assert manager.get(record.id).context == "the C1 diagram"
    # A fresh manager (reload from disk) still sees the pending context.
    reloaded = AgentManager(repo)
    assert reloaded.get(record.id).context == "the C1 diagram"

    pending = reloaded.consume_context(record.id)

    assert pending == ("the C1 diagram", "view")
    fresh = AgentManager(repo)
    assert fresh.get(record.id).context is None
    assert fresh.consume_context(record.id) is None


def test_an_agent_created_without_context_has_none(repo):
    manager = AgentManager(repo)

    created = manager.create("refund flow")

    assert created.context is None
    assert manager.consume_context(created.id) is None


def test_a_task_context_is_persisted_with_its_kind_and_consumed_together(repo):
    manager = AgentManager(repo)
    record = manager.create(
        "draw a diagram", context="What do you want to visualize?", context_kind="task"
    )

    assert manager.get(record.id).context_kind == "task"
    assert manager.consume_context(record.id) == ("What do you want to visualize?", "task")


def test_control_characters_are_stripped_out_of_a_context(repo):
    """🔴 inject_when_idle types this into a live PTY, so a newline here would submit early."""
    manager = AgentManager(repo)

    created = manager.create("draw", context="draw a\r\ndiagram\x1b[Anow", context_kind="task")

    # The escape is gone, so what's left of the CSI sequence is inert literal text, not cursor-up.
    assert created.context == "draw a diagram [Anow"


def test_a_context_of_nothing_but_control_characters_becomes_none(repo):
    manager = AgentManager(repo)

    created = manager.create("draw", context="\r\n\t")

    assert created.context is None


def test_an_unknown_context_kind_falls_back_to_view(repo):
    manager = AgentManager(repo)

    created = manager.create("refund flow", context="hi", context_kind="not-a-real-kind")

    assert created.context_kind == "view"


def test_an_agent_attached_to_main_belongs_to_mains_branch(repo):
    subprocess.run(["git", "checkout", "-b", "dataflow"], cwd=repo, check=True, capture_output=True)
    manager = AgentManager(repo)

    created = manager.create("sidecar", attach_to="main")

    assert created.base_branch == "dataflow"


def test_an_agent_attached_to_another_agent_inherits_its_base_branch(repo):
    subprocess.run(["git", "checkout", "-b", "dataflow"], cwd=repo, check=True, capture_output=True)
    manager = AgentManager(repo)
    target = manager.create("main line")

    helper = manager.create("helper", attach_to=target.id)

    assert helper.base_branch == target.base_branch == "dataflow"


# None, not a guess: a legacy record has to stay visible on every branch rather than disappear.
def test_a_registry_written_before_the_field_reads_back_without_a_base_branch(repo, tmp_path):
    old = _legacy_worktree(repo, tmp_path, "refund-flow", "agent/refund-flow")
    _write_registry(repo, [_record("refund-flow", "agent/refund-flow", old)])

    manager = AgentManager(repo)

    assert manager.get("refund-flow").base_branch is None


def _record(agent_id: str, branch: str, path: Path) -> dict:
    return {
        "id": agent_id,
        "title": agent_id,
        "kind": "claude",
        "branch": branch,
        "worktree": str(path),
        "created_at": "2026-01-01T00:00:00Z",
    }


def _write_registry(repo: Path, records: list[dict]) -> None:
    path = repo / ".codechroma" / "agents.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "agents": records, "active_workspace": "main"}))


def test_attach_to_a_pr_shares_its_own_worktree_and_branch(repo):
    manager = AgentManager(repo)
    manager.pr_lookup = lambda pr_id: pr_record(282) if pr_id == "pr-282" else None

    created = manager.create("fix", attach_to="pr-282")

    assert created.shares_workspace_with == "pr-282"
    assert created.worktree == "/pr/worktree"
    assert created.branch == "feature"


def test_a_pr_attached_agents_base_branch_is_the_prs_base_ref(repo):
    manager = AgentManager(repo)
    manager.pr_lookup = lambda pr_id: pr_record(282, base_ref="release-1.0")

    created = manager.create("fix", attach_to="pr-282")

    assert created.base_branch == "release-1.0"


def test_a_pr_attached_agents_source_pr_is_the_attach_to_id(repo):
    manager = AgentManager(repo)
    manager.pr_lookup = lambda pr_id: pr_record(282)

    created = manager.create("fix", attach_to="pr-282")

    assert created.source_pr == "pr-282"


def test_attach_to_a_pr_with_no_worktree_is_refused(repo):
    manager = AgentManager(repo)
    manager.pr_lookup = lambda pr_id: pr_record(282, worktree="")

    with pytest.raises(WorktreeError):
        manager.create("fix", attach_to="pr-282")


def test_attach_to_an_unknown_pr_id_is_refused(repo):
    manager = AgentManager(repo)
    manager.pr_lookup = lambda _pr_id: None

    with pytest.raises(UnknownAgentError):
        manager.create("fix", attach_to="pr-999")


def test_a_pr_attached_agent_survives_a_reload_from_disk(repo):
    manager = AgentManager(repo)
    manager.pr_lookup = lambda pr_id: pr_record(282, base_ref="release-1.0")
    created = manager.create("fix", attach_to="pr-282")

    reloaded = AgentManager(repo)

    assert reloaded.get(created.id).shares_workspace_with == "pr-282"
    assert reloaded.get(created.id).base_branch == "release-1.0"
    assert reloaded.get(created.id).source_pr == "pr-282"


def test_deleting_a_pr_attached_agents_worktree_is_refused(repo):
    manager = AgentManager(repo)
    manager.pr_lookup = lambda pr_id: pr_record(282)
    created = manager.create("fix", attach_to="pr-282")

    with pytest.raises(WorktreeError):
        manager.delete(created.id, remove_worktree=True)


def test_attached_to_pr_lists_only_agents_sharing_that_pr(repo):
    manager = AgentManager(repo)
    manager.pr_lookup = lambda pr_id: pr_record(int(pr_id.removeprefix("pr-")))
    attached = manager.create("fix", attach_to="pr-282")
    manager.create("unrelated")

    assert [agent.id for agent in manager.attached_to_pr("pr-282")] == [attached.id]
    assert manager.attached_to_pr("pr-999") == []


def test_delete_cannot_race_a_concurrent_attach_to_the_same_worktree(repo, monkeypatch):
    """A create(attach_to=X) arriving mid-delete(X) must see X already gone, never half-deleted."""
    manager = AgentManager(repo)
    target = manager.create("target")

    entered_remove = threading.Event()
    release_remove = threading.Event()
    real_remove = worktree.remove

    def blocking_remove(main_root: Path, path: Path, force: bool = False) -> None:
        entered_remove.set()
        release_remove.wait(timeout=5)
        real_remove(main_root, path, force=force)

    monkeypatch.setattr(worktree, "remove", blocking_remove)
    outcome: dict[str, object] = {}

    def attempt_attach() -> None:
        try:
            outcome["record"] = manager.create("attacher", attach_to=target.id)
        except UnknownAgentError as exc:
            outcome["error"] = exc

    deleter = threading.Thread(
        target=lambda: manager.delete(target.id, remove_worktree=True)
    )
    deleter.start()
    assert entered_remove.wait(timeout=5), "delete() never reached worktree.remove"
    attacher = threading.Thread(target=attempt_attach)
    attacher.start()
    release_remove.set()
    deleter.join(timeout=5)
    attacher.join(timeout=5)

    assert isinstance(outcome.get("error"), UnknownAgentError)
    assert "record" not in outcome


def test_worktree_provisioning_installs_skills_and_seeds_diagrams(repo):
    diagram_json_path(repo, "patterns").parent.mkdir(parents=True, exist_ok=True)
    diagram_json_path(repo, "patterns").write_text('{"nodes": ["main"]}')
    from codechroma.bridge.skill_sync import WORKTREE_EXCLUDES

    manager = AgentManager(repo)
    created = manager.create("refund flow")

    # A skill lands inside the worktree at the conventional relative path (not just in main).
    from codechroma.bridge.skill_sync import SKILL_NAMES, skill_relative_path

    skill_root = Path(created.worktree) / skill_relative_path(SKILL_NAMES[0])
    assert skill_root.is_dir()
    # Main's diagram was seeded into the worktree, so the first open needs no regeneration.
    seeded_patterns = diagram_json_path(Path(created.worktree), "patterns")
    assert seeded_patterns.read_text() == '{"nodes": ["main"]}'
    # The seeded artifacts are excluded, so they never read as the agent's own untracked work.
    ensure = subprocess.run(
        ["git", "-C", created.worktree, "status", "--porcelain"],
        check=True,
        capture_output=True,
        text=True,
    )
    for pattern in WORKTREE_EXCLUDES:
        assert pattern.rstrip("/") not in ensure.stdout


def test_concurrent_registrations_do_not_corrupt_the_registry(repo, monkeypatch):
    import threading

    from codechroma.bridge.agents import worktree

    # Replace the git-touching worktree bits with fast no-ops: the lock we're testing gates the
    # in-memory _agents dict + id reservation, not the slow git calls underneath.
    monkeypatch.setattr(worktree, "branch_name", lambda agent_id: f"agent/{agent_id}")
    monkeypatch.setattr(worktree, "worktree_path", lambda main_root, agent_id: repo / agent_id)
    monkeypatch.setattr(worktree, "add", lambda main_root, branch, path, start_point=None: None)
    monkeypatch.setattr(WorktreeProvisioner, "install_skills", lambda self, root: None)
    monkeypatch.setattr(WorktreeProvisioner, "seed_diagrams", lambda self, root: None)
    # A torn _agents dict makes list() drop a record; the lock also makes the window value unique.
    manager = AgentManager(repo)

    created: list[object] = []
    threads = [
        threading.Thread(target=lambda: created.append(manager.create("parallel agent")))
        for _ in range(5)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    # Every caller's record survived, ids stayed unique, and no two shared a window z-slot.
    records = list(manager.list())
    assert len(records) == 5
    assert len({record.id for record in records}) == 5
    assert len({record.window["z"] for record in records}) == 5


def test_resolved_cli_persists_and_roundtrips(repo):
    """061: the derived `resolved_cli` label is persisted so a restart still shows what launched."""
    manager = AgentManager(repo)
    created = manager.create("provider runner", kind="agent")

    created.resolved_cli = "/opt/homebrew/bin/claude"
    manager.save()

    reloaded = AgentManager(repo)
    record = reloaded.get(created.id)
    assert record.resolved_cli == "/opt/homebrew/bin/claude"


def test_a_legacy_record_defaults_resolved_cli_to_empty(repo):
    """A record written before 061 (no `resolved_cli` key) loads as empty, not an error."""
    manager = AgentManager(repo)
    created = manager.create("plain")

    created.to_json()  # persisted subset; the empty field is present with its default
    from codechroma.bridge.agents.manager import AgentRecord

    legacy = AgentRecord.from_json({**created.to_json(), "resolved_cli": ""})
    assert legacy.resolved_cli == ""

    missing = AgentRecord.from_json({
        key: value for key, value in created.to_json().items() if key != "resolved_cli"
    })
    assert missing.resolved_cli == ""
