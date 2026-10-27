"""TestClient coverage for the /agents CRUD routes on bridge/routes/agents.py."""

import asyncio
import io
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from codechroma.bridge.agents import publish, worktree
from codechroma.bridge.agents import session_ownership as ownership
from codechroma.bridge.agents.manager import AgentManager, max_agents
from codechroma.terminal import server as terminal_server
from tests.conftest import TabClient as TestClient
from tests.conftest import copy_sample_repo, diagram_json_path, pr_record


@pytest.fixture
def client(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    copy_sample_repo(repo)
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))

    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo, bridge


def test_agents_list_starts_empty_on_main(client):
    test_client, _repo, _server = client

    response = test_client.get("/agents")

    body = response.json()
    assert response.status_code == 200
    assert body == {"agents": [], "active_workspace": "main", "max_agents": max_agents()}


def test_post_agents_joins_its_tabs_worktree_without_a_branch_of_its_own(client):
    test_client, repo, _server = client
    tab = test_client.post("/branches/ensure").json()["branches"][0]

    response = test_client.post("/agents", json={"title": "refund flow", "workspace": tab["id"]})

    body = response.json()
    assert response.status_code == 200
    assert body["id"] == "refund-flow"
    assert body["workspace"] == tab["id"]
    assert body["worktree"] == tab["worktree"]
    assert body["branch"] == "wt-1"
    assert (Path(body["worktree"]) / "shared" / "text_utils.py").exists()
    assert subprocess.run(
        ["git", "branch", "--list", "agent/*"], cwd=repo, capture_output=True, text=True
    ).stdout.strip() == ""


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "refund flow", "context": 42},
        {"title": "refund flow", "context": "hi", "context_kind": "nonsense"},
        {"title": "helper", "attach_to": 123},
        {"title": 123},
        {"title": "x", "kind": "rm -rf"},
        {"title": "sidecar", "attach_to": "main"},
    ],
    ids=[
        "non-string-context",
        "unknown-context-kind",
        "non-string-attach-to",
        "non-string-title",
        "unknown-kind",
        "attach-to-main",
    ],
)
def test_post_agents_rejects_an_invalid_payload(client, payload):
    test_client, _repo, _server = client

    response = test_client.post("/agents", json=payload)

    assert response.status_code == 400


def test_post_agents_persists_context_and_does_not_start_a_process(client):
    test_client, _repo, _server = client

    view = test_client.post("/agents", json={"title": "refund flow", "context": "the C1"}).json()
    task = test_client.post(
        "/agents", json={"title": "draw", "context": "What?", "context_kind": "task"}
    ).json()

    assert (view["context"], view["context_kind"]) == ("the C1", "view")
    assert task["context_kind"] == "task"
    assert view["pid"] is None
    assert view["status"] == "stopped"


def test_post_agents_installs_the_skills_into_the_worktree(client):
    test_client, _repo, _server = client

    body = test_client.post("/agents", json={"title": "refund flow"}).json()

    skills = Path(body["worktree"]) / ".claude" / "skills"
    assert (skills / "codechroma-draw-diagram").is_dir()
    assert (skills / "codechroma-review-diagram").is_dir()


def test_post_agents_seeds_diagrams_from_main_into_the_worktree(client):
    test_client, repo, _server = client
    diagram_json_path(repo, "patterns").parent.mkdir(parents=True, exist_ok=True)
    diagram_json_path(repo, "patterns").write_text(json.dumps({"nodes": []}), encoding="utf-8")
    diagram_json_path(repo, "c1").parent.mkdir(parents=True, exist_ok=True)
    diagram_json_path(repo, "c1").write_text(json.dumps({"blocks": []}), encoding="utf-8")

    body = test_client.post("/agents", json={"title": "refund flow"}).json()

    worktree_atlas = Path(body["worktree"]) / ".codechroma" / "diagrams"
    assert json.loads(
        (worktree_atlas / "patterns" / "patterns.json").read_text(encoding="utf-8")
    ) == {"nodes": []}
    assert json.loads((worktree_atlas / "c1" / "c1.json").read_text(encoding="utf-8")) == {
        "blocks": []
    }


