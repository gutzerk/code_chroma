"""TestClient coverage for the wiki-general status/generate/output/cancel routes."""


import asyncio
import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from tests.unit.fake_claude import CLI_MISSING, fake_claude_exec


def _strip_code_files(repo: Path) -> None:
    """Removes sample_repo's real code, leaving only doc/config files -- nothing to document."""
    for name in ("web", "shared", "users", "billing"):
        shutil.rmtree(repo / name, ignore_errors=True)
    (repo / "README.md").write_text("# Nothing here yet\n")
    (repo / "package.json").write_text('{"name": "empty"}\n')
    (repo / "config.yml").write_text("key: value\n")


def _manifest_json() -> str:
    return json.dumps(
        {
            "generated_at": "2026-09-14T00:00:00Z",
            "containers": [{"id": "backend", "name": "Backend", "path": "c2/backend.md"}],
            "components": [
                {
                    "id": "auth",
                    "name": "Authentication",
                    "container": "backend",
                    "path": "c3/auth.md",
                }
            ],
        }
    )


def test_status_defaults_to_idle_and_not_generated(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/wiki-general/status")

    assert response.status_code == 200
    assert response.json() == {
        "state": "idle",
        "error": None,
        "has_wiki_general": False,
        "stale": False,
        "empty": False,
    }


def test_status_reports_has_wiki_general_once_the_manifest_is_valid(bridge):
    manifest_path = bridge.repo / ".codechroma" / "wiki-general" / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(_manifest_json())

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/wiki-general/status")

    # No generated_at_commit stamp yet -- an unstamped manifest reads as stale, on purpose.
    assert response.json() == {
        "state": "idle",
        "error": None,
        "has_wiki_general": True,
        "stale": True,
        "empty": False,
    }


def test_generate_without_claude_binary_reports_error(bridge, monkeypatch):
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/wiki-general/generate")
        status_response = client.get("/repos/default/wiki-general/status")

    assert response.json() == {"state": "error", "error": CLI_MISSING}
    assert status_response.json()["state"] == "error"


def test_generate_clears_a_previous_runs_stale_pages(bridge, monkeypatch):
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)
    stale = bridge.repo / ".codechroma" / "wiki-general" / "c3" / "old-component.md"
    stale.parent.mkdir(parents=True, exist_ok=True)
    stale.write_text("stale page from a previous run")

    with TestClient(bridge.app) as client:
        client.post("/repos/default/wiki-general/generate")

    assert not stale.exists()


def test_generate_recreates_c2_and_c3_empty_so_no_subagent_has_to_mkdir(bridge, monkeypatch):
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)

    with TestClient(bridge.app) as client:
        client.post("/repos/default/wiki-general/generate")

    wiki_general = bridge.repo / ".codechroma" / "wiki-general"
    assert (wiki_general / "c2").is_dir()
    assert (wiki_general / "c3").is_dir()


def test_generate_does_not_clear_pages_while_already_generating(bridge, monkeypatch):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(hang=True))
    live = bridge.repo / ".codechroma" / "wiki-general" / "c3" / "in-progress.md"

    with TestClient(bridge.app) as client:
        client.post("/repos/default/wiki-general/generate")
        # Simulates the in-flight run having written a page of its own by now.
        live.parent.mkdir(parents=True, exist_ok=True)
        live.write_text("written by the in-flight run")
        client.post("/repos/default/wiki-general/generate")

    assert live.exists()


def test_generate_bootstraps_a_missing_plain_wiki(bridge, monkeypatch):
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)
    shutil.rmtree(bridge.repo / ".codechroma" / "wiki")

    with TestClient(bridge.app) as client:
        client.post("/repos/default/wiki-general/generate")

    assert (bridge.repo / ".codechroma" / "wiki" / "index.md").exists()


def test_generate_reports_a_plain_wiki_sync_failure_as_a_normal_error(bridge, monkeypatch):
    def _boom(_self, _output_dir=None):
        raise RuntimeError("disk full")

    monkeypatch.setattr("codechroma.engine.GraphEngine.sync_wiki", _boom)

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/wiki-general/generate")
        status_response = client.get("/repos/default/wiki-general/status")

    assert response.json() == {"state": "error", "error": "plain wiki sync failed: disk full"}
    assert status_response.json()["state"] == "error"


def test_interactive_status_generating_clears_stale_pages(bridge):
    stale = bridge.repo / ".codechroma" / "wiki-general" / "c2" / "old-container.md"
    stale.parent.mkdir(parents=True, exist_ok=True)
    stale.write_text("stale page from a previous run")

    with TestClient(bridge.app) as client:
        client.post("/repos/default/wiki-general/status", json={"state": "generating"})

    assert not stale.exists()


def test_generate_is_refused_for_a_read_only_workspace(bridge):
    bridge.registry.register("pr-12", bridge.repo, read_only=True)

    with TestClient(bridge.app) as client:
        response = client.post("/repos/pr-12/wiki-general/generate")

    assert response.status_code == 409


def test_cancel_is_refused_for_a_read_only_workspace(bridge):
    bridge.registry.register("pr-12", bridge.repo, read_only=True)

    with TestClient(bridge.app) as client:
        response = client.post("/repos/pr-12/wiki-general/cancel")

    assert response.status_code == 409


