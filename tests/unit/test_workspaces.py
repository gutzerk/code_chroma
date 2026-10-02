"""WorkspaceRegistry: main comes up analyzed, unknown ids fall back, paths stay per-workspace."""

import json
import shutil
import subprocess
import threading
import time
from pathlib import Path

import pytest

from codechroma.bridge.agents.worktree import main_branch
from codechroma.bridge.bootstrap_diagrams import bootstrap_if_missing
from codechroma.bridge.workspaces import MAIN_ID, STATE_READY, Workspace, WorkspaceRegistry

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    _init_repo(root)
    return root


@pytest.fixture
def registry(repo):
    events: list[dict] = []
    return WorkspaceRegistry(repo, lambda message, key=None: events.append(message)), events


def test_workspace_pings_carry_their_id_as_the_broadcast_key(repo):
    """Keyed emits let the events socket scope pings per repo instead of fanning out to all."""
    keyed: list[tuple[dict, str | None]] = []
    workspaces = WorkspaceRegistry(repo, lambda message, key=None: keyed.append((message, key)))

    workspaces.main.emit({"type": "plan"})

    assert keyed[-1] == ({"type": "plan"}, MAIN_ID)


def test_on_repo_change_pings_wiki_general_after_a_commit(registry, repo):
    workspaces, events = registry
    main = workspaces.get(MAIN_ID)
    (repo / "new.py").write_text("def g(): pass\n")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "second"], cwd=repo, check=True, capture_output=True)

    main._watchers.on_repo_change()

    assert {"type": "wiki-general"} in events


def test_on_repo_change_does_not_ping_wiki_general_for_an_uncommitted_edit(registry, repo):
    workspaces, events = registry
    main = workspaces.get(MAIN_ID)
    (repo / "new.py").write_text("def g(): pass\n")

    main._watchers.on_repo_change()

    assert {"type": "wiki-general"} not in events


def test_main_workspace_is_analyzed_at_construction(registry, repo):
    workspaces, _events = registry

    main = workspaces.get(MAIN_ID)

    assert main.root == repo
    assert main.engine.get_node("shared/text_utils.py::function::slugify") is not None


def test_bring_up_bootstraps_the_wiki_when_none_exists_yet(registry, repo):
    workspaces, _events = registry

    main = workspaces.get(MAIN_ID)

    assert main.root == repo
    assert (repo / ".codechroma" / "wiki" / "index.md").exists()


def test_bring_up_does_not_bootstrap_the_wiki_for_a_read_only_workspace(repo):
    workspace = Workspace.create("pr-12", repo, lambda _m: None, read_only=True)

    workspace.analyze()

    assert not (repo / ".codechroma" / "wiki" / "index.md").exists()


def test_a_failed_wiki_bootstrap_never_fails_the_analyze_that_triggered_it(repo, monkeypatch):
    def _explode():
        raise RuntimeError("boom")

    workspace = Workspace.create(MAIN_ID, repo, lambda _m: None)
    monkeypatch.setattr(workspace.engine, "generate_wiki", _explode)

    workspace.analyze()

    assert workspace.state == STATE_READY
    assert not (repo / ".codechroma" / "wiki" / "index.md").exists()


def test_unknown_repo_id_resolves_to_main_without_creating_a_workspace(registry):
    workspaces, _events = registry

    resolved = workspaces.get("nobody-registered-this")

    assert resolved is workspaces.main
    assert len(workspaces) == 1


def test_registering_a_workspace_does_not_bring_it_up(registry, tmp_path):
    workspaces, _events = registry

    workspaces.register("agent-a", tmp_path / "agent-a")

    assert workspaces.is_registered("agent-a")
    assert not workspaces.is_live("agent-a")
    assert len(workspaces) == 1


