"""Coverage for bridge/resources.py, the one module that knows about PyInstaller freezing."""

import pytest

from codechroma.bridge import resources


def test_source_tree_skills_path_points_at_the_repos_own_claude_dir():
    path = resources.resource_path("skills")

    assert path == resources.SOURCE_ROOT / ".claude" / "skills"


def test_source_tree_web_path_points_at_the_vite_build_output():
    path = resources.resource_path("web")

    assert path == resources.SOURCE_ROOT / "web" / "dist"


def test_sub_parts_are_appended_to_the_resolved_dir():
    path = resources.resource_path("skills", "codechroma-c1", "SKILL.md")

    assert path.parts[-3:] == ("skills", "codechroma-c1", "SKILL.md")


def test_frozen_bundle_resolves_under_meipass_instead_of_the_repo(tmp_path, monkeypatch):
    monkeypatch.setattr(resources.sys, "frozen", True, raising=False)
    monkeypatch.setattr(resources.sys, "_MEIPASS", str(tmp_path), raising=False)

    assert resources.resource_path("web") == tmp_path / "codechroma_data" / "web"


def test_is_frozen_is_false_in_a_plain_source_checkout():
    assert resources.is_frozen() is False


def test_unknown_resource_kind_raises_rather_than_returning_a_bogus_path():
    with pytest.raises(KeyError):
        resources.resource_path("nope")
