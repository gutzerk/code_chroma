"""TestClient coverage for POST /wiki-general/update -- patches only affected pages."""

import asyncio
import json
import threading

from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from codechroma.bridge import skill_agent, wiki_general_agent
from tests.unit.fake_claude import fake_claude_exec


def _seed_tree(repo, *, generated_at_commit=None):
    directory = repo / ".codechroma" / "wiki-general"
    (directory / "c2").mkdir(parents=True, exist_ok=True)
    (directory / "c3").mkdir(parents=True, exist_ok=True)
    (directory / "index.md").write_text("# Root\n")
    (directory / "c3" / "auth.md").write_text(
        "# Authentication\n\n## Elements\n\n- **Login** — x.\n  - File: `shared/text_utils.py`\n"
    )
    manifest = {
        "containers": [{"id": "backend", "name": "Backend", "path": "c2/backend.md"}],
        "components": [
            {"id": "auth", "name": "Authentication", "container": "backend", "path": "c3/auth.md"}
        ],
    }
    if generated_at_commit is not None:
        manifest["generated_at_commit"] = generated_at_commit
    (directory / "manifest.json").write_text(json.dumps(manifest))


def test_update_never_wipes_existing_pages(bridge, monkeypatch):
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: None)
    _seed_tree(bridge.repo)
    index = bridge.repo / ".codechroma" / "wiki-general" / "index.md"

    with TestClient(bridge.app) as client:
        client.post("/repos/default/wiki-general/update")

    assert index.exists()


def test_update_is_refused_while_generate_is_already_running(bridge, monkeypatch):
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: "/usr/bin/claude")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(hang=True))

    with TestClient(bridge.app) as client:
        client.post("/repos/default/wiki-general/generate")
        response = client.post("/repos/default/wiki-general/update")

    assert response.status_code == 409


def test_generate_is_refused_while_update_is_already_running(bridge, monkeypatch):
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: "/usr/bin/claude")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(hang=True))
    _seed_tree(bridge.repo)

    with TestClient(bridge.app) as client:
        client.post("/repos/default/wiki-general/update")
        response = client.post("/repos/default/wiki-general/generate")

    assert response.status_code == 409