def test_post_agents_without_a_workspace_is_a_400(client):
    test_client, _repo, _server = client

    response = test_client.post("/agents", json={"title": "sidecar", "workspace": None})

    assert response.status_code == 400
    assert response.json()["detail"] == "workspace is required"


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "s", "workspace": "br_nope"},
        {"title": "helper", "attach_to": "nobody"},
        {"title": "fix", "attach_to": "pr-999"},
    ],
    ids=["unknown-workspace", "unknown-agent", "closed-pr"],
)
def test_post_agents_with_an_unknown_target_is_404(client, payload):
    test_client, _repo, _server = client

    response = test_client.post("/agents", json=payload)

    assert response.status_code == 404


def test_post_agents_can_attach_to_another_agents_worktree(client):
    test_client, _repo, _server = client
    target = test_client.post("/agents", json={"title": "refund flow"}).json()

    attached = test_client.post(
        "/agents", json={"title": "helper", "attach_to": target["id"]}
    ).json()

    assert attached["worktree"] == target["worktree"]
    assert attached["branch"] == target["branch"]


def test_attach_sharing_survives_a_bridge_restart(client, make_bridge):
    test_client, repo, _server = client
    target = test_client.post("/agents", json={"title": "refund flow"}).json()
    attached = test_client.post(
        "/agents", json={"title": "helper", "attach_to": target["id"]}
    ).json()

    restarted = make_bridge(repo)

    assert restarted.registry.get(attached["id"]) is restarted.registry.get(target["id"])


def _pr_worktree(tmp_path: Path) -> Path:
    """A plain directory standing in for an already-imported PR's worktree -- no real git needed."""
    path = tmp_path / "pr-worktree"
    path.mkdir()
    return path


def test_post_agents_can_attach_to_a_pr_by_sharing_its_worktree(client, tmp_path):
    test_client, _repo, bridge = client
    pr_path = _pr_worktree(tmp_path)
    bridge.pr_manager.upsert(pr_record(282, str(pr_path)))

    body = test_client.post("/agents", json={"title": "fix", "attach_to": "pr-282"}).json()

    assert body["worktree"] == str(pr_path)
    assert body["shares_workspace_with"] == "pr-282"
    assert bridge.registry.root_for(body["id"]) == Path(body["worktree"])


def test_post_agents_attaching_to_a_pr_reuses_its_existing_diagrams(client, tmp_path):
    test_client, _repo, bridge = client
    pr_path = _pr_worktree(tmp_path)
    diagram_json_path(pr_path, "c1").parent.mkdir(parents=True, exist_ok=True)
    diagram_json_path(pr_path, "c1").write_text(
        json.dumps({"blocks": ["pr-own"]}), encoding="utf-8"
    )
    bridge.pr_manager.upsert(pr_record(282, str(pr_path)))

    body = test_client.post("/agents", json={"title": "fix", "attach_to": "pr-282"}).json()

    worktree_path = Path(body["worktree"])
    assert worktree_path == pr_path
    assert json.loads(diagram_json_path(worktree_path, "c1").read_text(encoding="utf-8")) == {
        "blocks": ["pr-own"]
    }


def test_a_pr_attached_agents_worktree_cannot_be_deleted_through_it(client, tmp_path):
    test_client, _repo, bridge = client
    pr_path = _pr_worktree(tmp_path)
    bridge.pr_manager.upsert(pr_record(282, str(pr_path)))
    created = test_client.post("/agents", json={"title": "fix", "attach_to": "pr-282"}).json()

    response = test_client.delete(f"/agents/{created['id']}?worktree=true&branch=true")

    assert response.status_code == 409
    assert pr_path.exists()


def test_post_agents_registers_the_workspace_lazily(client):
    test_client, _repo, bridge = client

    test_client.post("/agents", json={"title": "refund flow"})

    assert bridge.registry.is_registered("refund-flow")
    assert not bridge.registry.is_live("refund-flow")


def test_post_agents_falls_back_to_a_generated_title_when_none_is_given(client):
    test_client, _repo, _server = client

    response = test_client.post("/agents", json={})

    assert response.status_code == 200
    assert response.json()["title"] == response.json()["id"]


def test_a_sixth_agent_is_refused_with_409(client):
    test_client, _repo, _server = client
    for index in range(max_agents()):
        test_client.post("/agents", json={"title": f"task {index}"})

    response = test_client.post("/agents", json={"title": "one too many"})

    assert response.status_code == 409
    assert len(test_client.get("/agents").json()["agents"]) == max_agents()