def test_cancel_without_a_run_resets_to_idle(bridge):
    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/wiki-general/cancel")

    assert response.status_code == 200
    assert response.json() == {"state": "idle", "error": None}


def test_output_is_empty_before_any_run(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/wiki-general/output")

    assert response.json() == {"lines": []}


def test_interactive_status_marks_generating_then_idle(bridge):
    with TestClient(bridge.app) as client:
        started = client.post("/repos/default/wiki-general/status", json={"state": "generating"})
        mid_run = client.get("/repos/default/wiki-general/status")
        finished = client.post("/repos/default/wiki-general/status", json={"state": "idle"})

    assert started.json() == {"state": "generating", "error": None}
    assert mid_run.json()["state"] == "generating"
    assert finished.json() == {"state": "idle", "error": None}


def test_interactive_status_reports_a_detailed_error(bridge):
    with TestClient(bridge.app) as client:
        response = client.post(
            "/repos/default/wiki-general/status",
            json={"state": "error", "detail": "no wiki to ground in"},
        )

    assert response.json() == {"state": "error", "error": "no wiki to ground in"}


def test_interactive_status_rejects_an_unrecognized_state(bridge):
    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/wiki-general/status", json={"state": "bogus"})

    assert response.status_code == 400


def test_interactive_status_defaults_to_the_full_rebuild_kind_when_omitted(bridge):
    with TestClient(bridge.app) as client:
        client.post("/repos/default/wiki-general/status", json={"state": "generating"})
        blocked = client.post("/repos/default/wiki-general/update")

    assert blocked.status_code == 409


def test_interactive_status_reports_through_the_kind_it_names(bridge):
    with TestClient(bridge.app) as client:
        client.post(
            "/repos/default/wiki-general/status",
            json={"state": "generating", "kind": "wiki-general-update"},
        )
        status = client.get("/repos/default/wiki-general/status")
        blocked = client.post("/repos/default/wiki-general/generate")

    assert status.json()["state"] == "generating"
    assert blocked.status_code == 409


def test_interactive_status_rejects_an_unrecognized_kind(bridge):
    with TestClient(bridge.app) as client:
        response = client.post(
            "/repos/default/wiki-general/status",
            json={"state": "generating", "kind": "bogus-kind"},
        )

    assert response.status_code == 400


def test_cancel_kills_an_in_flight_run_and_reports_idle(bridge, monkeypatch):
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    killed = []
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", fake_claude_exec(hang=True, killed=killed)
    )

    with TestClient(bridge.app) as client:
        started = client.post("/repos/default/wiki-general/generate")
        assert started.json()["state"] == "generating"
        cancelled = client.post("/repos/default/wiki-general/cancel")

    assert cancelled.json() == {"state": "idle", "error": None}
    assert killed == [True]


def test_generate_broadcasts_status_over_events_socket(bridge, monkeypatch):
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)

    with TestClient(bridge.app) as client:
        with client.websocket_connect("/repos/default/events") as websocket:
            client.post("/repos/default/wiki-general/generate")
            message = websocket.receive_json()

    assert message == {
        "type": "wiki-general-status",
        "state": "error",
        "error": CLI_MISSING,
    }


def test_status_reports_empty_for_a_repo_with_no_real_code(make_bridge, make_repo):
    repo = make_repo(prepare=_strip_code_files)

    with TestClient(make_bridge(repo).app) as client:
        response = client.get("/repos/default/wiki-general/status")

    assert response.json()["empty"] is True


def test_generate_refuses_on_a_repo_with_no_real_code_without_launching_claude(
    make_bridge, make_repo, monkeypatch
):
    def _unexpected_exec(*_args, **_kwargs):
        raise AssertionError("claude should never be launched for a codeless repo")

    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", _unexpected_exec)
    repo = make_repo(prepare=_strip_code_files)

    with TestClient(make_bridge(repo).app) as client:
        response = client.post("/repos/default/wiki-general/generate")

    assert response.json() == {
        "state": "error",
        "error": "repository has no code yet -- nothing to document",
    }


def test_interactive_status_generating_refuses_on_a_repo_with_no_real_code(make_bridge, make_repo):
    repo = make_repo(prepare=_strip_code_files)

    with TestClient(make_bridge(repo).app) as client:
        response = client.post("/repos/default/wiki-general/status", json={"state": "generating"})

    assert response.json() == {
        "state": "error",
        "error": "repository has no code yet -- nothing to document",
    }


def test_interactive_update_kind_ignores_the_no_real_code_guard(make_bridge, make_repo):
    repo = make_repo(prepare=_strip_code_files)

    with TestClient(make_bridge(repo).app) as client:
        response = client.post(
            "/repos/default/wiki-general/status",
            json={"state": "generating", "kind": "wiki-general-update"},
        )

    assert response.json() == {"state": "generating", "error": None}


def test_clustering_route_returns_the_fixed_c2_join_grouping(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/wiki-general/clustering")

    assert response.status_code == 200
    body = response.json()
    files_by_component = {c["id"]: c["files"] for c in body["components"]}
    billing_component = next(
        files for files in files_by_component.values() if "billing/service.py" in files
    )
    assert "shared/text_utils.py" in billing_component
