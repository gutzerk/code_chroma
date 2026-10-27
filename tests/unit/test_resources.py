"""Coverage for bridge/resources.py, the repo-relative data dir resolver."""

import pytest

from codechroma.bridge import resources


@pytest.mark.parametrize(
    ("kind", "expected"), [("skills", ("skills",)), ("web", ("web", "dist"))]
)
def test_source_tree_paths_point_at_the_repos_own_dirs(kind, expected):
    path = resources.resource_path(kind)

    assert path == resources.SOURCE_ROOT.joinpath(*expected)


def test_sub_parts_are_appended_to_the_resolved_dir():
    path = resources.resource_path("skills", "codechroma-c1", "SKILL.md")

    assert path.parts[-3:] == ("skills", "codechroma-c1", "SKILL.md")


def test_unknown_resource_kind_raises_rather_than_returning_a_bogus_path():
    with pytest.raises(KeyError):
        resources.resource_path("nope")