def test_delete_keeps_the_worktree_and_branch_by_default(client):
    test_client, repo, _server = client
    created = test_client.post("/agents", json={"title": "keeper"}).json()

    response = test_client.delete("/agents/keeper")

    assert response.status_code == 200
    assert Path(created["worktree"]).is_dir()
    assert "wt-1" in subprocess.run(
        ["git", "branch", "--list", "wt-1"], cwd=repo, capture_output=True, text=True
    ).stdout


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("delete", "/agents/nobody"),
        ("post", "/agents/nobody/start"),
        ("get", "/agents/nobody/pr-preflight"),
    ],
)
def test_an_unknown_agent_is_404(client, method, path):
    test_client, _repo, _server = client

    response = getattr(test_client, method)(path)

    assert response.status_code == 404


def test_delete_cannot_remove_the_tabs_worktree_through_an_agent(client):
    test_client, _repo, _server = client
    created = test_client.post("/agents", json={"title": "gone"}).json()

    response = test_client.delete("/agents/gone?worktree=true&branch=true")

    assert response.status_code == 409
    assert Path(created["worktree"]).is_dir()


def test_delete_refuses_a_worktree_still_shared_by_another_agent(client):
    test_client, _repo, _server = client
    target = test_client.post("/agents", json={"title": "refund flow"}).json()
    test_client.post("/agents", json={"title": "helper", "attach_to": target["id"]})

    response = test_client.delete(f"/agents/{target['id']}?worktree=true&branch=true")

    assert response.status_code == 409
    assert Path(target["worktree"]).is_dir()


def test_delete_kills_a_running_pty_instead_of_orphaning_it(started_client):
    test_client, _repo, bridge = started_client
    test_client.post("/agents", json={"title": "runner"})
    test_client.post("/agents/runner/start", json={})

    response = test_client.delete("/agents/runner")

    assert response.status_code == 200
    assert not bridge.agent_sessions.is_running("runner")


def test_a_refused_delete_leaves_a_running_pty_alone(started_client):
    test_client, _repo, bridge = started_client
    target = test_client.post("/agents", json={"title": "refund flow"}).json()
    test_client.post("/agents/refund-flow/start", json={})
    test_client.post("/agents", json={"title": "helper", "attach_to": target["id"]})

    response = test_client.delete(f"/agents/{target['id']}?worktree=true&branch=true")

    assert response.status_code == 409
    assert bridge.agent_sessions.is_running("refund-flow")


def test_patch_window_persists_geometry(client):
    test_client, repo, _server = client
    test_client.post("/agents", json={"title": "moved"})

    response = test_client.patch(
        "/agents/moved/window", json={"x": 40, "y": 60, "minimized": True, "bogus": "ignored"}
    )

    stored = json.loads((repo / ".codechroma" / "agents.json").read_text(encoding="utf-8"))
    assert response.json()["x"] == 40
    assert response.json()["minimized"] is True
    assert stored["agents"][0]["window"]["y"] == 60
    assert "bogus" not in stored["agents"][0]["window"]


def test_agent_added_and_removed_are_broadcast(client, monkeypatch):
    test_client, _repo, bridge = client
    sent: list[dict] = []
    monkeypatch.setattr(bridge.connections, "broadcast", _recorder(sent))

    test_client.post("/agents", json={"title": "pinged"})
    test_client.delete("/agents/pinged")

    assert sent[0]["type"] == "agent-added"
    assert sent[0]["agent"]["id"] == "pinged"
    assert sent[1] == {"type": "agent-removed", "id": "pinged"}


def _recorder(sink: list[dict]):
    """An async stand-in for ConnectionManager.broadcast that just records what a route sent."""

    async def broadcast(message: dict) -> None:
        sink.append(message)

    return broadcast


def test_git_preflight_reports_ready_on_a_real_repo(client):
    test_client, _repo, _server = client

    response = test_client.get("/agents/git-preflight")

    assert response.status_code == 200
    assert response.json()["state"] == "ready"


def test_git_init_is_a_no_op_on_a_ready_repo(client):
    test_client, _repo, _server = client

    response = test_client.post("/agents/git-init", json={"extra_ignores": []})

    assert response.status_code == 200
    assert response.json()["state"] == "ready"


@pytest.fixture
def malformed_registry_client(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    copy_sample_repo(repo)
    (repo / ".codechroma").mkdir(exist_ok=True)
    (repo / ".codechroma" / "agents.json").write_text("{ this is not json", encoding="utf-8")
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))

    bridge = make_bridge(repo)
    return TestClient(bridge.app)


