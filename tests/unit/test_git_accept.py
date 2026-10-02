"""Unit tests for the pure hunk-rewriting and node_id/path logic in bridge/git_accept.py."""

from pathlib import Path

from codechroma.bridge import git_accept

_TWO_FUNCTION_DIFF = (
    "diff --git a/file.py b/file.py\n"
    "index 1111111..2222222 100644\n"
    "--- a/file.py\n"
    "+++ b/file.py\n"
    "@@ -2,3 +2,3 @@ def foo():\n"
    " line1\n"
    "-old foo body\n"
    "+new foo body\n"
    " line3\n"
    "@@ -10,3 +10,3 @@ def bar():\n"
    " line10\n"
    "-old bar body\n"
    "+new bar body\n"
    " line13\n"
)


def test_split_diff_separates_header_from_each_hunk():
    header, hunks = git_accept._split_diff(_TWO_FUNCTION_DIFF)

    assert header == [
        "diff --git a/file.py b/file.py\n",
        "index 1111111..2222222 100644\n",
        "--- a/file.py\n",
        "+++ b/file.py\n",
    ]
    assert len(hunks) == 2
    assert (hunks[0].old_start, hunks[0].new_start) == (2, 2)
    assert (hunks[1].old_start, hunks[1].new_start) == (10, 10)


def test_build_patch_keeps_only_the_hunk_covering_the_target_range():
    header, hunks = git_accept._split_diff(_TWO_FUNCTION_DIFF)

    patch = git_accept._build_patch(header, hunks, (2, 4), (2, 4))

    assert "new foo body" in patch
    assert "new bar body" not in patch
    assert "old bar body" not in patch  # the second hunk is separate, so it's omitted entirely


def test_build_patch_returns_none_when_range_matches_nothing():
    header, hunks = git_accept._split_diff(_TWO_FUNCTION_DIFF)

    patch = git_accept._build_patch(header, hunks, (100, 104), (100, 104))

    assert patch is None


def test_rewrite_hunk_folds_a_change_outside_the_range_back_to_context():
    _, hunks = git_accept._split_diff(_TWO_FUNCTION_DIFF)
    merged_lines = ["@@ -2,12 +2,12 @@\n", *hunks[0].lines[1:], *hunks[1].lines[1:]]
    merged = git_accept._Hunk(2, 2, merged_lines)

    rewritten = git_accept._rewrite_hunk(merged, (2, 4), (2, 4))

    body = "".join(rewritten)
    assert "+new foo body" in body
    assert "+new bar body" not in body
    assert "-old bar body" not in body
    assert " old bar body" in body


_THREE_FUNCTION_MERGED_HUNK_DIFF = (
    "diff --git a/file.py b/file.py\n"
    "index 1111111..2222222 100644\n"
    "--- a/file.py\n"
    "+++ b/file.py\n"
    "@@ -1,10 +1,12 @@\n"
    " def foo():\n"
    "-    old1\n"
    "-    old2\n"
    "+    new1\n"
    "+    new2\n"
    "+    new3\n"
    " \n"
    " def bar():\n"
    "-    pass\n"
    "+    print(\"bar\")\n"
    "+    pass\n"
    " \n"
    " def baz():\n"
    "     x = 1\n"
)


def test_build_patch_keeps_a_targets_own_lines_after_several_unrelated_dropped_additions():
    header, hunks = git_accept._split_diff(_THREE_FUNCTION_MERGED_HUNK_DIFF)

    patch = git_accept._build_patch(header, hunks, (5, 6), (8, 11))

    assert '+    print("bar")' in patch
    assert "+    pass" in patch
    assert "-    pass" in patch
    assert "+    new1" not in patch
    assert "-    old1" not in patch
    assert "    old1" in patch  # foo's removal folds back to unchanged context


def test_file_path_from_node_id_handles_function_and_class_ids():
    assert (
        git_accept._file_path_from_node_id("billing/models/invoice.py::function::Invoice.total")
        == "billing/models/invoice.py"
    )
    assert (
        git_accept._file_path_from_node_id("billing/models/invoice.py::class::Invoice")
        == "billing/models/invoice.py"
    )


def test_file_path_from_node_id_handles_the_component_prefix():
    file_path = git_accept._file_path_from_node_id("component::billing/refunds.py")

    assert file_path == "billing/refunds.py"


def test_git_relative_returns_the_file_path_unchanged_when_repo_root_is_git_root():
    root = Path("/repo")

    assert git_accept._git_relative(root, root, "a/b.py") == "a/b.py"


def test_git_relative_prefixes_with_the_subdir_when_repo_root_is_nested():
    git_root = Path("/repo")
    repo_root = Path("/repo/examples/shadow-app")

    result = git_accept._git_relative(repo_root, git_root, "backend/app.py")

    assert result == "examples/shadow-app/backend/app.py"
