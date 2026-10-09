"""The one assembled canvas document: `CanvasDoc`/`Element`/`Edge`.

`CanvasDoc` is in-memory only now (docs/planning/wayfinder/diagram-per-file-storage): it is what
`apply_batch` mutates and what `GET /repos/{id}/canvas` serves, but it is never itself a single file
on disk. It is assembled from two on-disk pieces, split by `CONTEXT.md`'s "Per-diagram storage":
`CanvasCore` (`.codechroma/canvas-core.json` -- every element's position/size, plus the full content
of whatever belongs to no diagram: the seeded hierarchy root, notes) and, per diagram, a
`DiagramProjection` (`.codechroma/diagrams/<kind>/projection.json` -- that diagram's own elements'
and edges' content, no position). `apply_batch` itself needs no change for this: it never touches
disk, only `CanvasDoc.load`/`.save` do.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Self

from pydantic import BaseModel, Field

from codechroma.io import is_within_dir, load_json, write_json

SCHEMA_VERSION = 1

# `render` values a v1 element may carry; each maps to one entry in the web's `nodeStyles.tsx`
# (`web/src/canvas/doc/elementRules.ts`). `spec` is the story/user-story box of an epics brief —
# `recipes.py`'s per-node render override authors it alongside the `epic` box, and the web styles it
# (`elementRules.ts`'s `spec`), so it belongs in the allow-list even though no front-nodeStyle host
# predates it.
RENDER_KINDS = (
    "hierarchy", "c1", "pattern", "impact", "epic", "spec", "task", "custom", "group", "note",
    "sequence",
)

# Layers with no diagram of their own; must match diagramCatalog.ts's `NON_DIAGRAM_LAYERS` by hand.
NON_DIAGRAM_LAYERS = frozenset({"default", "hierarchy"})


def _new_id() -> str:
    return uuid.uuid4().hex


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class Position(BaseModel):
    x: float = 0.0
    y: float = 0.0


class Size(BaseModel):
    w: float = 0.0
    h: float = 0.0


class Element(BaseModel):
    """One box on the canvas -- a hierarchy pin, a recipe-authored node, a group, or a note."""

    id: str = Field(default_factory=_new_id)
    render: str = "note"
    layer: str = "default"
    label: str = ""
    description: str = ""
    node_id: str | None = None
    position: Position = Field(default_factory=Position)
    size: Size | None = None
    group_id: str | None = None
    meta: dict = Field(default_factory=dict)
    # "ai" (recipe-written) or "user" (hand-placed/edited); protects hand edits from a re-run.
    created_by: str = "ai"
    # Allow-listed CSS keys only; see apply_batch._sanitize_style for the enforced allow-list.
    style: dict[str, str] | None = None


class Edge(BaseModel):
    """One arrow between two elements, referenced by id."""

    id: str = Field(default_factory=_new_id)
    from_: str = Field(alias="from")
    to: str
    label: str = ""
    kind: str = "uses"
    layer: str = "default"
    # Allow-listed CSS keys only; see apply_batch._sanitize_style for the enforced allow-list.
    style: dict[str, str] | None = None
    # pr-lens-style emphasis (Impact only, authored `relations[].hero`).
    hero: bool = False
    # Call/transport token (`call`, `https`, `mcp`, ...) authored on `relations[].transport` --
    # rendered as a second line under the arrow's label (see EdgeLabel).
    transport: str | None = None
    # `file:line` of the edge's caller (provenance), resolver-stamped from the source symbol --
    # a click on the edge's label opens that code location.
    origin: str | None = None

    model_config = {"populate_by_name": True}


class PositionRecord(BaseModel):
    """One diagram-owned element's geometry, as held in CanvasCore -- content lives elsewhere."""

    position: Position = Field(default_factory=Position)
    size: Size | None = None


class _JsonFile(BaseModel):
    """Shared load/save shape for a model that is exactly the contents of one JSON file."""

    @classmethod
    def load(cls, path: Path) -> Self:
        """Parses `path`, tolerating a missing or malformed file (a fresh empty instance)."""
        raw = load_json(path)
        if not raw:
            return cls()
        return cls.model_validate(raw)

    def save(self, path: Path) -> bool:
        """Writes via `io.write_json`; returns whether the write landed."""
        return write_json(path, self.model_dump(by_alias=True))


class DiagramProjection(_JsonFile):
    """One diagram's own canvas content -- no position; see module docstring for the file layout."""

    elements: dict[str, Element] = Field(default_factory=dict)
    edges: dict[str, Edge] = Field(default_factory=dict)


