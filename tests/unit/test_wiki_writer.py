"""Unit tests for wiki/writer.py's pure markdown-string builders -- no I/O, no graph traversal."""

from codechroma.wiki.models import GapEntry
from codechroma.wiki.writer import (
    render_file_page,
    render_folder_page,
    render_folder_subindex,
    render_gap_report,
    render_root_page,
)


def test_render_root_page_lists_top_level_folders():
    folders = [("src", "files/src/index.md"), ("tests", "files/tests/index.md")]
    text = render_root_page("myrepo", folders)

    assert "[src](files/src/index.md)" in text
    assert "[tests](files/tests/index.md)" in text


def test_render_root_page_has_repo_name_heading():
    text = render_root_page("myrepo", [])

    assert text.startswith("# myrepo")


def test_render_folder_page_lists_subfolders_and_files_with_hints():
    text = render_folder_page(
        "src",
        [("services", "services/")],
        [("config.py", "config.md", None), ("main.py", "main.md", "Entry point.")],
    )

    assert "[services](services/)" in text
    assert "[config.py](config.md)" in text
    assert "*no docstring*" in text
    assert "Entry point." in text


def test_render_folder_subindex_names_its_part_number():
    text = render_folder_subindex("tests", 1, 3, [("a.py", "a.md", None)])

    assert "part 1 of 3" in text
    assert "[a.py](a.md)" in text


def test_render_file_page_shows_module_docstring():
    text = render_file_page(
        "src/config.py",
        module_docstring="Config module.",
        variables=[],
        classes=[],
        functions=[],
        has_breakdown=True,
    )

    assert "Config module." in text


def test_render_file_page_marks_missing_module_docstring():
    text = render_file_page(
        "src/config.py",
        module_docstring=None,
        variables=[],
        classes=[],
        functions=[],
        has_breakdown=True,
    )

    assert "*no docstring*" in text


def test_render_file_page_lists_module_variables():
    text = render_file_page(
        "src/config.py",
        module_docstring=None,
        variables=[("BASE_DIR", 8), ("ENV_FILE", 9)],
        classes=[],
        functions=[],
        has_breakdown=True,
    )

    assert "`BASE_DIR`" in text
    assert "line 8" in text


def test_render_file_page_lists_classes_with_methods():
    text = render_file_page(
        "src/services/x.py",
        module_docstring=None,
        variables=[],
        classes=[("Service", "Handles things.", [("run", "Runs it.")])],
        functions=[],
        has_breakdown=True,
    )

    assert "### Service" in text
    assert "Handles things." in text
    assert "`run`" in text
    assert "Runs it." in text


def test_render_file_page_lists_standalone_functions():
    text = render_file_page(
        "src/util.py",
        module_docstring=None,
        variables=[],
        classes=[],
        functions=[("helper", "Helps.")],
        has_breakdown=True,
    )

    assert "`helper`" in text
    assert "Helps." in text


def test_render_file_page_renders_a_non_python_breakdown_like_a_python_one():
    text = render_file_page(
        "pkg/widget.go",
        module_docstring="Package widget renders things.",
        variables=[],
        classes=[("Widget", "Widget is a thing.", [])],
        functions=[("Helper", "Helper does the work.")],
        has_breakdown=True,
    )

    assert "Package widget renders things." in text
    assert "### Widget" in text
    assert "Widget is a thing." in text
    assert "`Helper`" in text
    assert "Helper does the work." in text


def test_render_file_page_renders_a_typescript_breakdown_like_a_python_one():
    text = render_file_page(
        "web/widget.tsx",
        module_docstring="File overview.",
        variables=[],
        classes=[],
        functions=[("helper", "Helps.")],
        has_breakdown=True,
    )

    assert "File overview." in text
    assert "`helper`" in text
    assert "Helps." in text


def test_render_file_page_without_breakdown_notes_the_reason():
    text = render_file_page(
        "web/widget.ts",
        module_docstring=None,
        variables=[],
        classes=[],
        functions=[],
        has_breakdown=False,
    )

    assert "no class/function breakdown" in text.lower()


def test_render_gap_report_groups_entries_by_file():
    gaps = [
        GapEntry(path="src/config.py", qualified_name="src.config", kind="module"),
        GapEntry(path="src/config.py", qualified_name="src.config.Configs", kind="class"),
    ]
    text = render_gap_report(gaps)

    assert "src/config.py" in text
    assert "module `src.config`" in text
    assert "class `src.config.Configs`" in text


def test_render_gap_report_is_empty_bodied_with_no_gaps():
    text = render_gap_report([])

    assert "src/config.py" not in text