def test_a_malformed_agents_json_yields_an_empty_list(malformed_registry_client):
    response = malformed_registry_client.get("/agents")

    assert response.status_code == 200
    assert response.json()["agents"] == []


@pytest.fixture
def non_git_client(tmp_path, monkeypatch, make_bridge):
    project = tmp_path / "project"
    project.mkdir()
    (project / "app.py").write_text("value = 1\n", encoding="utf-8")
    (project / ".env").write_text("SECRET=1", encoding="utf-8")
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))

    return TestClient(make_bridge(project).app), project


def test_a_non_git_project_gets_a_first_commit_plan(non_git_client):
    test_client, _project = non_git_client

    body = test_client.get("/agents/git-preflight").json()

    assert body["state"] == "not-a-repo"
    # One file, not four: .env and the bridge's own synced .claude/ skills are pre-ticked.
    assert body["plan"]["file_count"] == 1
    # .claude/ is the skill folder create_app() just synced in -- a heavy dir, not the user's work.
    assert [entry["path"] for entry in body["plan"]["suspicious"]] == [".claude/", ".env"]


def test_preflight_then_git_init_then_create_agent_all_succeed(non_git_client):
    test_client, _project = non_git_client
    test_client.get("/agents/git-preflight")

    initialized = test_client.post("/agents/git-init", json={"extra_ignores": [".env"]})
    created = test_client.post("/agents", json={"title": "first task"})

    assert initialized.json()["created_repo"] is True
    assert created.status_code == 200
    assert (Path(created.json()["worktree"]) / "app.py").exists()


def _stub_claude(tmp_path: Path) -> None:
    """A fake `claude` on PATH: prints one line and reads stdin, so the PTY stays open."""
    binary = tmp_path / "bin" / "claude"
    binary.parent.mkdir(parents=True, exist_ok=True)
    binary.write_text("#!/bin/sh\necho ready\nexec cat\n", encoding="utf-8")
    binary.chmod(0o755)


def _stub_agent_start(monkeypatch, bridge, launched: dict) -> None:
    """Capture launch inputs without depending on a local Claude executable or terminal."""

    class _Session:
        pid = 4242
        status = "idle"
        exit_code = None
        is_alive = True

        def close(self):
            pass

        def terminate_process(self):
            pass

    def start(agent_id, argv, cwd, **kwargs):
        existing = bridge.agent_sessions.get(agent_id)
        if existing is not None and existing.is_alive:
            return existing
        launched.update(argv=argv, cwd=cwd, env=kwargs.get("env", {}))
        session = _Session()
        session.session_tracking_file = launched["env"].get(ownership.FILE_ENV)
        session.initial_session_id = launched["env"].get(ownership.INITIAL_ID_ENV)
        bridge.agent_sessions._sessions[agent_id] = session
        return session

    monkeypatch.setattr(bridge.agent_sessions, "start", start)


@pytest.fixture
def started_client(client, tmp_path, monkeypatch, use_test_runtime):
    """Context-managed: an agent PTY needs one event loop that outlives a single request."""
    if os.name == "nt":
        pytest.skip("uses a POSIX shebang CLI stub")
    test_client, repo, bridge = client
    _stub_claude(tmp_path)
    monkeypatch.setenv("PATH", f"{tmp_path / 'bin'}:{os.environ['PATH']}")
    use_test_runtime()
    with test_client as live:
        yield live, repo, bridge


def test_start_brings_up_the_pty_and_reports_a_pid(started_client):
    test_client, repo, bridge = started_client
    test_client.post("/agents", json={"title": "runner"})

    response = test_client.post("/agents/runner/start", json={})

    body = response.json()
    assert response.status_code == 200
    # `idle`, not `running`: the LED reports what the detector reads, not that a process exists.
    assert body["status"] == "idle"
    assert body["pid"] is not None
    assert bridge.agent_sessions.is_running("runner")
    session_id = body["session_id"]
    assert UUID(session_id).version == 4
    assert bridge.agent_sessions.get("runner").argv[-2:] == ["--session-id", session_id]
    assert AgentManager(repo).get("runner").session_id == session_id


