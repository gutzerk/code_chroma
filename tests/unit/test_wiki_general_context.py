"""Unit coverage for build_wiki_general_context()'s pure assembly logic -- no engine, no HTTP."""

import json
from pathlib import Path

from codechroma.bridge.wiki_general_context import build_wiki_general_context
from codechroma.config import Settings, WikiGeneralContextConfig


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _manifest(containers: list[dict]) -> str:
    return json.dumps(
        {
            "generated_at": "2026-09-14T00:00:00Z",
            "containers": containers,
            # _valid_manifest only requires a non-empty list of dicts with a string id.
            "components": [{"id": "billing"}],
        }
    )


def _tree(tmp_path: Path) -> Path:
    wiki_general = tmp_path / "wiki-general"
    _write(wiki_general / "index.md", "# root\n")
    _write(wiki_general / "c2" / "backend.md", "# backend\n")
    _write(wiki_general / "c2" / "frontend.md", "# frontend\n")
    _write(
        wiki_general / "manifest.json",
        _manifest(
            [
                {"id": "backend", "name": "Backend", "path": "c2/backend.md"},
                {"id": "frontend", "name": "Frontend", "path": "c2/frontend.md"},
            ]
        ),
    )
    return wiki_general


def test_no_manifest_reports_has_wiki_general_false(tmp_path):
    bundle = build_wiki_general_context(tmp_path / "missing")

    assert bundle.has_wiki_general is False
    assert bundle.root is None
    assert bundle.containers == []


def test_an_invalid_manifest_reports_has_wiki_general_false(tmp_path):
    wiki_general = tmp_path / "wiki-general"
    _write(wiki_general / "index.md", "# root\n")
    _write(wiki_general / "manifest.json", json.dumps({"containers": [], "components": []}))

    bundle = build_wiki_general_context(wiki_general)

    assert bundle.has_wiki_general is False


def test_valid_manifest_assembles_root_and_every_container_page(tmp_path):
    wiki_general = _tree(tmp_path)

    bundle = build_wiki_general_context(wiki_general)

    assert bundle.has_wiki_general is True
    assert bundle.generated_at == "2026-09-14T00:00:00Z"
    assert bundle.root == "# root\n"
    assert [c.id for c in bundle.containers] == ["backend", "frontend"]
    assert [c.name for c in bundle.containers] == ["Backend", "Frontend"]
    assert [c.content for c in bundle.containers] == ["# backend\n", "# frontend\n"]
    assert bundle.truncated is False


def test_a_container_page_missing_on_disk_is_skipped_not_a_crash(tmp_path):
    wiki_general = tmp_path / "wiki-general"
    _write(wiki_general / "index.md", "# root\n")
    _write(wiki_general / "c2" / "backend.md", "# backend\n")
    _write(
        wiki_general / "manifest.json",
        _manifest(
            [
                {"id": "backend", "name": "Backend", "path": "c2/backend.md"},
                {"id": "ghost", "name": "Ghost", "path": "c2/ghost.md"},
            ]
        ),
    )

    bundle = build_wiki_general_context(wiki_general)

    assert [c.id for c in bundle.containers] == ["backend"]


def test_budget_cap_truncates_and_reports_truncated(tmp_path, monkeypatch):
    wiki_general = _tree(tmp_path)
    monkeypatch.setattr(
        "codechroma.bridge.wiki_general_context.settings",
        Settings(
            wiki_general_context=WikiGeneralContextConfig(
                max_chars=len("# root\n") + len("# backend\n")
            )
        ),
    )

    bundle = build_wiki_general_context(wiki_general)

    assert bundle.truncated is True
    assert [c.id for c in bundle.containers] == ["backend"]


def test_budget_not_hit_reports_truncated_false(tmp_path):
    wiki_general = _tree(tmp_path)

    bundle = build_wiki_general_context(wiki_general)

    assert bundle.truncated is False


def test_a_non_utf8_container_page_is_skipped_not_a_crash(tmp_path):
    wiki_general = tmp_path / "wiki-general"
    _write(wiki_general / "index.md", "# root\n")
    (wiki_general / "c2").mkdir(parents=True, exist_ok=True)
    (wiki_general / "c2" / "backend.md").write_bytes(b"\xff\xfe\x00bad utf8")
    _write(
        wiki_general / "manifest.json",
        _manifest([{"id": "backend", "name": "Backend", "path": "c2/backend.md"}]),
    )

    bundle = build_wiki_general_context(wiki_general)

    assert bundle.containers == []
