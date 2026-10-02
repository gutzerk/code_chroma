"""The one thing custom diagrams still need beyond the shared resolver: the grouping on/off gate.

036-shared-diagram-style-catalog: node/relation validation, path resolution and the `groups` list
itself all moved into the shared `diagram_resolver.resolve_diagram()` -- a custom type's own
`resolve` closure (`diagram_registry.DiagramRegistry._synthesize_custom`) calls that directly now.
The one thing left here is `grouping_enabled`: a type's own author-chosen `definition.grouping`
toggle, independent of whether its chosen style happens to support groups at all -- a type whose
author never wanted grouping must not start showing clusters just because its style could draw
them.
"""

from __future__ import annotations

from codechroma.diagrams.styles import STYLES

__all__ = ["grouping_enabled"]


def grouping_enabled(definition: dict) -> bool:
    """Whether a custom type's own generated diagram should carry `groups` at all."""
    style_id = definition.get("style")
    style = STYLES.get(style_id) if isinstance(style_id, str) else None
    grouping = definition.get("grouping")
    wants_groups = isinstance(grouping, dict) and bool(grouping.get("enabled"))
    return wants_groups and bool(style and style.overrides.get("supports_groups"))