@pytest.mark.parametrize("attach_to", [None, "sibling"])
def test_claude_agent_launch_loads_the_runtime_plugin_for_worktrees_and_attachments(
    started_client, monkeypatch, attach_to
):
    from codechroma.bridge.resources import resource_path

    test_client, _repo, bridge = started_client
    body = {"title": "plugin-agent"}
    if attach_to is not None:
        test_client.post("/agents", json={"title": attach_to})
        body["attach_to"] = attach_to
    test_client.post("/agents", json=body)
    launched = {}
    _stub_agent_start(monkeypatch, bridge, launched)

    response = test_client.post("/agents/plugin-agent/start", json={})

    argv = launched["argv"]
    assert response.status_code == 200
    assert argv[argv.index("--plugin-dir") + 1] == str(resource_path("skills").parent)


def test_nested_attached_project_skills_and_instructions_are_untouched(
    started_client, monkeypatch
):
    from codechroma.bridge.resources import resource_path

    test_client, repo, bridge = started_client
    nested_project = repo / "nested-project"
    nested_project.mkdir()
    claude_md = nested_project / "CLAUDE.md"
    claude_md.write_text("Keep this project instruction.\n", encoding="utf-8")
    user_skill = nested_project / ".claude" / "skills" / "codechroma-draw-diagram" / "SKILL.md"
    user_skill.parent.mkdir(parents=True)
    user_skill.write_text(
        "---\n"
        "name: codechroma-draw-diagram\n"
        "description: User skill\n"
        "---\n"
        "User-owned.\n"
, encoding="utf-8")
    bridge.pr_manager.upsert(pr_record(282, str(nested_project)))
    created = test_client.post(
        "/agents", json={"title": "nested-agent", "attach_to": "pr-282"}
    ).json()

    launched = {}
    _stub_agent_start(monkeypatch, bridge, launched)

    response = test_client.post(f"/agents/{created['id']}/start", json={})

    assert response.status_code == 200
    assert Path(launched["cwd"]) == nested_project
    assert launched["argv"][launched["argv"].index("--plugin-dir") + 1] == str(
        resource_path("skills").parent
    )
    assert claude_md.read_text(encoding="utf-8") == "Keep this project instruction.\n"
    assert user_skill.read_text(encoding="utf-8").endswith("User-owned.\n")


def test_a_fresh_start_consumes_the_pending_context(started_client):
    test_client, _repo, bridge = started_client
    test_client.post("/agents", json={"title": "runner", "context": "the epics AI brief"})
    assert bridge.agent_manager.get("runner").context == "the epics AI brief"

    test_client.post("/agents/runner/start", json={})

    # Consumed synchronously in the route (before the background PTY nudge fires), so a resume
    # or a later restart can never re-inject the line.
    assert bridge.agent_manager.get("runner").context is None
    test_client.post("/agents", json={"title": "bare"})
    test_client.post("/agents/bare/start", json={})
    assert bridge.agent_manager.get("bare").context is None


def test_an_agent_kind_start_records_resolved_cli(started_client, tmp_path, monkeypatch):
    """061: a provider-routed `agent` window labels itself with the binary it actually launched."""
    from codechroma.llm.call_site_settings import save_group_assignment
    from codechroma.llm.providers_store import create_provider

    provider = create_provider({"label": "Agent provider", "kind": "cli", "adapter": "claude"})
    save_group_assignment("agents", {"provider_id": provider.id, "model": "claude-opus"})
    test_client, _repo, bridge = started_client

    test_client.post("/agents", json={"title": "provider runner", "kind": "agent"})
    response = test_client.post("/agents/provider-runner/start", json={})

    body = response.json()
    assert response.status_code == 200
    assert body["resolved_cli"] == "claude"
    assert bridge.agent_manager.get("provider-runner").resolved_cli == "claude"


def test_a_claude_record_leaves_resolved_cli_empty(started_client):
    """FR-012: a legacy `claude` record is byte-for-byte unchanged — no provider store consulted."""
    test_client, _repo, bridge = started_client

    test_client.post("/agents", json={"title": "plain"})
    response = test_client.post("/agents/plain/start", json={})

    assert response.status_code == 200
    assert response.json()["resolved_cli"] == ""
    assert bridge.agent_manager.get("plain").resolved_cli == ""

