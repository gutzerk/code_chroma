"""TestClient coverage for the /agents CRUD routes on bridge/routes/agents.py."""

import asyncio
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge.agents import publish, worktree
from codechroma.bridge.agents.manager import max_agents
from codechroma.terminal import server as terminal_server
from tests.conftest import diagram_json_path, pr_record

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


@pytest.fixture
def client(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))

    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo, bridge


def test_agents_list_starts_empty_on_main(client):
    test_client, _repo, _server = client

    response = test_client.get("/agents")

    body = response.json()
    assert response.status_code == 200
    assert body == {"agents": [], "active_workspace": "main", "max_agents": max_agents()}


def test_post_agents_creates_a_branch_and_a_worktree(client):
    test_client, repo, _server = client

    response = test_client.post("/agents", json={"title": "refund flow"})

    body = response.json()
    assert response.status_code == 200
    assert body["id"] == "refund-flow"
    assert body["branch"] == "agent/refund-flow"
    assert (Path(body["worktree"]) / "shared" / "text_utils.py").exists()
    assert (
        "agent/refund-flow"
        in subprocess.run(
            ["git", "branch", "--list", "agent/refund-flow"],
            cwd=repo,
            capture_output=True,
            text=True,
        ).stdout
    )


def test_post_agents_does_not_start_a_process(client):
    test_client, _repo, _server = client

    body = test_client.post("/agents", json={"title": "refund flow"}).json()

    assert body["pid"] is None
    assert body["status"] == "stopped"


def test_post_agents_persists_the_view_context(client):
    test_client, _repo, _server = client

    body = test_client.post(
        "/agents", json={"title": "refund flow", "context": "the C1 diagram"}
    ).json()

    assert body["context"] == "the C1 diagram"


def test_post_agents_rejects_a_non_string_context(client):
    test_client, _repo, _server = client

    response = test_client.post("/agents", json={"title": "refund flow", "context": 42})

    assert response.status_code == 400


def test_post_agents_persists_a_task_context_kind(client):
    test_client, _repo, _server = client

    body = test_client.post(
        "/agents",
        json={
            "title": "draw a diagram",
            "context": "What do you want to visualize?",
            "context_kind": "task",
        },
    ).json()

    assert body["context_kind"] == "task"


def test_post_agents_defaults_context_kind_to_view(client):
    test_client, _repo, _server = client

    body = test_client.post("/agents", json={"title": "refund flow", "context": "hi"}).json()

    assert body["context_kind"] == "view"


def test_post_agents_rejects_an_unknown_context_kind(client):
    test_client, _repo, _server = client

    response = test_client.post(
        "/agents", json={"title": "refund flow", "context": "hi", "context_kind": "nonsense"}
    )

    assert response.status_code == 400


def test_post_agents_installs_the_skills_into_the_worktree(client):
    test_client, _repo, _server = client

    body = test_client.post("/agents", json={"title": "refund flow"}).json()

    skills = Path(body["worktree"]) / ".claude" / "skills"
    assert (skills / "codechroma-draw-diagram").is_dir()
    assert (skills / "codechroma-review-diagram").is_dir()


def test_post_agents_seeds_diagrams_from_main_into_the_worktree(client):
    test_client, repo, _server = client
    diagram_json_path(repo, "patterns").parent.mkdir(parents=True, exist_ok=True)
    diagram_json_path(repo, "patterns").write_text(json.dumps({"nodes": []}))
    diagram_json_path(repo, "c1").parent.mkdir(parents=True, exist_ok=True)
    diagram_json_path(repo, "c1").write_text(json.dumps({"blocks": []}))

    body = test_client.post("/agents", json={"title": "refund flow"}).json()

    worktree_atlas = Path(body["worktree"]) / ".codechroma" / "diagrams"
    assert json.loads((worktree_atlas / "patterns" / "patterns.json").read_text()) == {"nodes": []}
    assert json.loads((worktree_atlas / "c1" / "c1.json").read_text()) == {"blocks": []}


