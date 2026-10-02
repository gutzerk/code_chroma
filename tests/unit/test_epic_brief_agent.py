"""EpicBrief's to_dict/from_dict round-trip; epic_brief_agent's job_key/path shape."""

from __future__ import annotations

import shutil
from pathlib import Path

from codechroma.bridge import epic_brief_agent, epics_resolver
from codechroma.requirements.brief_models import (
    AcceptanceCriterion,
    BriefSpoke,
    BriefTask,
    Dependency,
    EpicBrief,
    ScopeItem,
)

_BRIEF = EpicBrief(
    epic_id="LMP-65",
    generated_at="2026-08-12T10:00:00Z",
    problem=("Operators need one entry point.",),
    component="application",
    spokes=(
        BriefSpoke(spoke="application", role="Leading half."),
        BriefSpoke(spoke="inference", role="Model-placement half."),
    ),
    scope=(
        ScopeItem(
            id="scope-proxy",
            title="Proxy",
            description="Forwards to LiteLLM.",
            in_scope=True,
            tasks=(
                BriefTask(
                    id="T003",
                    text="test: 401 without bearer",
                    parallel=True,
                    repo="backend",
                    is_test=True,
                ),
            ),
            tasks_source="draft",
        ),
        ScopeItem(
            id="scope-quickstart",
            title="Quickstart links",
            description="Host-aware snippets.",
            in_scope=False,
            out_of_scope_ref="LMP-105",
        ),
    ),
    prep_tasks=(BriefTask(id="T001", text="scaffold gateway package"),),
    dependencies=(Dependency(kind="depends_on", text="session/auth floor", ids=("LMP-67",)),),
    acceptance=(
        AcceptanceCriterion(
            id="AC-01", text="401 without token", done=True, closes_scope_id="scope-proxy"
        ),
        AcceptanceCriterion(
            id="AC-05", text="disabled gateway returns 404", done=False, closes_scope_id=None
        ),
    ),
)

FIXTURE_ROOT = Path(__file__).parent.parent / "fixtures" / "requirements_repo"
EPIC_ID = "EP-A-01"


def _with_requirements_fixture(repo: Path) -> None:
    shutil.copytree(FIXTURE_ROOT / "plan", repo / "plan")
    shutil.copytree(FIXTURE_ROOT / "specs", repo / "specs")


def _build_bundle(make_repo, item_id=EPIC_ID) -> dict:
    repo = make_repo(prepare=_with_requirements_fixture)
    key = epic_brief_agent.job_key("main", item_id)
    path = epic_brief_agent.epic_brief_path(repo, key)
    epic = epics_resolver.epics_item(repo, item_id)
    return epic_brief_agent.build_brief_bundle(repo, item_id, epic, path)


def test_epic_brief_round_trips_through_to_dict_and_from_dict():
    restored = EpicBrief.from_dict(_BRIEF.to_dict())

    assert restored == _BRIEF


def test_gap_criterion_has_no_closing_scope_id():
    restored = EpicBrief.from_dict(_BRIEF.to_dict())

    assert restored.acceptance[1].closes_scope_id is None


def test_draft_scope_item_keeps_its_tasks_source_marker():
    restored = EpicBrief.from_dict(_BRIEF.to_dict())

    assert restored.scope[0].tasks_source == "draft"


def test_test_task_keeps_its_is_test_flag_through_the_round_trip():
    restored = EpicBrief.from_dict(_BRIEF.to_dict())

    assert restored.scope[0].tasks[0].is_test is True


def test_out_of_scope_item_has_no_tasks():
    restored = EpicBrief.from_dict(_BRIEF.to_dict())

    assert restored.scope[1].tasks == ()


def test_task_repo_round_trips():
    restored = EpicBrief.from_dict(_BRIEF.to_dict())

    assert restored.scope[0].tasks[0].repo == "backend"


