"""Splices real `tasks.md` text/parallel onto a brief's tasks, keyed by `(stage, id)`."""

from __future__ import annotations

from pathlib import Path

from codechroma.bridge import epic_brief_agent

__all__ = ["resolve_brief"]

# An id whose owning spec can't be pinned (no `stage`, or a repeated key); `_merge_task` skips it.
_AMBIGUOUS = object()


def _task_index(root: Path, epic: dict) -> dict:
    """`{(stage_name, task_id): {"text": ..., "parallel": ...}}`, fresh from `tasks.md`."""
    # `brief_path` only feeds `build_brief_bundle`'s unused-here `write_path` field.
    bundle = epic_brief_agent.build_brief_bundle(root, epic["id"], epic, Path())
    index: dict = {}
    for stage in bundle["tasks_by_stage"]:
        stage_name = stage.get("name")
        for section in stage.get("sections", []):
            for item in section.get("items", []):
                if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                    continue
                key = (stage_name, item["id"])
                index[key] = _AMBIGUOUS if key in index else item
    return index


def _merge_task(task: object, index: dict) -> object:
    if not isinstance(task, dict):
        return task
    real = index.get((task.get("stage"), task.get("id")))
    if real is None or real is _AMBIGUOUS:
        return task
    return {**task, "text": real.get("text", ""), "parallel": bool(real.get("parallel", False))}


def _merge_scope_item(item: object, index: dict) -> object:
    if not isinstance(item, dict):
        return item
    tasks = item.get("tasks")
    if not isinstance(tasks, list):
        return item
    return {**item, "tasks": [_merge_task(task, index) for task in tasks]}


def resolve_brief(raw: dict, root: Path, epic: dict) -> dict:
    """The brief from disk with every task's `text`/`parallel` refreshed from `tasks.md` by id."""
    index = _task_index(root, epic)
    merged = dict(raw)
    scope = raw.get("scope")
    if isinstance(scope, list):
        merged["scope"] = [_merge_scope_item(item, index) for item in scope]
    prep_tasks = raw.get("prep_tasks")
    if isinstance(prep_tasks, list):
        merged["prep_tasks"] = [_merge_task(task, index) for task in prep_tasks]
    return merged
