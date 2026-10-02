"""EpicsAssembler: merges the two ports into the index/item payloads, applies caps (D-11).

`index()` never touches fetch_item/stages_for (FR-007). `item()` reads exactly the one named item
plus, cheaply, the delivery source's per-item stage headers for it and its immediate children
(stages_for never parses artifact internals unless `expand` names that exact stage) -- no other
work item's body is read (FR-008).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import UTC, datetime

from codechroma.config import RequirementsConfig
from codechroma.requirements.models import (
    ItemLink,
    ItemRef,
    Requirement,
    Stage,
    StageItem,
    StageSection,
    WorkItem,
)
from codechroma.requirements.source import DeliverySource, RequirementsSource


def _serialize_ref(ref: ItemRef) -> dict:
    return {
        "id": ref.id,
        "title": ref.title,
        "status": ref.status,
        "kind": ref.kind,
        "group": ref.group,
    }


def _serialize_requirement(requirement: Requirement) -> dict:
    return {
        "id": requirement.id,
        "text": requirement.text,
        "kind": requirement.kind,
        "done": requirement.done,
        "source_ref": requirement.source_ref,
    }


def _serialize_link(link: ItemLink, index_ids: set[str]) -> dict:
    return {
        "id": link.id,
        "title": link.title,
        "relation": link.relation,
        "in_index": link.id in index_ids,
    }


def _serialize_stage_item(item: StageItem) -> dict:
    return {
        "id": item.id,
        "text": item.text,
        "done": item.done,
        "story": item.story,
        "parallel": item.parallel,
    }


def _serialize_stage_section(section: StageSection) -> dict:
    return {
        "title": section.title,
        "items": [_serialize_stage_item(i) for i in section.items],
        "done": section.done,
        "total": section.total,
    }


def _serialize_stage(stage: Stage) -> dict:
    return {
        "kind": stage.kind,
        "name": stage.name,
        "status": stage.status,
        "done": stage.done,
        "total": stage.total,
        "sections": [_serialize_stage_section(s) for s in stage.sections],
        "source_ref": stage.source_ref,
    }


def _serialize_work_item(work_item: WorkItem, index_ids: set[str]) -> dict:
    return {
        "id": work_item.id,
        "title": work_item.title,
        "status": work_item.status,
        "kind": work_item.kind,
        "summary": work_item.summary,
        "group": work_item.group,
        "priority": work_item.priority,
        "source_ref": work_item.source_ref,
        "url": work_item.url,
        "requirements": [_serialize_requirement(r) for r in work_item.requirements],
        "children": [_serialize_work_item(c, index_ids) for c in work_item.children],
        "links": [_serialize_link(link, index_ids) for link in work_item.links],
        "stages": [_serialize_stage(s) for s in work_item.stages],
        "references": list(work_item.references),
        "context_file": work_item.context_file,
        "component": work_item.component,
    }


@dataclass
class EpicsAssembler:
    """One instance per workspace (D-12); requirements/delivery are None for an unknown scheme."""

    requirements: RequirementsSource | None
    delivery: DeliverySource | None
    config: RequirementsConfig
    source_uri: str

    def index(self) -> dict:
        """Summaries only -- never calls fetch_item/stages_for on any item (FR-007)."""
        items = self.requirements.list_items() if self.requirements is not None else []
        capped = items[: self.config.max_items]
        omitted = len(items) - len(capped)
        named_groups = sorted({item.group for item in capped if item.group is not None})
        groups: list[str | None] = list(named_groups)
        if any(item.group is None for item in capped):
            groups.append(None)
        return {
            "source": self.source_uri,
            "groups": groups,
            "items": [_serialize_ref(item) for item in capped],
            "omitted": max(omitted, 0),
            "generated_at": datetime.now(UTC).isoformat(),
        }

    def item(self, item_id: str, expand: str | None = None) -> dict | None:
        """One WorkItem, capped and stage-attached; None for an unknown id (contract)."""
        if self.requirements is None:
            return None
        work_item = self.requirements.fetch_item(item_id)
        if work_item is None:
            return None
        resolved = self._with_caps_and_stages(work_item, expand)
        index_ids = self._index_ids_if_linked(resolved)
        return _serialize_work_item(resolved, index_ids)

    def _index_ids_if_linked(self, work_item: WorkItem) -> set[str]:
        """Full list_items() scan only when the tree has links needing an in_index check."""
        if not self._has_any_links(work_item):
            return set()
        assert self.requirements is not None  # sole caller already returned early otherwise
        return {ref.id for ref in self.requirements.list_items()}

    def _has_any_links(self, work_item: WorkItem) -> bool:
        return bool(work_item.links) or any(self._has_any_links(c) for c in work_item.children)

    def _with_caps_and_stages(self, work_item: WorkItem, expand: str | None) -> WorkItem:
        requirements = work_item.requirements[: self.config.max_requirements_per_item]
        children = tuple(
            replace(child, stages=self._stages_for(child.id, expand))
            for child in work_item.children
        )
        return replace(
            work_item,
            requirements=requirements,
            children=children,
            stages=self._stages_for(work_item.id, expand),
        )

    def _stages_for(self, item_id: str, expand: str | None) -> tuple[Stage, ...]:
        if self.delivery is None:
            return ()
        return tuple(self._cap_stage(stage) for stage in self.delivery.stages_for(item_id, expand))

    def _cap_stage(self, stage: Stage) -> Stage:
        """len(sum(section.items)) <= max_stage_items per stage (FR-025), sections in order."""
        if not stage.sections:
            return stage
        remaining = self.config.max_stage_items
        capped_sections: list[StageSection] = []
        for section in stage.sections:
            if remaining <= 0:
                break
            items = section.items[:remaining]
            remaining -= len(items)
            capped_sections.append(replace(section, items=items))
        return replace(stage, sections=tuple(capped_sections))