def test_post_agents_can_attach_to_main_instead_of_forking_a_branch(client):
    test_client, repo, _server = client

    body = test_client.post("/agents", json={"title": "sidecar", "attach_to": "main"}).json()

    assert body["worktree"] == str(repo)
    assert (
        body["branch"]
        == subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo, capture_output=True, text=True
        ).stdout.strip()
    )
    assert (
        subprocess.run(
            ["git", "branch", "--list", "agent/sidecar"], cwd=repo, capture_output=True, text=True
        ).stdout.strip()
        == ""
    )


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


def test_post_agents_attach_to_an_unknown_id_is_404(client):
    test_client, _repo, _server = client

    response = test_client.post("/agents", json={"title": "helper", "attach_to": "nobody"})

    assert response.status_code == 404


def test_post_agents_rejects_a_non_string_attach_to(client):
    test_client, _repo, _server = client

    response = test_client.post("/agents", json={"title": "helper", "attach_to": 123})

    assert response.status_code == 400


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


def test_post_agents_registers_a_pr_attached_agent_under_its_own_canonical_workspace(
    client, tmp_path
):
    test_client, _repo, bridge = client
    pr_path = _pr_worktree(tmp_path)
    bridge.pr_manager.upsert(pr_record(282, str(pr_path)))

    body = test_client.post("/agents", json={"title": "fix", "attach_to": "pr-282"}).json()

    assert bridge.registry.root_for(body["id"]) == Path(body["worktree"])


def test_post_agents_attach_to_a_closed_pr_is_404(client):
    test_client, _repo, _server = client

    response = test_client.post("/agents", json={"title": "fix", "attach_to": "pr-999"})

    assert response.status_code == 404


def test_post_agents_attaching_to_a_pr_reuses_its_existing_diagrams(client, tmp_path):
    test_client, _repo, bridge = client
    pr_path = _pr_worktree(tmp_path)
    diagram_json_path(pr_path, "c1").parent.mkdir(parents=True, exist_ok=True)
    diagram_json_path(pr_path, "c1").write_text(json.dumps({"blocks": ["pr-own"]}))
    bridge.pr_manager.upsert(pr_record(282, str(pr_path)))

    body = test_client.post("/agents", json={"title": "fix", "attach_to": "pr-282"}).json()

    worktree_path = Path(body["worktree"])
    assert worktree_path == pr_path
    assert json.loads(diagram_json_path(worktree_path, "c1").read_text()) == {"blocks": ["pr-own"]}


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


def test_post_agents_rejects_a_non_string_title(client):
    test_client, _repo, _server = client

    response = test_client.post("/agents", json={"title": 123})

    assert response.status_code == 400


def test_post_agents_rejects_an_unknown_kind(client):
    test_client, _repo, _server = client

    response = test_client.post("/agents", json={"title": "x", "kind": "rm -rf"})

    assert response.status_code == 400


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
    assert (
        "agent/keeper"
        in subprocess.run(
            ["git", "branch", "--list", "agent/keeper"], cwd=repo, capture_output=True, text=True
        ).stdout
    )


def test_delete_removes_the_worktree_and_branch_when_asked(client):
    test_client, repo, _server = client
    created = test_client.post("/agents", json={"title": "gone"}).json()

    response = test_client.delete("/agents/gone?worktree=true&branch=true")

    assert response.status_code == 200
    assert not Path(created["worktree"]).exists()
    assert (
        subprocess.run(
            ["git", "branch", "--list", "agent/gone"], cwd=repo, capture_output=True, text=True
        ).stdout.strip()
        == ""
    )


def test_delete_refuses_a_dirty_worktree_without_force(client):
    test_client, _repo, _server = client
    created = test_client.post("/agents", json={"title": "dirty"}).json()
    (Path(created["worktree"]) / "shared" / "text_utils.py").write_text("changed = True\n")

    response = test_client.delete("/agents/dirty?worktree=true")

    assert response.status_code == 409
    assert Path(created["worktree"]).is_dir()