class CanvasCore(_JsonFile):
    """Canvas-core geometry plus content owned by no diagram."""

    schema_version: int = SCHEMA_VERSION
    doc_id: str = Field(default_factory=_new_id)
    updated_at: str = ""
    positions: dict[str, PositionRecord] = Field(default_factory=dict)
    elements: dict[str, Element] = Field(default_factory=dict)
    edges: dict[str, Edge] = Field(default_factory=dict)

    def save(self, path: Path) -> bool:
        """Stamps the time, then writes via the shared `_JsonFile.save`."""
        self.updated_at = _now_iso()
        return super().save(path)


def _projection_path(diagrams_root: Path, layer: str) -> Path | None:
    """`diagrams_root/<layer>/projection.json`, or None if `layer` can't be trusted as a path."""
    candidate = diagrams_root.joinpath(*layer.split("/")) / "projection.json"
    return candidate if is_within_dir(diagrams_root, candidate) else None


def _layer_path(diagrams_root: Path, layer: str) -> Path | None:
    """None for a non-diagram layer (its content belongs in canvas core instead)."""
    return None if layer in NON_DIAGRAM_LAYERS else _projection_path(diagrams_root, layer)


class CanvasDoc(BaseModel):
    """The assembled in-memory document -- every element/edge, never one single on-disk file."""

    schema_version: int = SCHEMA_VERSION
    doc_id: str = Field(default_factory=_new_id)
    updated_at: str = ""
    elements: dict[str, Element] = Field(default_factory=dict)
    edges: dict[str, Edge] = Field(default_factory=dict)

    @classmethod
    def load(cls, canvas_core_path: Path, diagrams_root: Path) -> CanvasDoc:
        """Assembles core content/geometry plus every diagram's own projection into one document."""
        core = CanvasCore.load(canvas_core_path)
        doc = cls(
            schema_version=core.schema_version, doc_id=core.doc_id, updated_at=core.updated_at
        )
        # The code-tree block was retired; "hierarchy" stays a valid render only so old files load.
        doc.elements.update(
            {i: e for i, e in core.elements.items() if e.render != "hierarchy"}
        )
        doc.edges.update(core.edges)
        for projection_path in sorted(diagrams_root.glob("**/projection.json")):
            projection = DiagramProjection.load(projection_path)
            for element_id, element in projection.elements.items():
                record = core.positions.get(element_id)
                if record is not None:
                    element = element.model_copy(
                        update={"position": record.position, "size": record.size}
                    )
                doc.elements[element_id] = element
            doc.edges.update(projection.edges)
        return doc

    def save(self, canvas_core_path: Path, diagrams_root: Path) -> list[Path]:
        """Splits by layer, writes every touched/now-empty file; returns the paths that failed."""
        self.updated_at = _now_iso()
        core = CanvasCore(
            schema_version=self.schema_version, doc_id=self.doc_id, updated_at=self.updated_at
        )
        projections: dict[str, DiagramProjection] = {}
        for element_id, element in self.elements.items():
            if _layer_path(diagrams_root, element.layer) is None:
                core.elements[element_id] = element
                continue
            core.positions[element_id] = PositionRecord(
                position=element.position, size=element.size
            )
            content = element.model_copy(update={"position": Position(), "size": None})
            projection = projections.setdefault(element.layer, DiagramProjection())
            projection.elements[element_id] = content
        for edge_id, edge in self.edges.items():
            if _layer_path(diagrams_root, edge.layer) is None:
                core.edges[edge_id] = edge
                continue
            projections.setdefault(edge.layer, DiagramProjection()).edges[edge_id] = edge

        failed: list[Path] = []
        stale = {
            path for path in diagrams_root.glob("**/projection.json")
            if _layer_for(diagrams_root, path) not in projections
        }
        for layer, projection in projections.items():
            path = _projection_path(diagrams_root, layer)
            assert path is not None  # already filtered above when building `projections`
            if not projection.save(path):
                failed.append(path)
        for path in stale:
            if not DiagramProjection().save(path):
                failed.append(path)
        if not core.save(canvas_core_path):
            failed.append(canvas_core_path)
        return failed


def _layer_for(diagrams_root: Path, projection_path: Path) -> str:
    """The layer string a `diagrams_root/**/projection.json` path was written under."""
    return "/".join(projection_path.relative_to(diagrams_root).parent.parts)