def test_generate_and_update_cannot_both_start_from_overlapping_requests(bridge, monkeypatch):
    """Regression: the refuse-check and the state flip must be atomic, or both kinds can start."""
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: "/usr/bin/claude")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(hang=True))
    entered = threading.Event()
    release = threading.Event()

    def slow_prepare(_ws):
        # Holds generate mid-flight, before its own state flips to "generating" -- the race window.
        entered.set()
        release.wait(5.0)
        return None

    monkeypatch.setattr(wiki_general_agent, "_prepare_new_run", slow_prepare)

    async def _drive():
        transport = ASGITransport(app=bridge.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            generate = asyncio.create_task(client.post("/repos/default/wiki-general/generate"))
            await asyncio.to_thread(entered.wait, 5.0)
            update = await client.post("/repos/default/wiki-general/update")
            release.set()
            generated = await generate
        return generated.status_code, update.status_code

    statuses = sorted(asyncio.run(_drive()))

    assert statuses == [200, 409]


def _seed_clustering_manifest(repo, *, generated_at_commit=None):
    """Matches sample_repo's real clustering except `misc` wrongly owns users/service.py."""
    directory = repo / ".codechroma" / "wiki-general"
    (directory / "c2").mkdir(parents=True, exist_ok=True)
    (directory / "c3").mkdir(parents=True, exist_ok=True)
    (directory / "index.md").write_text(
        "# Root\n\n## Containers\n\n"
        "- [Backend](c2/backend.md) — backend.\n"
        "- [Frontend](c2/frontend.md) — frontend.\n"
    )
    (directory / "c2" / "backend.md").write_text(
        "# Backend\n\n## Components\n\n"
        "- [Billing](../c3/billing.md) — billing.\n"
        "- [Misc](../c3/misc.md) — misc.\n"
    )
    (directory / "c2" / "frontend.md").write_text(
        "# Frontend\n\n## Components\n\n- [Web](../c3/web.md) — web.\n"
    )
    (directory / "c3" / "billing.md").write_text("# Billing\n\n## Elements\n\n- **X** — x.\n")
    (directory / "c3" / "misc.md").write_text("# Misc\n\n## Elements\n\n- **X** — x.\n")
    (directory / "c3" / "web.md").write_text("# Web\n\n## Elements\n\n- **X** — x.\n")
    manifest = {
        "containers": [
            {
                "id": "backend",
                "name": "Backend",
                "path": "c2/backend.md",
                "files": [
                    "billing/reporter.go", "billing/service.py", "shared/text_utils.py",
                    "users/service.py",
                ],
            },
            {
                "id": "frontend",
                "name": "Frontend",
                "path": "c2/frontend.md",
                "files": ["web/UserCard.tsx", "web/widget.ts"],
            },
        ],
        "components": [
            {
                "id": "billing",
                "name": "Billing",
                "container": "backend",
                "path": "c3/billing.md",
                "files": ["billing/reporter.go", "billing/service.py", "shared/text_utils.py"],
            },
            {
                "id": "misc",
                "name": "Misc",
                "container": "backend",
                "path": "c3/misc.md",
                "files": ["users/service.py"],
            },
            {
                "id": "web",
                "name": "Web",
                "container": "frontend",
                "path": "c3/web.md",
                "files": ["web/UserCard.tsx", "web/widget.ts"],
            },
        ],
        "edges": [],
    }
    if generated_at_commit is not None:
        manifest["generated_at_commit"] = generated_at_commit
    (directory / "manifest.json").write_text(json.dumps(manifest))
    return directory


def test_update_computes_the_real_create_rewrite_delete_sequence(bridge, monkeypatch):
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: None)
    directory = _seed_clustering_manifest(bridge.repo)
    # A brand-new, self-contained pair of files with zero overlap with any existing id.
    notifications = bridge.repo / "notifications"
    notifications.mkdir()
    (notifications / "email.py").write_text("def send_email(): pass\n")
    (notifications / "sms.py").write_text("def send_sms(): pass\n")
    captured = {}
    real_render_prompt = __import__(
        "codechroma.bridge.routes.wiki_general", fromlist=["render_prompt"]
    ).render_prompt

    def _spy(name, **variables):
        captured.update(variables)
        return real_render_prompt(name, **variables)

    monkeypatch.setattr("codechroma.bridge.routes.wiki_general.render_prompt", _spy)

    with TestClient(bridge.app) as client:
        client.post("/repos/default/wiki-general/update")

    created = json.loads(captured["created_components_json"])
    rewritten = json.loads(captured["rewritten_components_json"])

    # billing gains users/service.py (real clustering puts it there, not with misc) -> rewritten.
    billing_entry = next(e for e in rewritten if e["id"] == "billing")
    assert "users/service.py" in billing_entry["files"]
    # web is byte-for-byte the same real grouping as before -> never listed at all.
    assert all(e["id"] != "web" for e in rewritten + created)
    # New, deterministically-named; no shared top-level dir means it's its own new solo container.
    assert created == [
        {"id": "notifications", "name": "Notifications", "container": "notifications", "files": [
            "notifications/email.py", "notifications/sms.py",
        ]}
    ]

    stamped = json.loads((directory / "manifest.json").read_text())
    stamped_ids = {c["id"] for c in stamped["components"]}
    # misc's only file moved away -> deleted: manifest entry, page, and parent link all removed.
    assert "misc" not in stamped_ids
    assert not (directory / "c3" / "misc.md").exists()
    assert "misc.md" not in (directory / "c2" / "backend.md").read_text()


def test_update_recomputes_edges_and_stamps_generated_at_commit_together(bridge, monkeypatch):
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: "/usr/bin/claude")
    directory = _seed_clustering_manifest(bridge.repo, generated_at_commit="stale-sha")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(returncode=0))

    with TestClient(bridge.app) as client:
        with client.websocket_connect("/repos/default/events") as websocket:
            client.post("/repos/default/wiki-general/update")
            _receive_final_status(websocket)

    stamped = json.loads((directory / "manifest.json").read_text())
    assert stamped["generated_at_commit"] != "stale-sha"
    assert stamped["edges"] == []  # billing and web have no cross-component call/import traffic


def _receive_final_status(websocket, attempts: int = 20) -> dict:
    """Skips the immediate "generating" ping and returns the run's terminal idle/error one."""
    for _ in range(attempts):
        message = websocket.receive_json()
        if message.get("type") == "wiki-general-status" and message.get("state") != "generating":
            return message
    raise AssertionError(f"no terminal wiki-general-status within {attempts} frames")


def test_update_stamps_generated_at_commit_once_it_succeeds(bridge, monkeypatch):
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: "/usr/bin/claude")
    _seed_tree(bridge.repo, generated_at_commit="stale-sha")
    (bridge.repo / "shared" / "text_utils.py").write_text("def slugify(text): return text\n")
    manifest_path = bridge.repo / ".codechroma" / "wiki-general" / "manifest.json"
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_claude_exec(returncode=0))

    with TestClient(bridge.app) as client:
        with client.websocket_connect("/repos/default/events") as websocket:
            client.post("/repos/default/wiki-general/update")
            _receive_final_status(websocket)

    stamped = json.loads(manifest_path.read_text())
    assert stamped["generated_at_commit"] != "stale-sha"