def test_stop_kills_the_pty_but_keeps_the_worktree(started_client):
    test_client, _repo, bridge = started_client
    created = test_client.post("/agents", json={"title": "runner"}).json()
    test_client.post("/agents/runner/start", json={})

    response = test_client.post("/agents/runner/stop")

    assert response.json()["status"] == "stopped"
    assert not bridge.agent_sessions.is_running("runner")
    assert Path(created["worktree"]).is_dir()


def test_start_passes_the_agents_workspace_id_to_the_pty_env(started_client, monkeypatch):
    test_client, _repo, _server = started_client
    test_client.post("/agents", json={"title": "runner"})
    seen: dict[str, str] = {}

    class _StubPty:
        master_fd = -1
        pid = 4242

        def __init__(self, argv, on_output, on_exit, cwd, env=None, **kwargs):
            seen.update(env or {})
            self.returncode = None

        def resize(self, *a):
            pass

        def write(self, *a):
            pass

        def close(self):
            pass

    monkeypatch.setattr("codechroma.bridge.agents.sessions.PtySession", _StubPty)

    test_client.post("/agents/runner/start", json={})

    assert seen.get("CODECHROMA_WORKSPACE_ID") == "runner"


def test_start_is_idempotent_for_an_already_running_agent(started_client):
    test_client, _repo, _server = started_client
    test_client.post("/agents", json={"title": "runner"})

    first = test_client.post("/agents/runner/start", json={}).json()
    second = test_client.post("/agents/runner/start", json={}).json()

    assert first["pid"] == second["pid"]
    assert first["session_id"] == second["session_id"]


def test_resume_is_refused_without_a_recorded_session(started_client):
    test_client, _repo, _server = started_client
    test_client.post("/agents", json={"title": "runner"})

    response = test_client.post("/agents/runner/start", json={"resume": True})

    assert response.status_code == 409
    assert "resume" in response.json()["detail"]


def test_start_reports_a_missing_claude_binary_instead_of_a_dead_agent(client, monkeypatch):
    test_client, _repo, _server = client
    test_client.post("/agents", json={"title": "runner"})
    monkeypatch.setattr("shutil.which", lambda _name, **_kwargs: None)

    response = test_client.post("/agents/runner/start", json={})

    assert response.status_code == 409
    assert "not found on PATH" in response.json()["detail"]


def test_fresh_claude_start_persists_the_session_id_passed_to_the_cli(client, monkeypatch):
    test_client, repo, bridge = client
    test_client.post("/agents", json={"title": "runner"})
    launched = {}
    _stub_agent_start(monkeypatch, bridge, launched)

    response = test_client.post("/agents/runner/start", json={})

    session_id = response.json()["session_id"]
    assert response.status_code == 200
    assert launched["argv"][-2:] == ["--session-id", session_id]
    assert AgentManager(repo).get("runner").session_id == session_id


@pytest.mark.parametrize("source", ["clear", "resume"])
@pytest.mark.parametrize("restart", ["manual", "autostart"])
def test_session_changes_survive_manual_resume_and_autostart(
    client, monkeypatch, make_bridge, source, restart,
):
    from codechroma.bridge.agents.autostart import auto_start_agents

    test_client, repo, bridge = client
    test_client.post("/agents", json={"title": "runner"})
    launched = {}
    _stub_agent_start(monkeypatch, bridge, launched)
    first = test_client.post("/agents/runner/start", json={}).json()
    original_file = launched["env"][ownership.FILE_ENV]
    changed_id = str(uuid4())
    ownership.record(
        io.StringIO(json.dumps({"session_id": changed_id, "source": source})), original_file,
    )
    # A duplicate start must keep the current process's tracking file.
    duplicate = test_client.post("/agents/runner/start", json={}).json()
    restarted = make_bridge(repo)
    _stub_agent_start(monkeypatch, restarted, launched)

    if restart == "manual":
        response = TestClient(restarted.app).post("/agents/runner/start", json={"resume": True})
        response.raise_for_status()
    else:
        asyncio.run(auto_start_agents(restarted.services))
    active_file = launched["env"][ownership.FILE_ENV]
    ownership.record(
        io.StringIO(json.dumps({"session_id": str(uuid4())})), original_file,
    )
    captured = restarted.agent_manager.capture_session_id("runner")

    assert duplicate["session_id"] == first["session_id"]
    assert launched["argv"][-2:] == ["--resume", changed_id]
    assert active_file != original_file
    assert captured == changed_id
    assert AgentManager(repo).get("runner").session_id == changed_id