def test_codechroma_paths_are_isolated_per_workspace(tmp_path):
    events: list[dict] = []
    one = Workspace.create("one", tmp_path / "one", events.append)
    two = Workspace.create("two", tmp_path / "two", events.append)

    assert one.diagram_path("c1") != two.diagram_path("c1")
    assert one.impact_changes_path != two.impact_changes_path
    assert one.layout_store("c1").path != two.layout_store("c1").path
    assert one.traces_dir != two.traces_dir
    assert one.dependency_digest_path != two.dependency_digest_path


def test_stop_watchers_is_safe_before_start_and_idempotent(tmp_path):
    workspace = Workspace.create("one", tmp_path / "one", lambda _message: None)

    workspace.stop_watchers()
    workspace.stop_watchers()

    # repo/trace/custom/feature-plan/3 kinds/3 projections/impact-changes/canvas-core/wiki-general.
    assert len(workspace.watchers) == 13


def test_watchers_start_and_stop_only_their_owned_watcher_kinds(tmp_path):
    workspace = Workspace.create("one", tmp_path / "one", lambda _message: None)
    started: list[object] = []
    stopped: list[object] = []
    for watcher in workspace.watchers:
        watcher.start = lambda w=watcher: started.append(w)
        watcher.stop = lambda w=watcher: stopped.append(w)

    workspace.start_watchers()
    workspace.stop_watchers()

    # Every owned watcher was started and stopped, and nothing outside that set was touched.
    assert set(started) == set(workspace.watchers)
    assert stopped == started


def test_the_watcher_set_enumerates_exactly_the_diagram_registry_kinds(tmp_path):
    from codechroma.bridge.diagram_registry import DIAGRAMS

    workspace = Workspace.create("one", tmp_path / "one", lambda _message: None)

    # The registry drives diagram watching, so a new diagram kind needs no edit here.
    assert set(workspace._watchers.diagram_watchers) == set(DIAGRAMS)
    # The custom watcher watches the registry's own custom dir, not a hard-coded path.
    assert workspace._watchers.custom_watcher._target == DIAGRAMS.custom_dir(tmp_path / "one")
    # Same for feature-plan, its own dir and never the custom one.
    assert workspace._watchers.feature_plan_watcher._target == DIAGRAMS.feature_plan_dir(
        tmp_path / "one"
    )


def test_feature_plan_resolve_reports_has_diagram_once_its_file_exists(tmp_path):
    from codechroma.bridge.diagram_registry import DIAGRAMS

    workspace = Workspace.create(MAIN_ID, tmp_path / "main", lambda _message: None)
    spec = DIAGRAMS.get("feature-plan/token-auth")

    before = spec.resolve(workspace)
    spec.artifact_path(workspace.root).parent.mkdir(parents=True, exist_ok=True)
    spec.artifact_path(workspace.root).write_text('{"nodes": [], "relations": []}')
    after = spec.resolve(workspace)

    assert before["has_diagram"] is False
    assert after["has_diagram"] is True


def test_feature_plan_change_pings_its_own_type_not_custom(tmp_path):
    events: list[dict] = []
    workspace = Workspace.create(MAIN_ID, tmp_path / "main", events.append)

    workspace._watchers.on_feature_plan_change()

    # Also pings "canvas" now (its own projection.json is a backstop path) -- still not "custom".
    assert events == [{"type": "feature-plan"}, {"type": "canvas"}]


def test_main_pings_stay_bare_while_agent_pings_name_their_workspace(tmp_path):
    events: list[dict] = []
    main = Workspace.create(MAIN_ID, tmp_path / "main", events.append)
    agent = Workspace.create("refund-flow", tmp_path / "agent", events.append)

    main.emit({"type": "plan"})
    agent.emit({"type": "plan"})

    assert events == [{"type": "plan"}, {"type": "plan", "workspace": "refund-flow"}]


def test_unregister_stops_a_live_workspace_and_forgets_it(registry, repo):
    workspaces, _events = registry
    workspaces.register("agent-a", repo)
    workspaces.get("agent-a")

    workspaces.unregister("agent-a")

    assert not workspaces.is_live("agent-a")
    assert not workspaces.is_registered("agent-a")


