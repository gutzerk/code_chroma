"""The declarative `DiagramTypeDefinition` every diagram type (built-in or custom) is described by.

Replaces `bridge/diagram_registry.py`'s `DiagramSpec`/`DIAGRAMS` as the source of a type's *pure
data* -- title, style, instructions, artifact location, which named context/overlay/review/check
providers it uses. `diagrams/` sits below `bridge/` in this repo's layering (`bridge/` imports
`diagrams/`, never the reverse), so this module holds no plumbing closures (`resolve`/`generate`/
`agent_factory`) -- those stay bridge-side, keyed by the same `id`, in
`bridge/content_generators.py` (037-total-diagram-unification, Foundational phase).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from codechroma.diagrams import library
from codechroma.prompts import render_prompt

__all__ = [
    "CheckConfig",
    "ReviewConfig",
    "DiagramTypeDefinition",
    "BUILTIN_TYPES",
    "get_definition",
]

# Mirrored by `check_diagram.py`'s own budget table -- keep the two in sync (037, T021/T020).
_C1_BUDGET = {
    "max_nodes": 60, "max_relations": 60, "max_name_chars": 40, "max_edge_label_chars": 50,
}
_PATTERNS_BUDGET = {
    "max_nodes": 45, "max_relations": 70, "max_name_chars": 40, "max_edge_label_chars": 50,
}
_IMPACT_BUDGET = {
    "max_nodes": 25, "max_relations": 40, "max_name_chars": 40, "max_edge_label_chars": 40,
}
CUSTOM_BUDGET = {
    "max_nodes": 60, "max_relations": 100, "max_name_chars": 40, "max_edge_label_chars": 50,
}
# Same wiring hints every built-in/custom type has always gotten (pre-037's `_*_ISLAND_HINT`s).
PATTERNS_ISLAND_HINT = (
    "wire in the real caller (or whatever else connects it to the rest of the diagram, don't stop"
    " at the external system/dependency it wraps"
)
CUSTOM_ISLAND_HINT = (
    "wire in whatever connects it to the rest of the diagram, or merge/drop the cluster"
)
C1_ISLAND_HINT = (
    "add the missing arrow to `system` (or another actor already wired to it), or drop it"
)
IMPACT_ISLAND_HINT = "wire it into the rest of the slice, or drop the cluster"


@dataclass(frozen=True)
class CheckConfig:
    """Drives `bridge/inspect.py`'s `Inspector` dispatch -- see contracts/inspector-config.md."""

    shape: str  # "hierarchical" | "flat"
    budgets: dict[str, int] = field(default_factory=dict)
    min_depth: int | None = None
    unlabeled: str = "advisory"  # "shape" | "advisory"
    coverage_source: str | None = None
    density_source: str | None = None
    required_meta: list[str] = field(default_factory=list)
    membership_source: dict[str, list[str]] | None = None
    allow_self: bool = False
    check_islands: dict[str, str] | None = None
    # BARE only applies when actors are expected to decompose into children; c1 (042) turns it off.
    check_bare_actors: bool = True
    # Not part of the density family's 4-column table (contracts, drawing-rules.md) -- impact only.
    max_hero_edges: int | None = None


@dataclass(frozen=True)
class ReviewConfig:
    """`null` for a type with no review flow -- see contracts/review-result.md."""

    axis: str  # "explanatory" | "judgmental"
    agent_factory: str


@dataclass(frozen=True)
class DiagramTypeDefinition:
    """One declarative record per diagram type -- see data-model.md's `DiagramTypeDefinition`."""

    id: str
    title: str
    style: str | dict
    instructions: str
    layout: dict = field(default_factory=lambda: {"direction": "TB"})
    grouping: dict = field(default_factory=lambda: {"enabled": False})
    relation_kinds: list[dict] = field(default_factory=list)
    artifact: str = ""
    context: str | None = None
    addons: dict[str, bool] = field(
        default_factory=lambda: {"coverage": False, "staleness": False, "grouping": False}
    )
    overlays: list[str] = field(default_factory=list)
    review: ReviewConfig | None = None
    checks: CheckConfig | None = None
    schema_version: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


