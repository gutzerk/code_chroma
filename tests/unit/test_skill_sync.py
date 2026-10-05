"""Unit coverage for sync_skill: installing the codechroma skills into a launched repo."""

import pytest

from codechroma.bridge.skill_sync import (
    RETIRED_SKILL_NAMES,
    SKILL_EXCLUDE_PATTERNS,
    SKILL_NAMES,
    skill_source,
    sync_all_skills,
    sync_skill,
)
from codechroma.skills import is_synced_skill_path


@pytest.fixture
def source_dir(tmp_path):
    source = tmp_path / "source-skill"
    source.mkdir()
    (source / "SKILL.md").write_text("updated skill body with details field", encoding="utf-8")
    return source


def test_installs_a_skill_into_a_repo_without_one(tmp_path, source_dir):
    repo = tmp_path / "repo"
    repo.mkdir()

    target = sync_skill(repo, "codechroma-epic-brief", source=source_dir)

    assert target == repo / ".claude" / "skills" / "codechroma-epic-brief"
    assert (target / "SKILL.md").read_text(
        encoding="utf-8"
    ) == "updated skill body with details field"


def test_replaces_an_existing_stale_copy(tmp_path, source_dir):
    repo = tmp_path / "repo"
    stale = repo / ".claude" / "skills" / "codechroma-epic-brief"
    stale.mkdir(parents=True)
    (stale / "SKILL.md").write_text("old skill without details", encoding="utf-8")
    (stale / "leftover.md").write_text("stale extra file", encoding="utf-8")

    target = sync_skill(repo, "codechroma-epic-brief", source=source_dir)

    assert (target / "SKILL.md").read_text(
        encoding="utf-8"
    ) == "updated skill body with details field"
    assert not (target / "leftover.md").exists()


def test_skips_when_the_source_is_missing(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    target = sync_skill(repo, "codechroma-epic-brief", source=tmp_path / "does-not-exist")

    assert target is None
    assert not (repo / ".claude").exists()


@pytest.mark.parametrize("name", ["codechroma-epic-brief", "codechroma-draw-diagram"])
def test_skips_when_the_target_repo_is_this_project(name):
    project_root = skill_source(name).parents[2]

    target = sync_skill(project_root, name)

    assert target is None


def test_the_draw_diagram_router_names_every_type_it_routes_to():
    body = (skill_source("codechroma-draw-diagram") / "SKILL.md").read_text(encoding="utf-8")

    assert all(kind in body for kind in ("c1", "patterns", "impact", "custom"))


@pytest.mark.parametrize(
    ("reference", "marker"),
    [
        ("type-c1.md", "relations"),
        ("type-patterns.md", "instances"),
        ("type-impact.md", "status"),
        ("type-custom.md", "instructions"),
        ("type-sequence.md", "order"),
        ("drawing-rules.md", "max_nodes"),
        ("feature-plan-mode.md", "plan_kind"),
    ],
)
def test_every_reference_the_router_points_at_ships_with_the_skill(reference, marker):
    body = (skill_source("codechroma-draw-diagram") / "references" / reference).read_text(
        encoding="utf-8"
    )

    assert marker in body


def test_exclude_patterns_cover_every_skill_including_the_retired_ones():
    # A retired leftover must not read as untracked work in the window before it gets pruned.
    expected = tuple(
        f".claude/skills/{name}/" for name in (*SKILL_NAMES, *RETIRED_SKILL_NAMES)
    )

    assert SKILL_EXCLUDE_PATTERNS == expected


def test_the_merged_away_names_are_retired_rather_than_simply_forgotten():
    assert "codechroma-draw-diagram" in SKILL_NAMES
    assert "codechroma-diagram-type" in RETIRED_SKILL_NAMES
    assert set(RETIRED_SKILL_NAMES).isdisjoint(SKILL_NAMES)


@pytest.mark.parametrize("retired_name", ["codechroma-c1", "codechroma-diagram-type"])
def test_syncing_removes_a_skill_a_previous_version_installed(tmp_path, retired_name):
    # 🔴 sync_skill only rmtree's a name still in SKILL_NAMES; without the prune these stay forever.
    repo = tmp_path / "repo"
    stale = repo / ".claude" / "skills" / retired_name
    stale.mkdir(parents=True)
    (stale / "SKILL.md").write_text("an old, merged/retired-away skill", encoding="utf-8")

    sync_all_skills(repo)

    assert not stale.exists()


def test_launcher_installs_the_skills_before_booting(tmp_path, source_dir, monkeypatch):
    from codechroma.bridge import launch

    repo = tmp_path / "repo"
    repo.mkdir()
    monkeypatch.setattr(
        launch, "sync_skill", lambda repo_root, name: sync_skill(repo_root, name, source_dir)
    )
    monkeypatch.setattr(launch, "_start_bridge", lambda *a: _exited_process())
    monkeypatch.setattr(launch, "_wait_for_port", lambda *a: False)

    launch.main(["--repo-path", str(repo)])

    assert (repo / ".claude" / "skills" / "codechroma-epic-brief" / "SKILL.md").exists()


def _exited_process():
    class _Done:
        returncode = 0

        def poll(self):
            return 0

    return _Done()


def test_sync_all_skills_installs_every_codechroma_skill(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    sync_all_skills(repo)

    installed = {p.name for p in (repo / ".claude" / "skills").iterdir()}
    assert installed == set(SKILL_NAMES)


@pytest.mark.parametrize(
    ("relative", "expected"),
    [
        (".claude/skills/codechroma-patterns/SKILL.md", True),
        (".claude/skills/codechroma-c1/scripts/check.py", True),
        (".claude/skills/my-own-skill/SKILL.md", False),
        (".claude/skills", False),
        ("src/codechroma-patterns/app.py", False),
    ],
)
def test_is_synced_skill_path_matches_only_our_own_installed_skills(relative, expected):
    assert is_synced_skill_path(relative) is expected