def test_cancel_all_leaves_agent_processes_alive(started_client):
    test_client, _repo, bridge = started_client
    test_client.post("/agents", json={"title": "runner"})
    pid = test_client.post("/agents/runner/start", json={}).json()["pid"]

    asyncio.run(bridge.services.cancel_skill_agents())

    os.kill(pid, 0)
    assert bridge.agent_sessions.is_running("runner")


def test_a_window_reattaches_to_the_running_agent_with_a_redraw_of_its_screen(started_client):
    test_client, _repo, _server = started_client
    test_client.post("/agents", json={"title": "runner"})
    test_client.post("/agents/runner/start", json={})

    with test_client.websocket_connect("/ws/terminal?agent=claude&workspace=runner") as socket:
        received = ""
        deadline = time.monotonic() + 5
        while "ready" not in received and time.monotonic() < deadline:
            received += socket.receive_text()

    assert "ready" in received


def test_attaching_to_a_stopped_agent_reports_it_rather_than_opening_a_shell(started_client):
    test_client, _repo, _server = started_client
    test_client.post("/agents", json={"title": "runner"})

    with test_client.websocket_connect("/ws/terminal?agent=claude&workspace=runner") as socket:
        message = json.loads(socket.receive_text()[1:])

    assert message == {"type": "error", "message": "the agent is not running"}


def test_the_plain_terminal_panel_still_gets_the_main_repo(client):
    test_client, repo, bridge = client

    resolved = terminal_server._resolve_cwd(_websocket_stub(bridge.services), "main")

    assert Path(resolved) == repo


def _websocket_stub(services):
    """A stand-in WebSocket exposing just the app.state.services the terminal socket reads."""
    _app = type("_App", (), {"state": type("_State", (), {"services": services})()})
    return type("_Ws", (), {"app": _app})()


def test_a_restart_restores_the_same_cards_all_stopped(client, monkeypatch, tmp_path, make_bridge):
    test_client, repo, _server = client
    test_client.post("/agents", json={"title": "one"})
    test_client.post("/agents", json={"title": "two"})
    test_client.patch("/agents/one/window", json={"x": 42, "y": 84, "z": 9, "minimized": True})
    _fake_running_pid(repo)

    body = TestClient(make_bridge(repo).app).get("/agents").json()

    assert [entry["id"] for entry in body["agents"]] == ["one", "two"]
    assert {entry["status"] for entry in body["agents"]} == {"stopped"}
    assert all(entry["pid"] is None for entry in body["agents"])
    assert body["agents"][0]["window"] == {
        "x": 42, "y": 84, "width": 720, "height": 480, "minimized": True, "z": 9
    }


def test_a_worktree_deleted_by_hand_is_marked_lost_rather_than_dropped(client, make_bridge):
    test_client, repo, _bridge = client
    created = test_client.post("/agents", json={"title": "lost"}).json()
    shutil.rmtree(created["worktree"])

    body = TestClient(make_bridge(repo).app).get("/agents").json()

    assert [entry["id"] for entry in body["agents"]] == ["lost"]
    assert body["agents"][0]["worktree_lost"] is True


def test_a_lost_worktree_can_be_recreated_from_its_branch(client):
    test_client, _repo, _server = client
    created = test_client.post("/agents", json={"title": "lost"}).json()
    shutil.rmtree(created["worktree"])

    response = test_client.post("/agents/lost/recreate-worktree")

    assert response.status_code == 200
    assert response.json()["worktree_lost"] is False
    assert (Path(created["worktree"]) / "shared" / "text_utils.py").exists()


def test_resume_runs_claude_with_the_recorded_session_id(started_client):
    test_client, _repo, bridge = started_client
    test_client.post("/agents", json={"title": "runner"})
    bridge.agent_manager.set_session_id("runner", "abc-123")

    test_client.post("/agents/runner/start", json={"resume": True})

    assert bridge.agent_sessions.get("runner").argv[-2:] == ["--resume", "abc-123"]


def _fake_running_pid(repo: Path) -> None:
    """Writes a pid into agents.json the way a live session would, to prove startup clears it."""
    path = repo / ".codechroma" / "agents.json"
    stored = json.loads(path.read_text(encoding="utf-8"))
    stored["agents"][0]["pid"] = 999999
    path.write_text(json.dumps(stored), encoding="utf-8")