def test_unregister_refuses_to_drop_main(registry):
    workspaces, _events = registry

    workspaces.unregister(MAIN_ID)

    assert workspaces.is_registered(MAIN_ID)


def test_root_for_names_a_registered_workspace_and_admits_ignorance_otherwise(registry, tmp_path):
    workspaces, _events = registry
    workspaces.register("agent-a", tmp_path / "agent-a")

    assert workspaces.root_for("agent-a") == tmp_path / "agent-a"
    assert workspaces.root_for("nobody-registered-this") is None


def test_diff_base_merge_bases_against_an_explicit_base_ref(repo, tmp_path):
    subprocess.run(["git", "branch", "release"], cwd=repo, check=True, capture_output=True)
    (repo / "extra.py").write_text("value = 1\n")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "second"], cwd=repo, check=True, capture_output=True)
    expected = subprocess.run(
        ["git", "merge-base", "release", "HEAD"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    workspace = Workspace.create("pr-12", repo, lambda _m: None, base_ref="release")

    assert workspace.diff_base() == expected


def test_no_base_ref_reproduces_the_agent_worktree_path(repo):
    explicit = Workspace.create("pr-12", repo, lambda _m: None, base_ref=main_branch(repo))
    implicit = Workspace.create("refund-flow", repo, lambda _m: None)

    # Regression pin: base_ref=None must still mean exactly "this worktree's main branch".
    assert implicit.diff_base() == explicit.diff_base()


def test_an_unreachable_base_ref_degrades_to_head_rather_than_guessing(repo):
    workspace = Workspace.create("pr-12", repo, lambda _m: None, base_ref="refs/heads/no-such")

    assert workspace.diff_base() == "HEAD"


def test_changed_since_finds_a_committed_change_divergent_files_cannot_see_on_main(repo):
    """Regression: divergent_files() diffs main against itself, so a real commit never shows up."""
    workspace = Workspace.create(MAIN_ID, repo, lambda _m: None)
    base_commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()
    (repo / "extra.py").write_text("value = 1\n")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "second"], cwd=repo, check=True, capture_output=True)

    assert "extra.py" not in workspace.divergent_files()
    assert "extra.py" in workspace.changed_since(base_commit)


def test_changed_since_falls_back_to_divergent_files_without_a_known_base_commit(repo):
    workspace = Workspace.create(MAIN_ID, repo, lambda _m: None)
    (repo / "extra.py").write_text("value = 1\n")

    assert workspace.changed_since(None) == workspace.divergent_files()
    assert "extra.py" in workspace.changed_since(None)


def test_a_read_only_workspace_never_reaches_for_a_claude_client(tmp_path, monkeypatch):
    def explode(_digest):
        raise AssertionError("a read-only workspace must not generate a diagram")

    monkeypatch.setattr("codechroma.context.c1_template.generate_c1_template", explode)
    workspace = Workspace.create("pr-12", tmp_path / "pr-12", lambda _m: None, read_only=True)

    bootstrap_if_missing(workspace, "c1")

    assert workspace.read_only


def test_bootstrap_c1_writes_the_file_with_no_credential(repo):
    workspace = Workspace.create(MAIN_ID, repo, lambda _m: None)
    workspace.engine.analyze(str(repo))

    bootstrap_if_missing(workspace, "c1")

    written = json.loads(workspace.diagram_path("c1").read_text())
    assert written["nodes"][0]["id"] == "system"


def test_a_read_only_workspace_never_reaches_for_a_patterns_claude_client(tmp_path, monkeypatch):
    def explode():
        raise AssertionError("a read-only workspace must not build a Claude client")

    monkeypatch.setattr("codechroma.context.patterns_generator.provider_from_env", explode)
    workspace = Workspace.create("pr-12", tmp_path / "pr-12", lambda _m: None, read_only=True)

    bootstrap_if_missing(workspace, "patterns")

    assert workspace.read_only


