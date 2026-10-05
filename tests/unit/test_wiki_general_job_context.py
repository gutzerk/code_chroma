"""Unit coverage for trim_to_first_sentence() and build_job_context()'s pure assembly logic."""

from pathlib import Path

from codechroma.bridge.wiki_general_job_context import build_job_context, trim_to_first_sentence
from codechroma.config import Settings, WikiContextConfig


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_a_single_sentence_bullet_doc_is_left_unchanged():
    page = "# pkg/file.go\n\n*no docstring*\n\n## Functions\n\n- `Run` — Run starts the loop.\n"

    trimmed = trim_to_first_sentence(page)

    assert "- `Run` — Run starts the loop." in trimmed


def test_a_multi_sentence_bullet_doc_is_cut_to_its_first_sentence():
    page = (
        "# pkg/file.go\n\n*no docstring*\n\n## Functions\n\n"
        "- `Run` — Run starts the loop. It blocks until ctx is cancelled.\n"
    )

    trimmed = trim_to_first_sentence(page)

    assert "- `Run` — Run starts the loop." in trimmed
    assert "It blocks until ctx is cancelled" not in trimmed


def test_a_multi_paragraph_bullet_doc_is_trimmed_without_orphaning_the_next_bullet():
    page = (
        "# pkg/file.go\n\n*no docstring*\n\n## Functions\n\n"
        "- `Start` — Start launches the container.\n\n"
        "It is idempotent for the already-running case: a second call is a no-op.\n\n"
        "FR-006: a posture change requires Stop then Start.\n\n"
        "- `Stop` — Stop tears the container down.\n"
    )

    trimmed = trim_to_first_sentence(page)

    assert "- `Start` — Start launches the container." in trimmed
    assert "idempotent" not in trimmed
    assert "- `Stop` — Stop tears the container down." in trimmed


def test_module_docstring_after_the_file_heading_is_trimmed():
    page = (
        "# pkg/file.go\n\n"
        "Package file does one thing well. It also handles a rare edge case.\n\n"
        "## Functions\n\n- `Run` — Run starts the loop.\n"
    )

    trimmed = trim_to_first_sentence(page)

    assert "Package file does one thing well." in trimmed
    assert "rare edge case" not in trimmed


def test_class_docstring_after_a_class_heading_is_trimmed():
    page = (
        "# pkg/file.go\n\n*no docstring*\n\n## Classes\n\n"
        "### Engine\n\n"
        "Engine adapts a runtime to the seam. It also caches the last error.\n\n"
        "#### Methods\n\n- `Start` — Start launches the engine.\n"
    )

    trimmed = trim_to_first_sentence(page)

    assert "Engine adapts a runtime to the seam." in trimmed
    assert "caches the last error" not in trimmed


def test_no_docstring_placeholder_is_left_untouched():
    page = "# pkg/file.go\n\n*no docstring*\n\n## Functions\n\n- `Run` — *no docstring*\n"

    trimmed = trim_to_first_sentence(page)

    assert "*no docstring*" in trimmed


def test_no_breakdown_marker_is_never_swallowed_into_the_module_docstring():
    page = (
        "# pkg/config.yml\n\nA config file with an unremarkable module summary.\n\n"
        "*no class/function breakdown for this language*\n"
    )

    trimmed = trim_to_first_sentence(page)

    assert "*no class/function breakdown for this language*" in trimmed


def test_an_abbreviation_does_not_trigger_a_premature_sentence_cut():
    page = (
        "# pkg/file.go\n\n*no docstring*\n\n## Functions\n\n"
        "- `Run` — Run accepts flags (e.g. --verbose) and starts the loop.\n"
    )

    trimmed = trim_to_first_sentence(page)

    assert "starts the loop." in trimmed


def test_module_parameter_bullets_without_an_em_dash_are_left_untouched():
    page = (
        "# pkg/file.go\n\n*no docstring*\n\n## Module Parameters\n\n"
        "- `MaxRetries` (line 12)\n"
    )

    trimmed = trim_to_first_sentence(page)

    assert "- `MaxRetries` (line 12)" in trimmed


def test_no_wiki_directory_reports_has_wiki_false(tmp_path):
    bundle = build_job_context(tmp_path / "missing", ["pkg/file.go"])

    assert bundle.has_wiki is False
    assert bundle.root is None
    assert bundle.pages == []


def test_each_requested_file_gets_its_own_page_with_no_navigation_pages(tmp_path):
    wiki_dir = tmp_path / "wiki"
    _write(wiki_dir / "index.md", "# root\n")
    _write(wiki_dir / "files" / "pkg" / "index.md", "# pkg\n")
    _write(
        wiki_dir / "files" / "pkg" / "file.md",
        "# pkg/file.go\n\n*no docstring*\n\n## Functions\n\n"
        "- `Run` — Run starts the loop. It never returns.\n",
    )

    bundle = build_job_context(wiki_dir, ["pkg/file.go"])

    assert bundle.has_wiki is True
    assert bundle.root is None
    assert [p.kind for p in bundle.pages] == ["file"]
    assert [p.path for p in bundle.pages] == ["pkg/file.go"]
    assert "It never returns" not in bundle.pages[0].content


def test_a_path_with_no_page_at_all_is_reported_as_a_gap(tmp_path):
    wiki_dir = tmp_path / "wiki"
    _write(wiki_dir / "index.md", "# root\n")

    bundle = build_job_context(wiki_dir, ["pkg/missing.go"])

    assert bundle.gaps == ["pkg/missing.go"]
    assert bundle.pages == []


def test_budget_cap_truncates_and_reports_truncated(tmp_path, monkeypatch):
    wiki_dir = tmp_path / "wiki"
    _write(wiki_dir / "index.md", "# root\n")
    _write(wiki_dir / "files" / "a.md", "# a\n\n" + "x" * 50 + "\n")
    _write(wiki_dir / "files" / "b.md", "# b\n\n" + "y" * 50 + "\n")
    monkeypatch.setattr(
        "codechroma.bridge.wiki_general_job_context.settings",
        Settings(wiki_context=WikiContextConfig(max_chars=20)),
    )

    bundle = build_job_context(wiki_dir, ["a", "b"])

    assert bundle.truncated is True
    assert len(bundle.pages) < 2