def test_pr_preflight_reports_the_reason_before_the_button_renders(client, monkeypatch):
    test_client, _repo, _server = client
    test_client.post("/agents", json={"title": "publisher"})
    monkeypatch.setattr("shutil.which", lambda _name, **_kwargs: None)

    body = test_client.get("/agents/publisher/pr-preflight").json()

    assert body["ready"] is False
    assert body["text"] == "GitHub CLI required"


def test_creating_a_pr_records_its_url_on_the_card(client, monkeypatch, tmp_path):
    test_client, _repo, bridge = client
    test_client.post("/agents", json={"title": "publisher"})
    monkeypatch.setattr(publish, "create_pr", lambda *a, **kw: "https://github.com/acme/app/pull/5")

    body = test_client.post("/agents/publisher/pr", json={"commit_dirty": False}).json()

    assert body["pr_url"] == "https://github.com/acme/app/pull/5"
    assert test_client.get("/agents").json()["agents"][0]["pr_url"] == (
        "https://github.com/acme/app/pull/5"
    )


def test_a_failed_pr_is_a_409_carrying_gits_own_message(client, monkeypatch):
    test_client, _repo, bridge = client
    test_client.post("/agents", json={"title": "publisher"})

    def explode(*_args, **_kwargs):
        raise publish.PublishError("remote rejected the push")

    monkeypatch.setattr(publish, "create_pr", explode)
    response = test_client.post("/agents/publisher/pr", json={})

    assert response.status_code == 409
    assert response.json()["detail"] == "remote rejected the push"


def test_the_commit_dirty_choice_reaches_publish(client, monkeypatch):
    test_client, _repo, bridge = client
    test_client.post("/agents", json={"title": "publisher"})
    seen: list[bool] = []
    monkeypatch.setattr(
        publish,
        "create_pr",
        lambda *a, commit_dirty=False, **kw: (seen.append(commit_dirty), "https://x/1")[1],
    )

    test_client.post("/agents/publisher/pr", json={"commit_dirty": True})

    assert seen == [True]


def test_pr_preflight_blocks_a_pr_attached_agent_before_touching_git(client, tmp_path):
    test_client, _repo, bridge = client
    pr_path = _pr_worktree(tmp_path)
    bridge.pr_manager.upsert(pr_record(282, str(pr_path)))
    created = test_client.post("/agents", json={"title": "fix", "attach_to": "pr-282"}).json()

    body = test_client.get(f"/agents/{created['id']}/pr-preflight").json()

    assert body["ready"] is False
    assert body["reason"] == "pr-attached"


def test_creating_a_pr_is_refused_for_a_pr_attached_agent(client, tmp_path):
    """The push target for a PR-attached agent is the PR's own branch -- must never reach git."""
    test_client, _repo, bridge = client
    pr_path = _pr_worktree(tmp_path)
    bridge.pr_manager.upsert(pr_record(282, str(pr_path)))
    created = test_client.post("/agents", json={"title": "fix", "attach_to": "pr-282"}).json()

    response = test_client.post(f"/agents/{created['id']}/pr", json={"commit_dirty": True})

    assert response.status_code == 409
    assert "pr-282" in response.json()["detail"]


def test_a_new_agent_reports_its_tabs_branch_as_its_base(client):
    test_client, _repo, _server = client

    body = test_client.post("/agents", json={"title": "refund flow"}).json()

    assert body["base_branch"] == "wt-1"


def test_post_agents_registers_a_pr_attached_agent_under_its_own_canonical_workspace(
    client, tmp_path
):
    test_client, _repo, bridge = client
    pr_path = _pr_worktree(tmp_path)
    bridge.pr_manager.upsert(pr_record(282, str(pr_path)))

    body = test_client.post("/agents", json={"title": "fix", "attach_to": "pr-282"}).json()

    assert bridge.registry.root_for(body["id"]) == Path(body["worktree"])


def test_a_restart_keeps_window_geometry_and_stacking_order(client, make_bridge):
    test_client, repo, _server = client
    test_client.post("/agents", json={"title": "one"})
    test_client.patch("/agents/one/window", json={"x": 42, "y": 84, "z": 9, "minimized": True})

    window = TestClient(make_bridge(repo).app).get("/agents").json()["agents"][0]["window"]

    assert window == {"x": 42, "y": 84, "width": 720, "height": 480, "minimized": True, "z": 9}
