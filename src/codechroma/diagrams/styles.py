"""The render-style registry every diagram type shares -- what the interview/skill can pick.

036-shared-diagram-style-catalog: `DiagramStyle` no longer carries a fixed field per visual
property (`schema_hint`/`supports_groups`/`allow_self_relations`) -- it carries one open
`overrides` dict instead, so a new capability (a new key some resolver/renderer wants to read) needs
no dataclass change and no change to any existing preset. `resolve_style_overrides` is the one
place a diagram's `"style"` (a catalog name or an inline dict) turns into the effective overrides
map every layer reads from: `resolve_diagram` (bridge/diagram_resolver.py) for
`allow_self_relations`/`supports_groups`, `reshape`/the front-end for `edge_style`. See
`specs/036-shared-diagram-style-catalog/contracts/style-catalog.md`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

__all__ = ["DiagramStyle", "STYLES", "resolve_style_overrides"]


@dataclass(frozen=True)
class DiagramStyle:
    """One render style: what the interview offers, and the overrides its consumers read."""

    id: str
    label: str
    description: str
    overrides: dict[str, object] = field(default_factory=dict)


STYLES: dict[str, DiagramStyle] = {
    "boxes-arrows": DiagramStyle(
        id="boxes-arrows",
        label="Boxes & arrows",
        description=(
            "Plain boxes, optionally clustered into named groups, connected by labeled arrows. "
            "Fits most architecture/flow/dependency questions."
        ),
        overrides={"supports_groups": True},
    ),
    "dependency-graph": DiagramStyle(
        id="dependency-graph",
        label="Dependency graph",
        description=(
            "Boxes and labeled arrows for imports/calls between modules or files. Cycles are "
            "expected and are kept, not cleaned up -- a dependency graph without them defeats "
            "the point."
        ),
        overrides={"supports_groups": True, "allow_self_relations": True},
    ),
    # Reproduces today's per-relation-kind arrow coloring: a warning-colored arrow.
    "patterns-yellow-arrows": DiagramStyle(
        id="patterns-yellow-arrows",
        label="Patterns (yellow arrows)",
        description="Boxes and arrows tinted for the Design Patterns view's own relation styling.",
        overrides={"edge_style": {"border-color": "var(--warning)"}},
    ),
    # Node color here comes from each node's own authored meta.status, not from an edge style.
    "impact-status-colors": DiagramStyle(
        id="impact-status-colors",
        label="Impact (status colors)",
        description="Boxes and arrows for a change-impact slice; node color follows plan status.",
        overrides={"edge_style": {}},
    ),
    "layered-flow": DiagramStyle(
        id="layered-flow",
        label="Layered flow",
        description="A decomposed/layered look for a custom diagram grouped into named layers.",
        overrides={"supports_groups": True},
    ),
    "state-machine": DiagramStyle(
        id="state-machine",
        label="State machine",
        description=(
            "Boxes and arrows for a custom state-machine-shaped diagram; self-transitions are "
            "real data, kept rather than dropped."
        ),
        overrides={"allow_self_relations": True},
    ),
}


def resolve_style_overrides(style_source: object) -> dict[str, object]:
    """A diagram's effective overrides: catalog name -> overrides, inline dict as-is, else {}."""
    if isinstance(style_source, str):
        style = STYLES.get(style_source)
        return dict(style.overrides) if style is not None else {}
    if isinstance(style_source, dict):
        return dict(style_source)
    return {}