def test_delete_with_force_drops_a_dirty_worktree(client):
    test_client, _repo, _server = client
    created = test_client.post("/agents", json={"title": "dirty"}).json()
    (Path(created["worktree"]) / "shared" / "text_utils.py").write_text("changed = True\n")

    response = test_client.delete("/agents/dirty?worktree=true&force=true")

    assert response.status_code == 200
    assert not Path(created["worktree"]).exists()


def test_delete_refuses_a_worktree_still_shared_by_another_agent(client):
    test_client, _repo, _server = client
    target = test_client.post("/agents", json={"title": "refund flow"}).json()
    test_client.post("/agents", json={"title": "helper", "attach_to": target["id"]})

    response = test_client.delete(f"/agents/{target['id']}?worktree=true&branch=true")

    assert response.status_code == 409
    assert Path(target["worktree"]).is_dir()


def test_delete_refuses_mains_worktree_via_an_attached_agent(client):
    test_client, repo, _server = client
    test_client.post("/agents", json={"title": "sidecar", "attach_to": "main"})

    response = test_client.delete("/agents/sidecar?worktree=true&branch=true")

    assert response.status_code == 409
    assert repo.is_dir()


def test_delete_unknown_agent_is_404(client):
    test_client, _repo, _server = client

    response = test_client.delete("/agents/never-existed")

    assert response.status_code == 404


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

    stored = json.loads((repo / ".codechroma" / "agents.json").read_text())
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
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    (repo / ".codechroma").mkdir(exist_ok=True)
    (repo / ".codechroma" / "agents.json").write_text("{ this is not json")
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
    (project / "app.py").write_text("value = 1\n")
    (project / ".env").write_text("SECRET=1")
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
    binary.write_text("#!/bin/sh\necho ready\nexec cat\n")
    binary.chmod(0o755)


@pytest.fixture
def started_client(client, tmp_path, monkeypatch):
    """Context-managed: an agent PTY needs one event loop that outlives a single request."""
    test_client, repo, bridge = client
    _stub_claude(tmp_path)
    monkeypatch.setenv("PATH", f"{tmp_path / 'bin'}:{os.environ['PATH']}")
    with test_client as live:
        yield live, repo, bridge


def test_start_brings_up_the_pty_and_reports_a_pid(started_client):
    test_client, _repo, bridge = started_client
    test_client.post("/agents", json={"title": "runner"})

    response = test_client.post("/agents/runner/start", json={})

    body = response.json()
    assert response.status_code == 200
    # `idle`, not `running`: the LED reports what the detector reads, not that a process exists.
    assert body["status"] == "idle"
    assert body["pid"] is not None
    assert bridge.agent_sessions.is_running("runner")


def test_a_fresh_start_consumes_the_pending_context(started_client):
    test_client, _repo, bridge = started_client
    test_client.post("/agents", json={"title": "runner", "context": "the epics AI brief"})
    assert bridge.agent_manager.get("runner").context == "the epics AI brief"

    test_client.post("/agents/runner/start", json={})

    # Consumed synchronously in the route (before the background PTY nudge fires), so a resume
    # or a later restart can never re-inject the line.
    assert bridge.agent_manager.get("runner").context is None


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

def test_a_fresh_start_without_context_leaves_the_field_none(started_client):
    test_client, _repo, bridge = started_client
    test_client.post("/agents", json={"title": "runner"})

    test_client.post("/agents/runner/start", json={})

    assert bridge.agent_manager.get("runner").context is None


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

    assert seen.get("codechroma_WORKSPACE_ID") == "runner"


