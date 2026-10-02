"""Frozen dataclasses for one epic's AI brief (008-epics-ai-brief) -- serialized to/from JSON."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BriefTask:
    """One task attached to a scope item (or to the epic-level prep bucket).

    `stage` is the tasks-stage `name` (the spek slug) the real task came from, so the resolver can
    splice its text back keyed off `(stage, id)` -- a task `id` is only unique within one spec.
    """

    id: str
    text: str
    parallel: bool = False
    repo: str | None = None
    stage: str | None = None
    is_test: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "text": self.text,
            "parallel": self.parallel,
            "repo": self.repo,
            "stage": self.stage,
            "is_test": self.is_test,
        }

    @classmethod
    def from_dict(cls, data: dict) -> BriefTask:
        return cls(
            id=data.get("id", ""),
            text=data.get("text", ""),
            parallel=bool(data.get("parallel", False)),
            repo=data.get("repo"),
            stage=data.get("stage"),
            is_test=bool(data.get("is_test", False)),
        )


@dataclass(frozen=True)
class ScopeItem:
    """One in- or out-of-scope item; tasks live here, never in a separate top-level tier."""

    id: str
    title: str
    description: str
    in_scope: bool
    tasks: tuple[BriefTask, ...] = ()
    tasks_source: str | None = None
    out_of_scope_ref: str | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "in_scope": self.in_scope,
            "tasks": [task.to_dict() for task in self.tasks],
            "tasks_source": self.tasks_source,
            "out_of_scope_ref": self.out_of_scope_ref,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ScopeItem:
        tasks = tuple(BriefTask.from_dict(task) for task in data.get("tasks", []))
        return cls(
            id=data.get("id", ""),
            title=data.get("title", ""),
            description=data.get("description", ""),
            in_scope=bool(data.get("in_scope", True)),
            tasks=tasks,
            tasks_source=data.get("tasks_source"),
            out_of_scope_ref=data.get("out_of_scope_ref"),
        )


@dataclass(frozen=True)
class AcceptanceCriterion:
    """One checklist row; closes_scope_id=None renders the canvas's red "gap" badge."""

    id: str
    text: str
    done: bool | None
    closes_scope_id: str | None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "text": self.text,
            "done": self.done,
            "closes_scope_id": self.closes_scope_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> AcceptanceCriterion:
        return cls(
            id=data.get("id", ""),
            text=data.get("text", ""),
            done=data.get("done"),
            closes_scope_id=data.get("closes_scope_id"),
        )


@dataclass(frozen=True)
class Dependency:
    """One depends_on/enables/risk/check line in the "Dependencies & risks" frame."""

    kind: str
    text: str
    ids: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {"kind": self.kind, "text": self.text, "ids": list(self.ids)}

    @classmethod
    def from_dict(cls, data: dict) -> Dependency:
        return cls(
            kind=data.get("kind", ""),
            text=data.get("text", ""),
            ids=tuple(data.get("ids", [])),
        )


@dataclass(frozen=True)
class BriefSpoke:
    """One owning repo/area of a multi-repo epic -- mirrors the LMP-123 spokes list entry."""

    spoke: str
    role: str = ""

    def to_dict(self) -> dict:
        return {"spoke": self.spoke, "role": self.role}

    @classmethod
    def from_dict(cls, data: dict) -> BriefSpoke:
        return cls(
            spoke=data.get("spoke", ""),
            role=data.get("role", ""),
        )


@dataclass(frozen=True)
class EpicBrief:
    """The whole per-epic artifact the skill writes to .codechroma/epics/briefs/<epic_id>.json."""

    epic_id: str
    generated_at: str
    problem: tuple[str, ...] = ()
    component: str | None = None
    spokes: tuple[BriefSpoke, ...] = ()
    scope: tuple[ScopeItem, ...] = ()
    prep_tasks: tuple[BriefTask, ...] = ()
    dependencies: tuple[Dependency, ...] = ()
    acceptance: tuple[AcceptanceCriterion, ...] = ()

    def to_dict(self) -> dict:
        return {
            "epic_id": self.epic_id,
            "generated_at": self.generated_at,
            "problem": list(self.problem),
            "component": self.component,
            "spokes": [spoke.to_dict() for spoke in self.spokes],
            "scope": [item.to_dict() for item in self.scope],
            "prep_tasks": [task.to_dict() for task in self.prep_tasks],
            "dependencies": [dep.to_dict() for dep in self.dependencies],
            "acceptance": [ac.to_dict() for ac in self.acceptance],
        }

    @classmethod
    def from_dict(cls, data: dict) -> EpicBrief:
        problem = data.get("problem", [])
        return cls(
            epic_id=data.get("epic_id", ""),
            generated_at=data.get("generated_at", ""),
            problem=tuple(problem) if isinstance(problem, list) else (),
            component=data.get("component"),
            spokes=tuple(_as_dicts(data.get("spokes"), BriefSpoke.from_dict)),
            scope=tuple(_as_dicts(data.get("scope"), ScopeItem.from_dict)),
            prep_tasks=tuple(_as_dicts(data.get("prep_tasks"), BriefTask.from_dict)),
            dependencies=tuple(_as_dicts(data.get("dependencies"), Dependency.from_dict)),
            acceptance=tuple(
                _as_dicts(data.get("acceptance"), AcceptanceCriterion.from_dict)
            ),
        )


def _as_dicts(entries: object, build) -> list:
    """Builds `build` for each dict entry in `entries`, skipping anything that isn't one -- a
    JSON-valid but schema-malformed brief must not 500 the poll/cancel route on first read."""
    if not isinstance(entries, list):
        return []
    return [build(entry) for entry in entries if isinstance(entry, dict)]
