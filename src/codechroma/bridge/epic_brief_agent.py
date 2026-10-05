"""codechroma-epic-brief's SkillAgent config -- one artifact per epic, keyed by a job_key."""

from __future__ import annotations

from pathlib import Path

from codechroma.bridge import epics_resolver
from codechroma.bridge.composite_agent import CompositeKeyAgentSpec
from codechroma.bridge.skill_agent import SkillAgent
from codechroma.prompts import render_prompt
from codechroma.requirements.markdown.speckit_source import stage_node_id

TIMEOUT_ENV_VAR = "codechroma_EPIC_BRIEF_TIMEOUT_SECONDS"

PROMPT = render_prompt("epic_brief_agent")


def epic_briefs_dir(repo_root: Path) -> Path:
    return repo_root / ".codechroma" / "epics" / "briefs"


def epic_brief_path(repo_root: Path, key: str) -> Path:
    """Where the skill is expected to write -- one file per epic, keyed off `job_key`'s epic id."""
    return _SPEC.artifact(repo_root, key)


def _has_valid_brief(data: object) -> bool:
    return isinstance(data, dict) and isinstance(data.get("scope"), list)


def build_brief_bundle(root: Path, item_id: str, epic: dict, brief_path: Path) -> dict:
    """Assemble everything the brief skill needs into one prompt-injected bundle, server-side."""
    stage_names = _tasks_stage_names(epic)
    tasks_by_stage = [_tasks_stage_for(root, item_id, name) for name in stage_names]

    return {
        "epic": epic,
        "tasks_by_stage": tasks_by_stage,
        "write_path": brief_path.as_posix(),
        "has_spec": bool(stage_names),
        "component": epic.get("component"),
    }


def _tasks_stages(epic: dict):
    """Every `kind: "tasks"` stage dict from the epic and its children (often lands on a child)."""
    for candidate in [epic, *epic.get("children", [])]:
        for stage in candidate.get("stages", []):
            if stage.get("kind") == "tasks":
                yield stage


def _tasks_stage_names(epic: dict) -> list[str]:
    """Every tasks stage's name, in the same order `_tasks_stages` yields them."""
    return [stage["name"] for stage in _tasks_stages(epic)]


def _tasks_stage_for(root: Path, item_id: str, name: str) -> dict:
    """Re-fetches the epic expanded to one stage; the item vanishing mid-brief reads as empty."""
    expanded = epics_resolver.epics_item(root, item_id, expand=stage_node_id(name, "tasks"))
    if expanded is None:
        return {"stage_node_id": stage_node_id(name, "tasks"), "name": None, "sections": []}
    return _tasks_stage(expanded, name)


def _tasks_stage(epic: dict, name: str) -> dict:
    """A compact `{stage_node_id, name, sections}` entry for one stage, empty if not found."""
    expand_id = stage_node_id(name, "tasks")
    for stage in _tasks_stages(epic):
        if stage["name"] == name:
            return {
                "stage_node_id": expand_id,
                "name": stage.get("name"),
                "sections": stage.get("sections", []),
            }
    return {"stage_node_id": expand_id, "name": None, "sections": []}


class EpicBriefAgentSpec(CompositeKeyAgentSpec):
    """Epic-brief's plug-in points -- only what an epic-keyed runner doesn't share with the rest."""

    kind = "epic-brief"
    name = "epic_brief_agent"
    prompt = PROMPT
    validate = staticmethod(_has_valid_brief)
    timeout_env_var = TIMEOUT_ENV_VAR
    invalid_error = "brief generation produced no valid scope"

    def artifact_dir(self, root: Path) -> Path:
        return epic_briefs_dir(root)


_SPEC = EpicBriefAgentSpec()


def job_key(workspace_id: str, epic_id: str) -> str:
    return _SPEC.job_key(workspace_id, epic_id)


def build_agent() -> SkillAgent:
    """A fresh epic-brief runner; called once per BridgeServices, never held as module state."""
    return _SPEC.build_agent()