def test_start_is_idempotent_for_an_already_running_agent(started_client):
    test_client, _repo, _server = started_client
    test_client.post("/agents", json={"title": "runner"})

    first = test_client.post("/agents/runner/start", json={}).json()
    second = test_client.post("/agents/runner/start", json={}).json()

    assert first["pid"] == second["pid"]


def test_resume_is_refused_without_a_recorded_session(started_client):
    test_client, _repo, _server = started_client
    test_client.post("/agents", json={"title": "runner"})

    response = test_client.post("/agents/runner/start", json={"resume": True})

    assert response.status_code == 409
    assert "resume" in response.json()["detail"]


def test_start_reports_a_missing_claude_binary_instead_of_a_dead_agent(client, monkeypatch):
    test_client, _repo, _server = client
    test_client.post("/agents", json={"title": "runner"})
    monkeypatch.setattr("shutil.which", lambda _name: None)

    response = test_client.post("/agents/runner/start", json={})

    assert response.status_code == 409
    assert "not found on PATH" in response.json()["detail"]


def test_start_on_an_unknown_agent_is_404(client):
    test_client, _repo, _server = client

    response = test_client.post("/agents/nobody/start", json={})

    assert response.status_code == 404


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
    test_client.patch("/agents/one/window", json={"x": 42, "y": 84, "z": 9})
    _fake_running_pid(repo)

    body = TestClient(make_bridge(repo).app).get("/agents").json()

    assert [entry["id"] for entry in body["agents"]] == ["one", "two"]
    assert {entry["status"] for entry in body["agents"]} == {"stopped"}
    assert all(entry["pid"] is None for entry in body["agents"])


def test_a_restart_keeps_window_geometry_and_stacking_order(client, make_bridge):
    test_client, repo, _server = client
    test_client.post("/agents", json={"title": "one"})
    test_client.patch("/agents/one/window", json={"x": 42, "y": 84, "z": 9, "minimized": True})

    window = TestClient(make_bridge(repo).app).get("/agents").json()["agents"][0]["window"]

    assert window == {"x": 42, "y": 84, "width": 720, "height": 480, "minimized": True, "z": 9}


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


def test_resume_runs_claude_with_the_recorded_session_id(started_client, tmp_path, monkeypatch):
    test_client, _repo, bridge = started_client
    created = test_client.post("/agents", json={"title": "runner"}).json()
    _write_transcript(tmp_path, Path(created["worktree"]), "abc-123")
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "claude"))

    test_client.post("/agents/runner/start", json={"resume": True})

    assert bridge.agent_sessions.get("runner").argv[-2:] == ["--resume", "abc-123"]


def _fake_running_pid(repo: Path) -> None:
    """Writes a pid into agents.json the way a live session would, to prove startup clears it."""
    path = repo / ".codechroma" / "agents.json"
    stored = json.loads(path.read_text())
    stored["agents"][0]["pid"] = 999999
    path.write_text(json.dumps(stored))


def _write_transcript(root: Path, worktree: Path, session_id: str) -> None:
    """A transcript recorded in `worktree`, so session discovery has something to find."""
    directory = root / "claude" / "projects" / "whatever-the-escaping-is"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{session_id}.jsonl").write_text(
        json.dumps({"type": "user", "cwd": str(worktree.resolve()), "sessionId": session_id}) + "\n"
    )


def test_pr_preflight_reports_the_reason_before_the_button_renders(client, monkeypatch):
    test_client, _repo, _server = client
    test_client.post("/agents", json={"title": "publisher"})
    monkeypatch.setattr("shutil.which", lambda _name: None)

    body = test_client.get("/agents/publisher/pr-preflight").json()

    assert body["ready"] is False
    assert body["text"] == "GitHub CLI required"


def test_pr_preflight_on_an_unknown_agent_is_404(client):
    test_client, _repo, _server = client

    assert test_client.get("/agents/nobody/pr-preflight").status_code == 404


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


