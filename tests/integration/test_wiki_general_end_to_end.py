"""Integration: a real bridge + real sample_repo analyze, a faked worker subprocess (058)."""

import asyncio
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.llm.runtime_env import RuntimeCli
from tests.unit.fake_worker_claude import fake_worker_exec


@pytest.fixture(autouse=True)
def _fake_cli(monkeypatch, use_test_runtime):
    runtime = use_test_runtime()

    def resolve(binary, env):
        return RuntimeCli(os.path.abspath(binary), runtime.spawn_env(env), "test")

    monkeypatch.setattr("codechroma.bridge.skill_agent.resolve_runtime_cli", resolve)
    monkeypatch.setattr("codechroma.bridge.wiki_general_worker.resolve_runtime_cli", resolve)


def _write_wiki_general_tree(repo_root: Path) -> None:
    """A valid wiki-general tree on disk -- shared by two other tests that only read a manifest."""
    wiki_general = repo_root / ".codechroma" / "wiki-general"
    (wiki_general / "c2").mkdir(parents=True, exist_ok=True)
    (wiki_general / "c3").mkdir(parents=True, exist_ok=True)
    (wiki_general / "index.md").write_text(
        "# Sample — Architecture Map\n\n## Containers\n\n"
        "- [Backend](c2/backend.md) — the backend.\n"
, encoding="utf-8")
    (wiki_general / "c2" / "backend.md").write_text(
        "# Backend\n\n## Components\n\n- [Billing](../c3/billing.md) — billing logic.\n"
, encoding="utf-8")
    (wiki_general / "c3" / "billing.md").write_text(
        "# Billing\n\n## Elements\n\n"
        "- **Reporter** — builds billing reports.\n"
        "  - File: `billing/reporter.go`\n"
        "- **Identity Data** — conceptual, no code reference.\n"
, encoding="utf-8")
    manifest = {
        "generated_at": "2026-09-14T00:00:00Z",
        "containers": [{"id": "backend", "name": "Backend", "path": "c2/backend.md"}],
        "components": [
            {"id": "billing", "name": "Billing", "container": "backend", "path": "c3/billing.md"}
        ],
    }
    (wiki_general / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def _respond(prompt: str, required: list[str]) -> dict:
    if "elements" in required:
        return {"summary": "A component.", "description": "Does something useful.", "elements": []}
    if "narrative" in required:
        return {"narrative": "A small sample system."}
    return {"summary": "A container.", "description": "Groups related components."}


def _fail_all(_prompt, _required):
    return True


def _receive_final_status(websocket, attempts: int = 20) -> dict:
    """Skips the immediate "generating" ping and returns the run's terminal idle/error one."""
    for _ in range(attempts):
        message = websocket.receive_json()
        if message.get("type") == "wiki-general-status" and message.get("state") != "generating":
            return message
    raise AssertionError(f"no terminal wiki-general-status within {attempts} frames")


def test_a_real_run_writes_the_tree_and_the_bridge_reports_it_ready(bridge, monkeypatch):
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_worker_exec(_respond))

    with TestClient(bridge.app) as client:
        with client.websocket_connect("/repos/default/events") as websocket:
            started = client.post("/repos/default/wiki-general/generate")
            done = _receive_final_status(websocket)
        status = client.get("/repos/default/wiki-general/status")

    assert started.json()["state"] == "generating"
    assert done == {"type": "wiki-general-status", "state": "idle", "error": None}
    assert status.json() == {
        "state": "idle",
        "error": None,
        "has_wiki_general": True,
        "stale": False,
        "empty": False,
    }
    wiki_general = bridge.repo / ".codechroma" / "wiki-general"
    assert (wiki_general / "index.md").is_file()
    manifest = json.loads((wiki_general / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["containers"] and manifest["components"]
    first_container = manifest["containers"][0]["id"]
    first_component = manifest["components"][0]["id"]
    assert (wiki_general / "c2" / f"{first_container}.md").is_file()
    assert (wiki_general / "c3" / f"{first_component}.md").is_file()


def test_a_run_whose_worker_jobs_keep_failing_reports_that_error(bridge, monkeypatch):
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", fake_worker_exec(_respond, fail_when=_fail_all)
    )

    with TestClient(bridge.app) as client:
        with client.websocket_connect("/repos/default/events") as websocket:
            client.post("/repos/default/wiki-general/generate")
            done = _receive_final_status(websocket)
        status = client.get("/repos/default/wiki-general/status")

    assert done["state"] == "error"
    assert "failed: boom" in done["error"]
    assert status.json()["has_wiki_general"] is False


def test_regenerating_replaces_a_previous_manifest_that_had_gone_invalid(bridge, monkeypatch):
    manifest_path = bridge.repo / ".codechroma" / "wiki-general" / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps({"containers": [], "components": []}), encoding="utf-8")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_worker_exec(_respond))

    with TestClient(bridge.app) as client:
        before = client.get("/repos/default/wiki-general/status")
        with client.websocket_connect("/repos/default/events") as websocket:
            client.post("/repos/default/wiki-general/generate")
            _receive_final_status(websocket)
        after = client.get("/repos/default/wiki-general/status")

    assert before.json()["has_wiki_general"] is False
    assert after.json()["has_wiki_general"] is True
