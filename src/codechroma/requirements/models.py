"""Frozen dataclasses for the requirements portfolio (data-model.md) -- the source is read-only."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ItemRef:
    """The cheap listing entry -- must never grow a requirements/children/stages field (FR-007)."""

    id: str
    title: str
    status: str
    kind: str
    group: str | None = None


@dataclass(frozen=True)
class ItemLink:
    """A reference, never resolved by fetching -- title is the citing item's wording (FR-011)."""

    id: str
    relation: str
    title: str | None = None


@dataclass(frozen=True)
class Requirement:
    """One acceptance criterion; done=None (no checkbox) and done=False are distinct states."""

    id: str
    text: str
    kind: str
    source_ref: str
    done: bool | None = None


@dataclass(frozen=True)
class StageItem:
    """One section item inside a delivery artifact; a marker like [P] survives as literal text."""

    id: str
    text: str
    done: bool | None = None
    story: str | None = None
    parallel: bool = False


@dataclass(frozen=True)
class StageSection:
    """One phase/heading inside a delivery artifact, populated only under ?expand=."""

    title: str
    items: tuple[StageItem, ...] = ()
    done: int | None = None
    total: int | None = None


@dataclass(frozen=True)
class Stage:
    """One delivery artifact (spec/plan/tasks); sections stay empty until explicitly expanded."""

    kind: str
    name: str
    source_ref: str
    status: str | None = None
    done: int | None = None
    total: int | None = None
    sections: tuple[StageSection, ...] = ()


@dataclass(frozen=True)
class WorkItem:
    """One recursive requirement holder -- one type covers epic->story, init->epic->story->task."""

    id: str
    title: str
    status: str
    kind: str
    source_ref: str
    summary: str = ""
    group: str | None = None
    priority: str | None = None
    url: str | None = None
    requirements: tuple[Requirement, ...] = ()
    children: tuple[WorkItem, ...] = ()
    links: tuple[ItemLink, ...] = ()
    stages: tuple[Stage, ...] = field(default=())
    references: tuple[str, ...] = ()
    context_file: str | None = None
    component: str | None = None