def test_get_branch_reports_mains_current_branch(client):
    test_client, repo, _server = client
    current = subprocess.run(
        ["git", "branch", "--show-current"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()

    body = test_client.get("/agents/branch").json()

    assert body["current"] == current
    assert current in body["branches"]


def test_post_branch_checks_out_and_broadcasts(client):
    test_client, repo, _server = client
    subprocess.run(["git", "branch", "feature-x"], cwd=repo, check=True, capture_output=True)

    response = test_client.post("/agents/branch", json={"branch": "feature-x"})

    assert response.status_code == 200
    assert response.json()["current"] == "feature-x"
    assert test_client.get("/agents/branch").json()["current"] == "feature-x"


def test_post_branch_404s_on_an_unknown_branch(client):
    test_client, _repo, _server = client

    response = test_client.post("/agents/branch", json={"branch": "does-not-exist"})

    assert response.status_code == 404


def test_post_branch_409s_when_the_target_branch_would_overwrite_a_local_change(client):
    test_client, repo, _server = client
    before = subprocess.run(
        ["git", "branch", "--show-current"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    subprocess.run(
        ["git", "checkout", "-b", "feature-x"], cwd=repo, check=True, capture_output=True
    )
    (repo / "shared" / "text_utils.py").write_text("changed_on = 'feature-x'\n")
    subprocess.run(
        ["git", "commit", "-am", "change on feature-x"], cwd=repo, check=True, capture_output=True
    )
    subprocess.run(["git", "checkout", before], cwd=repo, check=True, capture_output=True)
    (repo / "shared" / "text_utils.py").write_text("dirty = 1\n")

    response = test_client.post("/agents/branch", json={"branch": "feature-x"})

    assert response.status_code == 409


def test_post_branch_carries_over_a_local_change_the_target_branch_does_not_touch(client):
    test_client, repo, _server = client
    subprocess.run(["git", "branch", "feature-x"], cwd=repo, check=True, capture_output=True)
    (repo / "shared" / "text_utils.py").write_text("dirty = 1\n")

    response = test_client.post("/agents/branch", json={"branch": "feature-x"})

    assert response.status_code == 200
    assert (repo / "shared" / "text_utils.py").read_text() == "dirty = 1\n"


# Such a branch could only answer "already used by worktree at ...", so it never reaches the UI.
def test_get_branch_omits_a_branch_another_worktree_holds(client, tmp_path):
    test_client, repo, _server = client
    subprocess.run(["git", "branch", "feature-x"], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "worktree", "add", str(tmp_path / "held"), "feature-x"],
        cwd=repo,
        check=True,
        capture_output=True,
    )

    body = test_client.get("/agents/branch").json()

    assert "feature-x" not in body["branches"]
    assert body["current"] in body["branches"]


def test_get_branch_omits_the_branch_an_agent_was_created_on(client):
    test_client, _repo, _server = client
    created = test_client.post("/agents", json={"title": "refund flow"}).json()

    body = test_client.get("/agents/branch").json()

    assert created["branch"] not in body["branches"]


def test_a_new_agent_reports_the_branch_main_was_on_as_its_base(client):
    test_client, repo, _server = client
    subprocess.run(["git", "checkout", "-b", "dataflow"], cwd=repo, check=True, capture_output=True)

    body = test_client.post("/agents", json={"title": "refund flow"}).json()

    assert body["base_branch"] == "dataflow"


# 🔴 An attached agent's `claude` runs in main's own tree; a checkout would swap the files under it.
def test_post_branch_409s_while_a_live_agent_works_in_mains_own_tree(started_client):
    test_client, repo, _server = started_client
    subprocess.run(["git", "branch", "feature-x"], cwd=repo, check=True, capture_output=True)
    test_client.post("/agents", json={"title": "sidecar", "attach_to": "main"})
    test_client.post("/agents/sidecar/start", json={})

    response = test_client.post("/agents/branch", json={"branch": "feature-x"})

    assert response.status_code == 409
    assert "sidecar" in response.json()["detail"]


def test_post_branch_allows_the_switch_once_that_agent_is_stopped(started_client):
    test_client, repo, _server = started_client
    subprocess.run(["git", "branch", "feature-x"], cwd=repo, check=True, capture_output=True)
    test_client.post("/agents", json={"title": "sidecar", "attach_to": "main"})
    test_client.post("/agents/sidecar/start", json={})
    test_client.post("/agents/sidecar/stop", json={})

    response = test_client.post("/agents/branch", json={"branch": "feature-x"})

    assert response.status_code == 200


def test_an_attached_to_main_agents_reported_branch_follows_the_switch(started_client):
    """A record snapshotted `branch`/`base_branch` at creation; both must track main live."""
    test_client, repo, _server = started_client
    subprocess.run(["git", "branch", "feature-x"], cwd=repo, check=True, capture_output=True)
    test_client.post("/agents", json={"title": "sidecar", "attach_to": "main"})
    test_client.post("/agents/sidecar/start", json={})
    test_client.post("/agents/sidecar/stop", json={})
    test_client.post("/agents/branch", json={"branch": "feature-x"})

    body = test_client.get("/agents").json()

    sidecar = next(agent for agent in body["agents"] if agent["id"] == "sidecar")
    assert (sidecar["branch"], sidecar["base_branch"]) == ("feature-x", "feature-x")


# An agent in its own worktree is untouched by main's checkout -- the whole point of worktrees.
def test_post_branch_ignores_a_live_agent_that_has_its_own_worktree(started_client):
    test_client, repo, _server = started_client
    subprocess.run(["git", "branch", "feature-x"], cwd=repo, check=True, capture_output=True)
    test_client.post("/agents", json={"title": "refund flow"})
    test_client.post("/agents/refund-flow/start", json={})

    response = test_client.post("/agents/branch", json={"branch": "feature-x"})

    assert response.status_code == 200


def test_post_branch_409s_rather_than_404s_on_a_worktree_conflict(client, tmp_path):
    test_client, repo, _server = client
    subprocess.run(["git", "branch", "feature-x"], cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ["git", "worktree", "add", str(tmp_path / "other-worktree"), "feature-x"],
        cwd=repo,
        check=True,
        capture_output=True,
    )

    response = test_client.post("/agents/branch", json={"branch": "feature-x"})

    assert response.status_code == 409


def test_post_branch_update_fast_forwards_main_from_its_upstream(client, tmp_path):
    test_client, repo, _server = client
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "--bare", str(origin)], check=True, capture_output=True)
    subprocess.run(
        ["git", "remote", "add", "origin", str(origin)], cwd=repo, check=True, capture_output=True
    )
    subprocess.run(
        ["git", "push", "-u", "origin", "main"], cwd=repo, check=True, capture_output=True
    )
    feeder = tmp_path / "feeder"
    subprocess.run(["git", "clone", str(origin), str(feeder)], check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "t@example.com"], cwd=feeder, check=True)
    subprocess.run(["git", "config", "user.name", "T"], cwd=feeder, check=True)
    (feeder / "shared" / "text_utils.py").write_text("value = 9\n")
    subprocess.run(["git", "add", "-A"], cwd=feeder, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "feeder change"], cwd=feeder, check=True, capture_output=True
    )
    subprocess.run(["git", "push"], cwd=feeder, check=True, capture_output=True)

    body = test_client.post("/agents/branch/update").json()

    assert (repo / "shared" / "text_utils.py").read_text() == "value = 9\n"
    assert body["current"] == "main"


def test_post_branch_update_409s_while_a_live_agent_works_in_main(started_client):
    test_client, _repo, _server = started_client
    test_client.post("/agents", json={"title": "sidecar", "attach_to": "main"})
    test_client.post("/agents/sidecar/start", json={})

    response = test_client.post("/agents/branch/update")

    assert response.status_code == 409
    assert "sidecar" in response.json()["detail"]
