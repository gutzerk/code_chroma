"""resolve_brief: real task text/parallel always overwritten from tasks.md, matched by id."""

from __future__ import annotations

import shutil
from pathlib import Path

from codechroma.bridge import epic_brief_resolver, epics_resolver

FIXTURE_ROOT = Path(__file__).parent.parent / "fixtures" / "requirements_repo"
EPIC_ID = "EP-A-01"
STAGE = "001-first-story-feature"


def _with_requirements_fixture(repo: Path) -> None:
    shutil.copytree(FIXTURE_ROOT / "plan", repo / "plan")
    shutil.copytree(FIXTURE_ROOT / "specs", repo / "specs")


def _epic(make_repo, item_id=EPIC_ID):
    repo = make_repo(prepare=_with_requirements_fixture)
    return repo, epics_resolver.epics_item(repo, item_id)


def test_a_spec_task_with_no_text_gets_the_real_text_spliced_in(make_repo):
    repo, epic = _epic(make_repo)
    raw = {
        "scope": [
            {
                "tasks_source": "spec",
                "tasks": [{"id": "T003", "stage": STAGE, "repo": "backend"}],
            }
        ]
    }

    resolved = epic_brief_resolver.resolve_brief(raw, repo, epic)

    task = resolved["scope"][0]["tasks"][0]
    assert task["text"] == "T003 Implement `resolve_config()` with process-wide caching"


def test_a_spec_task_ignores_whatever_text_the_model_wrote(make_repo):
    repo, epic = _epic(make_repo)
    raw = {
        "scope": [
            {
                "tasks_source": "spec",
                "tasks": [
                    {"id": "T003", "stage": STAGE, "text": "mangled retype (", "repo": "backend"}
                ],
            }
        ]
    }

    resolved = epic_brief_resolver.resolve_brief(raw, repo, epic)

    task = resolved["scope"][0]["tasks"][0]
    assert task["text"] == "T003 Implement `resolve_config()` with process-wide caching"


def test_parallel_flag_comes_from_the_real_marker_not_the_model(make_repo):
    repo, epic = _epic(make_repo)
    raw = {"scope": [{"tasks_source": "spec", "tasks": [{"id": "T002", "stage": STAGE}]}]}

    resolved = epic_brief_resolver.resolve_brief(raw, repo, epic)

    assert resolved["scope"][0]["tasks"][0]["parallel"] is True


def test_a_drafted_task_with_no_real_match_passes_through_untouched(make_repo):
    repo, epic = _epic(make_repo)
    raw = {
        "scope": [
            {
                "tasks_source": "draft",
                "tasks": [{"id": "T-D01", "text": "a plausible guess", "repo": "backend"}],
            }
        ]
    }

    resolved = epic_brief_resolver.resolve_brief(raw, repo, epic)

    assert resolved["scope"][0]["tasks"][0]["text"] == "a plausible guess"


def test_prep_tasks_are_resolved_the_same_way_as_scope_item_tasks(make_repo):
    repo, epic = _epic(make_repo)
    raw = {"scope": [], "prep_tasks": [{"id": "T001", "stage": STAGE}]}

    resolved = epic_brief_resolver.resolve_brief(raw, repo, epic)

    assert resolved["prep_tasks"][0]["text"] == "T001 Create `config/resolver.py` skeleton"


def test_an_out_of_scope_item_with_no_tasks_key_does_not_crash(make_repo):
    repo, epic = _epic(make_repo)
    raw = {"scope": [{"tasks_source": None, "in_scope": False}]}

    resolved = epic_brief_resolver.resolve_brief(raw, repo, epic)

    assert resolved["scope"][0]["in_scope"] is False


def test_a_brief_missing_scope_and_prep_tasks_entirely_does_not_crash(make_repo):
    repo, epic = _epic(make_repo)
    raw = {"epic_id": EPIC_ID, "generated_at": ""}

    resolved = epic_brief_resolver.resolve_brief(raw, repo, epic)

    assert resolved["epic_id"] == EPIC_ID


OTHER_STAGE = "099-second-spec"
OTHER_STORY = "EP-A-01-02"
OTHER_TASK = "T004 Text that belongs to the second spec"


def _with_collision_fixture(repo: Path) -> None:
    """Attach a second spec -- with its own same-numbered T004 -- to the epic's second story."""
    other = repo / "specs" / OTHER_STAGE
    other.mkdir(parents=True)
    (other / "spec.md").write_text(
        f'**Input**: User description: "Implement {OTHER_STORY}: the second story"\n'
, encoding="utf-8")
    (other / "plan.md").write_text("# Plan\n\n**Spec**: [spec.md](./spec.md)\n", encoding="utf-8")
    (other / "tasks.md").write_text(
        f"# Tasks: Second spec\n\n## Phase 1\n\n- [ ] {OTHER_TASK}\n"
, encoding="utf-8")


def test_a_task_from_each_of_two_specs_keeps_its_own_text(make_repo):
    repo, epic = _epic(make_repo, item_id="EP-A-01")
    _with_collision_fixture(repo)
    epic = epics_resolver.epics_item(repo, EPIC_ID)
    raw = {
        "scope": [
            {
                "tasks_source": "spec",
                "tasks": [
                    {"id": "T004", "stage": STAGE, "repo": "backend"},
                    {"id": "T004", "stage": OTHER_STAGE, "repo": "backend"},
                ],
            }
        ]
    }

    resolved = epic_brief_resolver.resolve_brief(raw, repo, epic)

    first = resolved["scope"][0]["tasks"][0]
    second = resolved["scope"][0]["tasks"][1]
    assert first["text"] == "T004 Fall back to defaults when the config file is missing"
    assert second["text"] == "T004 Text that belongs to the second spec"


def _with_duplicate_id_fixture(repo: Path) -> None:
    """A second spec whose tasks.md names T004 twice -- the same (stage, id) claims two texts."""
    other = repo / "specs" / OTHER_STAGE
    other.mkdir(parents=True)
    (other / "spec.md").write_text(
        f'**Input**: User description: "Implement {OTHER_STORY}: the second story"\n'
, encoding="utf-8")
    (other / "plan.md").write_text("# Plan\n\n**Spec**: [spec.md](./spec.md)\n", encoding="utf-8")
    (other / "tasks.md").write_text(
        f"# Tasks: Second spec\n\n## Phase 1\n\n- [ ] {OTHER_TASK}\n"
        "- [ ] T004 A conflicting second text\n"
, encoding="utf-8")


def test_a_task_id_duplicated_within_one_stage_splices_nothing(make_repo):
    """Same (stage, id) naming two texts is ambiguous: keep the model's text, pick neither."""
    repo, epic = _epic(make_repo, item_id="EP-A-01")
    _with_duplicate_id_fixture(repo)
    epic = epics_resolver.epics_item(repo, EPIC_ID)
    raw = {
        "scope": [
            {
                "tasks_source": "spec",
                "tasks": [
                    {
                        "id": "T004",
                        "stage": OTHER_STAGE,
                        "text": "agent's own guess",
                        "repo": "backend",
                    }
                ],
            }
        ]
    }

    resolved = epic_brief_resolver.resolve_brief(raw, repo, epic)

    task = resolved["scope"][0]["tasks"][0]
    assert task["text"] == "agent's own guess"