def test_bootstrap_patterns_writes_the_file_when_a_client_is_available(repo, monkeypatch):
    monkeypatch.setattr("codechroma.context.patterns_generator.provider_from_env", lambda: object())
    monkeypatch.setattr(
        "codechroma.context.patterns_generator.generate_patterns",
        lambda candidates, provider=None: {
            "generated_at": "now",
            "patterns": [],
            "unconfirmed": [],
            "nodes": [],
            "relations": [],
            "fingerprint": "stub-fingerprint",
        },
    )
    workspace = Workspace.create(MAIN_ID, repo, lambda _m: None)
    workspace.engine.analyze(str(repo))

    bootstrap_if_missing(workspace, "patterns")

    written = json.loads(workspace.diagram_path("patterns").read_text())
    assert written["fingerprint"] == "stub-fingerprint"


def test_bootstrap_patterns_is_a_no_op_once_the_file_exists(repo, monkeypatch):
    workspace = Workspace.create(MAIN_ID, repo, lambda _m: None)
    workspace.engine.analyze(str(repo))
    workspace.diagram_path("patterns").parent.mkdir(parents=True, exist_ok=True)
    workspace.diagram_path("patterns").write_text("{}")
    reached = []
    monkeypatch.setattr(
        "codechroma.context.patterns_generator.provider_from_env",
        lambda: reached.append(True) or object(),
    )

    bootstrap_if_missing(workspace, "patterns")

    assert reached == []


def test_a_borrowed_c1_source_root_points_the_diagram_at_another_checkout(tmp_path):
    main_root = tmp_path / "main"
    workspace = Workspace.create(
        "pr-12", tmp_path / "pr-12", lambda _m: None, c1_source_root=main_root
    )

    assert workspace.diagram_path("c1").parent.parent.parent.parent == main_root
    assert workspace.layout_store("c1").path.parent.parent == main_root
    # The review artifact stays the workspace's own — only the diagram is borrowed.
    assert workspace.impact_changes_path.parent.parent == tmp_path / "pr-12"


def test_register_carries_its_options_into_the_lazy_bring_up(registry, repo):
    workspaces, _events = registry
    workspaces.register("pr-12", repo, base_ref="master", read_only=True, c1_source_root=repo)

    workspace = workspaces.get("pr-12")

    assert workspaces.is_read_only("pr-12")
    assert workspace.base_ref == "master"
    assert workspace.c1_source_root == repo


def test_is_read_only_is_false_for_main_and_for_an_unknown_id(registry, tmp_path):
    workspaces, _events = registry
    workspaces.register("refund-flow", tmp_path / "agent")

    assert not workspaces.is_read_only(MAIN_ID)
    assert not workspaces.is_read_only("refund-flow")
    assert not workspaces.is_read_only("nobody-registered-this")


def test_drop_live_unloads_a_workspace_but_keeps_it_registered(registry, repo):
    workspaces, _events = registry
    workspaces.register("agent-a", repo)
    workspaces.get("agent-a")

    dropped = workspaces.drop_live("agent-a")

    assert dropped
    assert not workspaces.is_live("agent-a")
    assert workspaces.is_registered("agent-a")


def test_drop_live_refuses_main_and_shrugs_at_an_unloaded_workspace(registry, tmp_path):
    workspaces, _events = registry
    workspaces.register("agent-a", tmp_path / "agent-a")

    assert not workspaces.drop_live(MAIN_ID)
    assert not workspaces.drop_live("agent-a")
    assert workspaces.is_live(MAIN_ID)


