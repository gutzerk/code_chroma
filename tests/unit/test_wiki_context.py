"""Unit coverage for build_wiki_context()'s pure assembly logic -- no engine, no HTTP."""

import json
import os
from pathlib import Path

from codechroma.bridge.wiki_context import build_wiki_context
from codechroma.config import Settings, WikiContextConfig


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def _wiki(tmp_path: Path) -> Path:
    wiki_dir = tmp_path / "wiki"
    _write(wiki_dir / "index.md", "# root\n")
    _write(wiki_dir / "files" / "billing" / "index.md", "# billing\n")
    _write(wiki_dir / "files" / "billing" / "service.md", "# billing/service.py\n")
    _write(wiki_dir / "files" / "billing" / "models" / "index.md", "# billing/models\n")
    _write(
        wiki_dir / "files" / "billing" / "models" / "invoice.md", "# billing/models/invoice.py\n"
    )
    return wiki_dir


def test_no_wiki_directory_reports_has_wiki_false(tmp_path):
    bundle = build_wiki_context(tmp_path / "missing", ["billing"])

    assert bundle.has_wiki is False
    assert bundle.root is None
    assert bundle.pages == []


def test_assembles_root_plus_folder_and_file_pages_in_root_to_leaf_order(tmp_path):
    wiki_dir = _wiki(tmp_path)

    bundle = build_wiki_context(wiki_dir, ["billing/service.py"])

    assert bundle.has_wiki is True
    assert bundle.root == "# root\n"
    assert [p.path for p in bundle.pages] == ["billing", "billing/service.py"]
    assert [p.kind for p in bundle.pages] == ["folder", "file"]


def test_a_requested_folders_own_page_is_included_as_folder_kind(tmp_path):
    wiki_dir = _wiki(tmp_path)

    bundle = build_wiki_context(wiki_dir, ["billing/models"])

    assert [p.path for p in bundle.pages] == ["billing", "billing/models"]
    assert [p.kind for p in bundle.pages] == ["folder", "folder"]


def test_shared_ancestor_folder_is_deduped_across_two_requested_paths(tmp_path):
    wiki_dir = _wiki(tmp_path)

    bundle = build_wiki_context(wiki_dir, ["billing/service.py", "billing/models/invoice.py"])

    assert [p.path for p in bundle.pages] == [
        "billing",
        "billing/service.py",
        "billing/models",
        "billing/models/invoice.py",
    ]


def test_a_path_with_a_gaps_json_entry_still_serves_its_real_page(tmp_path):
    """A gaps.json entry flags an undocumented symbol; it must never hide the file's real page."""
    wiki_dir = _wiki(tmp_path)
    gaps_path = wiki_dir / "gaps.json"
    gaps_path.write_text(
        json.dumps(
            [{"path": "billing/service.py", "qualified_name": "billing.service", "kind": "module",
              "reason": "no docstring"}]
        )
    )

    bundle = build_wiki_context(wiki_dir, ["billing/service.py"])

    assert bundle.gaps == []
    assert [p.path for p in bundle.pages] == ["billing", "billing/service.py"]


def test_a_path_with_no_page_at_all_is_reported_as_a_gap(tmp_path):
    wiki_dir = _wiki(tmp_path)

    bundle = build_wiki_context(wiki_dir, ["billing/nonexistent.py"])

    assert bundle.gaps == ["billing/nonexistent.py"]
    assert bundle.pages == []


def test_budget_cap_truncates_and_reports_truncated(tmp_path, monkeypatch):
    wiki_dir = _wiki(tmp_path)
    monkeypatch.setattr(
        "codechroma.bridge.wiki_context.settings",
        Settings(wiki_context=WikiContextConfig(max_chars=len("# root\n") + len("# billing\n"))),
    )

    bundle = build_wiki_context(wiki_dir, ["billing/service.py"])

    assert bundle.truncated is True
    assert [p.path for p in bundle.pages] == ["billing"]


def test_budget_not_hit_reports_truncated_false(tmp_path):
    wiki_dir = _wiki(tmp_path)

    bundle = build_wiki_context(wiki_dir, ["billing/service.py"])

    assert bundle.truncated is False


def test_a_dot_dot_escape_outside_wiki_dir_is_a_gap_not_read(tmp_path):
    wiki_dir = _wiki(tmp_path)
    secret_dir = tmp_path / "outside"
    secret_dir.mkdir()
    (secret_dir / "index.md").write_text("TOP SECRET\n")
    escape = os.path.relpath(secret_dir, start=wiki_dir / "files")

    bundle = build_wiki_context(wiki_dir, [escape])

    assert bundle.gaps == [escape]
    assert bundle.pages == []


def test_an_absolute_path_is_a_gap_not_read(tmp_path):
    wiki_dir = _wiki(tmp_path)
    secret_dir = tmp_path / "outside"
    secret_dir.mkdir()
    (secret_dir / "index.md").write_text("TOP SECRET\n")

    bundle = build_wiki_context(wiki_dir, [str(secret_dir)])

    assert bundle.gaps == [str(secret_dir)]
    assert bundle.pages == []


def test_a_non_utf8_page_is_a_gap_not_a_crash(tmp_path):
    wiki_dir = _wiki(tmp_path)
    (wiki_dir / "files" / "binary.md").write_bytes(b"\xff\xfe\x00bad utf8")

    bundle = build_wiki_context(wiki_dir, ["binary"])

    assert bundle.gaps == ["binary"]
    assert bundle.pages == []


def test_a_dot_path_for_the_repo_root_is_a_gap_not_a_crash(tmp_path):
    wiki_dir = _wiki(tmp_path)

    bundle = build_wiki_context(wiki_dir, ["."])

    assert bundle.has_wiki is True
    assert bundle.gaps == ["."]
    assert bundle.pages == []


def test_an_empty_path_is_a_gap_not_a_crash(tmp_path):
    wiki_dir = _wiki(tmp_path)

    bundle = build_wiki_context(wiki_dir, [""])

    assert bundle.gaps == [""]
    assert bundle.pages == []