def test_unset_task_repo_defaults_to_none():
    task = BriefTask.from_dict({"id": "T001", "text": "scaffold"})

    assert task.repo is None


def test_epic_component_and_spokes_round_trip():
    restored = EpicBrief.from_dict(_BRIEF.to_dict())

    assert restored.component == "application"
    assert restored.spokes[0].spoke == "application"
    assert restored.spokes[1].role == "Model-placement half."


def test_missing_spokes_default_to_empty():
    minimal = EpicBrief.from_dict(
        {"epic_id": "X", "generated_at": "", "scope": []}
    )

    assert minimal.component is None
    assert minimal.spokes == ()


def test_json_valid_but_schema_malformed_brief_does_not_crash():
    # A brief whose `scope`/`spokes` are objects (or whose scalar list fields hold a string) is
    # JSON-valid but schema-malformed. `_read_brief` on the route only guards OSError/ValueError,
    # so `from_dict` must not raise on these -- it skips non-list/non-dict entries instead of
    # crashing the poll/cancel route with a 500 on every read.
    malformed = EpicBrief.from_dict(
        {
            "epic_id": "EP-X",
            "generated_at": "",
            "problem": "a plain string, not a list",
            "scope": {"0": {"id": "s1", "title": "T", "description": "d", "in_scope": True}},
            "spokes": "not-a-list",
            "prep_tasks": [42, {"id": "T1", "text": "ok"}],
            "dependencies": [None],
            "acceptance": [{"id": "A1", "text": "x", "done": None, "closes_scope_id": None}],
        }
    )

    assert malformed.problem == ()
    assert malformed.scope == ()
    assert malformed.spokes == ()
    assert [task.id for task in malformed.prep_tasks] == ["T1"]
    assert malformed.dependencies == ()
    assert len(malformed.acceptance) == 1


def test_job_key_embeds_the_workspace_id_and_the_epic_id():
    key = epic_brief_agent.job_key("main", "LMP-65")

    assert key == "main:LMP-65"


def test_two_epics_against_the_same_repo_get_independent_artifact_files(tmp_path):
    key_a = epic_brief_agent.job_key("main", "LMP-65")
    key_b = epic_brief_agent.job_key("main", "LMP-67")
    path_a = epic_brief_agent.epic_brief_path(tmp_path, key_a)

    assert path_a != epic_brief_agent.epic_brief_path(tmp_path, key_b)


def test_epic_brief_path_is_named_after_the_epic_id_not_the_workspace(tmp_path):
    key = epic_brief_agent.job_key("main", "LMP-65")

    path = epic_brief_agent.epic_brief_path(tmp_path, key)

    assert path == epic_brief_agent.epic_briefs_dir(tmp_path) / "LMP-65.json"


def test_build_agent_names_itself_epic_brief_agent():
    agent = epic_brief_agent.build_agent()

    assert agent.name == "epic_brief_agent"


def test_bundle_carries_the_epic_and_a_tasks_spec_when_a_story_owns_it(make_repo):
    bundle = _build_bundle(make_repo)

    assert bundle["epic"]["id"] == EPIC_ID
    assert bundle["has_spec"] is True
    assert len(bundle["tasks_by_stage"]) == 1
    stage = bundle["tasks_by_stage"][0]
    assert stage["name"] == "001-first-story-feature"
    task_ids = [item["id"] for section in stage["sections"] for item in section["items"]]
    assert "T003" in task_ids


def test_bundle_has_no_spec_for_an_epic_without_an_attached_tasks_stage(make_repo):
    bundle = _build_bundle(make_repo, item_id="EP-A-02")

    assert bundle["has_spec"] is False
    assert bundle["tasks_by_stage"] == []


def test_bundle_points_at_the_brief_write_path(make_repo):
    bundle = _build_bundle(make_repo)

    assert bundle["write_path"].endswith(f".codechroma/epics/briefs/{EPIC_ID}.json")