def test_concurrent_get_calls_for_a_new_workspace_bring_it_up_only_once(
    registry, repo, monkeypatch
):
    workspaces, _events = registry
    workspaces.register("agent-a", repo)
    calls = []
    original_analyze = Workspace.analyze

    def slow_analyze(self, seed_from=None):
        calls.append(self)
        time.sleep(0.2)
        original_analyze(self, seed_from=seed_from)

    monkeypatch.setattr(Workspace, "analyze", slow_analyze)
    results: list[Workspace] = []
    threads = [
        threading.Thread(target=lambda: results.append(workspaces.get("agent-a"))) for _ in range(5)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    # Only one Workspace was ever analyzed, and every caller got that same instance back.
    assert len(calls) == 1
    assert len({id(result) for result in results}) == 1
    assert results[0].state == STATE_READY


def test_shares_workspace_with_reuses_the_target_workspace_instance(registry, repo, monkeypatch):
    workspaces, _events = registry
    workspaces.register("agent-a", repo)
    analyzed = []
    monkeypatch.setattr(Workspace, "analyze", lambda self, seed_from=None: analyzed.append(self))
    workspaces.get("agent-a")
    workspaces.register("agent-b", repo, shares_workspace_with="agent-a")

    shared = workspaces.get("agent-b")

    assert shared is workspaces.get("agent-a")
    assert len(analyzed) == 1


def test_shares_workspace_with_main_never_builds_its_own_workspace(registry, tmp_path):
    workspaces, _events = registry
    workspaces.register("agent-a", tmp_path / "agent-a", shares_workspace_with=MAIN_ID)

    assert workspaces.get("agent-a") is workspaces.main
    assert workspaces.is_live("agent-a")


def test_unregistering_one_alias_keeps_the_shared_workspace_live(registry, repo):
    workspaces, _events = registry
    workspaces.register("agent-a", repo)
    workspaces.register("agent-b", repo, shares_workspace_with="agent-a")
    workspaces.get("agent-b")

    workspaces.unregister("agent-b")

    assert not workspaces.is_registered("agent-b")
    assert workspaces.is_live("agent-a")


def test_unregistering_the_last_alias_drops_the_shared_workspace(registry, repo):
    workspaces, _events = registry
    workspaces.register("agent-a", repo)
    workspaces.register("agent-b", repo, shares_workspace_with="agent-a")
    workspaces.get("agent-b")

    workspaces.unregister("agent-b")
    workspaces.unregister("agent-a")

    assert not workspaces.is_live("agent-a")


def test_unregistering_the_canonical_first_keeps_the_surviving_alias_working(registry, repo):
    workspaces, _events = registry
    workspaces.register("agent-a", repo)
    workspaces.register("agent-b", repo, shares_workspace_with="agent-a")
    workspaces.get("agent-b")

    workspaces.unregister("agent-a")

    assert workspaces.is_live("agent-b")
    assert workspaces.state("agent-b")["state"] != "error"


def test_unregistering_the_canonical_first_deregisters_it_despite_the_surviving_alias(
    registry, repo
):
    """The deleted canonical stops being registered/live, even though `agent-b` keeps working."""
    workspaces, _events = registry
    workspaces.register("agent-a", repo)
    workspaces.register("agent-b", repo, shares_workspace_with="agent-a")
    workspaces.get("agent-b")

    workspaces.unregister("agent-a")

    assert not workspaces.is_registered("agent-a")
    assert not workspaces.is_live("agent-a")
    assert workspaces.root_for("agent-a") is None
    assert workspaces.is_registered("agent-b")


def test_unregistering_the_surviving_alias_then_cleans_up_the_dead_canonical(registry, repo):
    workspaces, _events = registry
    workspaces.register("agent-a", repo)
    workspaces.register("agent-b", repo, shares_workspace_with="agent-a")
    workspaces.get("agent-b")

    workspaces.unregister("agent-a")
    workspaces.unregister("agent-b")

    assert not workspaces.is_registered("agent-a")
    assert not workspaces.is_registered("agent-b")
    assert not workspaces.is_live("agent-a")