BUILTIN_TYPES: dict[str, DiagramTypeDefinition] = {
    "c1": DiagramTypeDefinition(
        id="c1",
        title="C1",
        style="boxes-arrows",
        instructions=render_prompt("c1_agent"),
        artifact=".codechroma/diagrams/c1/c1.json",
        context=None,
        # 042: c1 is a flat system-context view now, with nothing left for coverage to measure.
        addons={"coverage": False, "staleness": False, "grouping": False},
        overlays=[],
        review=None,
        checks=CheckConfig(
            shape="hierarchical", budgets=_C1_BUDGET, min_depth=5, unlabeled="shape",
            check_bare_actors=False, check_islands={"hint": C1_ISLAND_HINT},
        ),
    ),
    "patterns": DiagramTypeDefinition(
        id="patterns",
        title="Design patterns",
        style="boxes-arrows",
        instructions=render_prompt("patterns_agent"),
        artifact=".codechroma/diagrams/patterns/patterns.json",
        context="patterns",
        addons={"coverage": False, "staleness": True, "grouping": False},
        overlays=[],
        review=None,
        checks=CheckConfig(
            shape="flat", budgets=_PATTERNS_BUDGET, density_source="patterns",
            required_meta=["confirmed"], allow_self=True,
            check_islands={"hint": PATTERNS_ISLAND_HINT},
        ),
    ),
    "impact": DiagramTypeDefinition(
        id="impact",
        title="Change impact",
        style="boxes-arrows",
        instructions=render_prompt("impact_agent"),
        artifact=".codechroma/diagrams/impact/impact.json",
        context="impact",
        addons={"coverage": False, "staleness": False, "grouping": False},
        overlays=["changes"],
        # The explanatory review axis moved here from c1 -- see docs/architecture/diagram-skills.md.
        review=ReviewConfig(axis="explanatory", agent_factory="impact-changes"),
        checks=CheckConfig(
            shape="flat", budgets=_IMPACT_BUDGET,
            membership_source={"ancestor_prefixes": ["dir::", "component::"]},
            check_islands={"hint": IMPACT_ISLAND_HINT}, max_hero_edges=2,
        ),
    ),
}


def _review_from_dict(raw: object) -> ReviewConfig | None:
    if not isinstance(raw, dict):
        return None
    axis, agent_factory = raw.get("axis"), raw.get("agent_factory")
    if not isinstance(axis, str) or not isinstance(agent_factory, str):
        return None
    return ReviewConfig(axis=axis, agent_factory=agent_factory)


def _checks_from_dict(raw: object) -> CheckConfig | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("shape"), str):
        return None
    known = {f.name for f in CheckConfig.__dataclass_fields__.values()}
    return CheckConfig(**{k: v for k, v in raw.items() if k in known})


def _default_custom_checks(data: dict) -> CheckConfig:
    """Today's actual custom-type check behavior -- allow_self follows style, islands always run."""
    return CheckConfig(
        shape="flat",
        budgets=CUSTOM_BUDGET,
        allow_self=data.get("style") == "dependency-graph",
        check_islands={"hint": CUSTOM_ISLAND_HINT},
    )


def _definition_from_custom(data: dict) -> DiagramTypeDefinition:
    """A saved library definition, with FR-011's safe defaults for every field it doesn't carry."""
    default_addons = {"coverage": False, "staleness": False, "grouping": False}
    return DiagramTypeDefinition(
        id=f"custom/{data['id']}",
        title=data.get("title", data["id"]),
        style=data.get("style", ""),
        instructions=data.get("instructions", ""),
        layout=data.get("layout") or {"direction": "TB"},
        grouping=data.get("grouping") or {"enabled": False},
        relation_kinds=data.get("relation_kinds") or [],
        artifact=f".codechroma/diagrams/custom/{data['id']}/{data['id']}.json",
        context=data.get("context"),
        addons={**default_addons, **(data.get("addons") or {})},
        overlays=data.get("overlays") or [],
        review=_review_from_dict(data.get("review")),
        checks=_checks_from_dict(data.get("checks")) or _default_custom_checks(data),
        schema_version=data.get("schema_version"),
        created_at=data.get("created_at"),
        updated_at=data.get("updated_at"),
    )


def get_definition(kind: str) -> DiagramTypeDefinition | None:
    """A type's declarative definition by kind -- a built-in, or a synthesized custom one."""
    builtin = BUILTIN_TYPES.get(kind)
    if builtin is not None:
        return builtin
    if not kind.startswith("custom/"):
        return None
    type_id = kind[len("custom/"):]
    data = library.load_type(type_id) if type_id else None
    return _definition_from_custom(data) if data is not None else None
