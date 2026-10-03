"""Stage 3 of 016-single-canvas-dashboard: converts a diagram kind's resolved payload into ops.

Deliberately bridge-agnostic (no `Workspace`, no HTTP) -- exactly like `document.py`/
`apply_batch.py`, this module only knows how to turn an already-resolved dict (the same shape
`GET /repos/{id}/{kind}` already returns) into a flat set of canvas elements/edges, and how to
reconcile that set against a document's existing ones. `bridge/routes/recipes.py` is the seam that
fetches a resolved payload for a given recipe name; it is the only caller of `run_recipe`.

Ownership: a recipe only ever adds, updates or deletes elements/edges in its own `layer` that carry
`created_by: "ai"` -- a `created_by: "user"` element (or one a user renamed and re-flagged) survives
every re-run untouched, and dropping it from the meta-tracked set never deletes it either. A kept
element's `position`/`size` are never touched by a re-run, only its content fields. Edges carry no
`created_by` of their own (see `document.py`), so an edge is reconciled by its endpoint pair
instead: only an edge between two elements this recipe still owns is a candidate for update/delete.

036-shared-diagram-style-catalog: one `reshape(resolved, render)` replaces `c1_reshape`/
`patterns_reshape`/`impact_reshape`/`custom_reshape`/`epics_reshape` now that every diagram type's
`resolve_diagram()` output is the one flat `nodes[]`/`relations[]` shape (`contracts/diagram-
schema.md`) -- there is no more nested tree to flatten (c1) or candidate/participant shape to fold
(patterns), so `graph_to_ops`'s old `_walk_graph` recursion and `GraphNode.aliases`/`children`/
`dedup_id` fields are gone with it. `RECIPES`/`recipe_for`'s `custom/<id>` special case collapse
into one layer-parameterized `Recipe` for the same reason: every kind's `to_ops` is now
`reshape(resolved, render=<kind>)`, varying only in its `render` string and its `layer`.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from codechroma.bridge.diagram_diagnostics import Diagnostics, relation_pair
from codechroma.canvas.document import CanvasDoc

RECIPE_KEY = "recipe_key"

# A diagram kind's own name -> the `render` string its canvas elements carry (a naming convention).
_RENDER_BY_KIND = {
    "c1": "c1", "patterns": "pattern", "impact": "impact", "epics": "epic", "sequence": "sequence",
}

# A lazily synthesized "<prefix>/<id>" kind -- extend this, not recipe_for, for a third one.
_SYNTHESIZED_PREFIXES = ("custom/", "feature-plan/", "epics/")

__all__ = [
    "GraphNode",
    "GraphShape",
    "Recipe",
    "RecipeEdge",
    "RecipeNode",
    "RecipeResult",
    "RECIPES",
    "build_batch_ops",
    "graph_to_ops",
    "recipe_for",
    "render_for",
    "reshape",
    "run_recipe",
    "run_recipe_with_drops",
]


@dataclass(frozen=True)
class RecipeNode:
    """One canvas element a recipe wants, keyed by a stable id from its own source data."""

    key: str
    render: str
    label: str
    description: str = ""
    node_id: str | None = None
    group: str | None = None
    meta: dict = field(default_factory=dict)
    # Author-specified override; `None` means "no override", never "clear" -- see build_batch_ops.
    style: dict[str, str] | None = None
    # Author-specified box footprint `{w, h}`; `None` means "leave the canvas default".
    # See GraphNode.size -- a wide/tall block (e.g. an epics Summary card) needs it to render sized.
    size: dict[str, float] | None = None


@dataclass(frozen=True)
class RecipeEdge:
    """One canvas edge a recipe wants, referencing two `RecipeNode.key`s from the same result."""

    from_key: str
    to_key: str
    label: str = ""
    kind: str = "uses"
    # 036: a relation's own style, or the diagram's edge_style -- resolve_diagram already decided.
    style: dict[str, str] | None = None
    # pr-lens-style emphasis (Impact only, `relations[].hero`) -- see RelationshipEdge's `isHero`.
    hero: bool = False
    # Call/transport token (`call`, `https`, `mcp`, ...) authored on `relations[].transport` --
    # rendered as a second line under the arrow's label (see EdgeLabel).
    transport: str | None = None
    # `file:line` of the edge's caller, from `relations[].meta.origin` (resolver-stamped) -- a
    # click on the arrow's label opens that code location.
    origin: str | None = None


@dataclass(frozen=True)
class RecipeResult:
    nodes: list[RecipeNode] = field(default_factory=list)
    edges: list[RecipeEdge] = field(default_factory=list)
    # The second, previously unreported drop layer: an edge the resolver kept but no box can anchor.
    dropped: list[dict] = field(default_factory=list)


@dataclass(frozen=True)
class GraphNode:
    """The canonical per-node shape `reshape()` produces -- see data-model.md's Node."""

    key: str
    render: str
    label: str
    description: str = ""
    node_id: str | None = None
    group: str | None = None
    style: dict[str, str] | None = None
    # Author-specified override for the box footprint -- `{w, h}` from the authored node's `size`.
    # `None` means "leave the canvas default"; the frontend `CanvasNodeBox` fixes width/height from
    # `element.size`, so a wide/tall block (e.g. an epics Summary card) must carry it here to reach
    # the rendered box, otherwise it renders at DEFAULT_ELEMENT_SIZE regardless of this field.
    size: dict[str, float] | None = None
    meta: dict = field(default_factory=dict)


@dataclass(frozen=True)
class GraphShape:
    """One instance per diagram, the output of `reshape()`."""

    nodes: tuple[GraphNode, ...] = ()
    # Raw relationship dicts (or garbage) -- `graph_to_ops` validates, `reshape` doesn't.
    relations: tuple[object, ...] = ()


def _dropped_list(notes: Diagnostics) -> list[dict]:
    """The raw drop records, uncapped -- the route caps once, after merging with the resolver's."""
    return [item.as_dict() for item in notes.items]


def _style_of(item: object) -> dict[str, str] | None:
    style = item.get("style") if isinstance(item, dict) else None
    return style if isinstance(style, dict) else None


def render_for(kind: str) -> str:
    """The `render` string a diagram kind's canvas elements carry -- a fixed naming convention."""
    if kind.startswith("custom/"):
        return "custom"
    if kind.startswith("epics/"):
        return "epic"
    return _RENDER_BY_KIND.get(kind, "custom")


def _node_of(item: dict, render: str) -> GraphNode:
    """Copies each shared Node field; `kind`/`icon`/`parent`/`seed` fold into `meta` for accents."""
    own_meta = item.get("meta")
    meta = dict(own_meta) if isinstance(own_meta, dict) else {}
    for key in ("kind", "icon", "parent", "seed"):
        value = item.get(key)
        if value is not None:
            meta[key] = value
    node_id = item.get("node_id")
    group = item.get("group")
    # A per-node `render` override lets one diagram mix kinds (e.g. an epics brief draws the epic
    # box as "epic" and its spec/user-story boxes as "spec"). Falls back to the kind-level render.
    node_render = item.get("render")
    resolved_render = node_render if isinstance(node_render, str) else render
    size = item.get("size")
    return GraphNode(
        key=item["id"], render=resolved_render,
        label=str(item.get("name") or item.get("title") or item["id"]),
        description=str(item.get("description") or ""),
        node_id=node_id if isinstance(node_id, str) else None,
        group=group if isinstance(group, str) else None,
        style=_style_of(item),
        size=size if isinstance(size, dict) else None,
        meta=meta,
    )


def reshape(resolved: dict, render: str) -> GraphShape:
    """One shared shape: nodes come from "nodes", or "items" for the epics index."""
    raw_nodes = resolved.get("nodes")
    if not isinstance(raw_nodes, list):
        raw_nodes = resolved.get("items") or []
    nodes = tuple(
        _node_of(item, render)
        for item in raw_nodes
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    )
    relations = tuple(resolved.get("relations") or [])
    if render == "sequence":
        # A sequence diagram's messages are dedicated elements (not edges): relations[] become
        # message-nodes with meta.order/from/to/async/return, and participants get `role:
        # "participant"`. A message whose from/to names no participant is dropped -- it would occupy
        # a canvas row the frontend can't anchor (the endpoint validation resolve_diagram's
        # keep_relation normally provides, applied defensively for a raw/`--json` file).
        participant_refs = {node.key for node in nodes}
        message_nodes = [
            item for item in relations
            if isinstance(item, dict) and isinstance(item.get("id"), str)
            and item.get("from") in participant_refs and item.get("to") in participant_refs
        ]
        nodes = tuple(
            _participant_node(item) for item in nodes
        ) + tuple(_message_node(item) for item in message_nodes)
        relations = ()
    return GraphShape(nodes=nodes, relations=relations)


def _participant_node(node: GraphNode) -> GraphNode:
    """Stamps a sequence participant's `meta.role` (distinct from the `message` role)."""
    return replace(node, meta={**node.meta, "role": "participant"})


def _message_node(item: dict) -> GraphNode:
    """Turns one `relations[]` message into a `render: "sequence"` message element.

    Unlike a participant (a `_node_of` node), a message carries no `path`/`node_id` of its own — it
    is a call *between* two participants. Everything the frontend needs to place and draw it rides
    in `meta`: its role, the `order` (time row), the resolved participant `from`/`to` (kept as the
    authored ids, which are also addressable in the same file), and the `async`/`return` flags for
    arrow shaping. A message's `id` is its own stable recipe key, unique in the file.
    """
    own_meta = item.get("meta")
    meta = dict(own_meta) if isinstance(own_meta, dict) else {}
    meta.update({
        "role": "message",
        "from": item.get("from"),
        "to": item.get("to"),
        "order": item.get("order"),
        "async": bool(item.get("async")),
        "return": bool(item.get("return")),
    })
    # A private "kind" is irrelevant on a message; drop `_node_of`'s kind/icon/parent folding by
    # building the GraphNode directly from the relation's own fields.
    return GraphNode(
        key=item["id"],
        render="sequence",
        label=str(item.get("label") or ""),
        description=str(item.get("description") or ""),
        meta=meta,
        style=_style_of(item),
    )


def graph_to_ops(shape: GraphShape) -> RecipeResult:
    """The one walk from a `GraphShape` to the flat `RecipeNode`/`RecipeEdge`s it emits."""
    nodes = [
        RecipeNode(
            key=node.key, render=node.render, label=node.label, description=node.description,
            node_id=node.node_id, group=node.group, meta=node.meta, style=node.style,
            size=node.size,
        )
        for node in shape.nodes
    ]
    key_by_ref = {node.key: node.key for node in shape.nodes}
    edges: list[RecipeEdge] = []
    notes = Diagnostics()
    for relation in shape.relations:
        if not isinstance(relation, dict):
            notes.drop("relation", None, "invalid_shape")
            continue
        from_ref, to_ref = relation.get("from"), relation.get("to")
        from_key = key_by_ref.get(from_ref) if isinstance(from_ref, str) else None
        to_key = key_by_ref.get(to_ref) if isinstance(to_ref, str) else None
        if from_key is None or to_key is None:
            notes.drop("relation", relation_pair(relation), "dangling_endpoint")
            continue
        transport = relation.get("transport")
        meta = relation.get("meta")
        origin = meta.get("origin") if isinstance(meta, dict) else None
        edges.append(RecipeEdge(
            from_key=from_key, to_key=to_key,
            label=str(relation.get("label") or ""), kind=str(relation.get("kind") or "uses"),
            style=_style_of(relation), hero=bool(relation.get("hero")),
            transport=str(transport) if transport else None,
            origin=str(origin) if origin else None,
        ))
    return RecipeResult(nodes=nodes, edges=edges, dropped=_dropped_list(notes))


@dataclass(frozen=True)
class Recipe:
    """One recipe's own layer name plus which `render` kind `reshape()` gives its nodes."""

    name: str
    layer: str
    render: str

    def to_ops(self, resolved: dict) -> RecipeResult:
        return graph_to_ops(reshape(resolved, self.render))


RECIPES: dict[str, Recipe] = {
    kind: Recipe(kind, kind, render_for(kind)) for kind in _RENDER_BY_KIND
}


def recipe_for(name: str) -> Recipe:
    """The recipe `name` names; every synthesized `<prefix>/<id>` kind shares one recipe."""
    recipe = RECIPES.get(name)
    if recipe is not None:
        return recipe
    # No shape check on the suffix -- diagram_registry.py's DIAGRAMS.get(kind) re-validates it.
    for prefix in _SYNTHESIZED_PREFIXES:
        if name.startswith(prefix) and len(name) > len(prefix):
            return Recipe(name, name, render_for(name))
    raise KeyError(name)


def _group_key(group: str) -> str:
    return f"__group__::{group}"


def build_batch_ops(doc: CanvasDoc, layer: str, result: RecipeResult) -> list[dict]:
    """The ops that bring `layer` in line with `result`, touching only what it still owns."""
    existing_by_key = {
        element.meta.get(RECIPE_KEY): element
        for element in doc.elements.values()
        if element.layer == layer and element.created_by == "ai"
        and isinstance(element.meta.get(RECIPE_KEY), str)
    }
    ops: list[dict] = []
    seen_keys: set[str] = set()
    ref_for: dict[str, str] = {}

    groups = sorted({node.group for node in result.nodes if node.group})
    group_ref: dict[str, str] = {}
    for group in groups:
        group_key = _group_key(group)
        seen_keys.add(group_key)
        existing = existing_by_key.get(group_key)
        if existing is not None:
            group_ref[group] = existing.id
            if existing.label != group:
                ops.append({"op": "update_element", "id": existing.id, "label": group})
        else:
            temp_id = f"g{len(ops)}"
            group_ref[group] = temp_id
            ops.append({
                "op": "add_group", "temp_id": temp_id, "layer": layer, "label": group,
                "meta": {RECIPE_KEY: group_key}, "created_by": "ai",
            })

    for node in result.nodes:
        seen_keys.add(node.key)
        group_id = group_ref.get(node.group) if node.group else None
        meta = {**node.meta, RECIPE_KEY: node.key}
        existing = existing_by_key.get(node.key)
        if existing is not None:
            ref_for[node.key] = existing.id
            op = {
                "op": "update_element", "id": existing.id, "label": node.label,
                "description": node.description, "node_id": node.node_id,
                "group_id": group_id, "meta": meta,
            }
            # Never emit `style: null` -- an unrelated regenerate must not clear a manual highlight.
            if node.style is not None:
                op["style"] = node.style
            # A box footprint is authored data (the wide/tall epics Summary card) -- same rule as
            # `style`: emit it only when the node carries one, never null to keep an unrelated
            # regenerate from touching a manual size.
            if node.size is not None:
                op["size"] = node.size
            ops.append(op)
        else:
            temp_id = f"n{len(ops)}"
            ref_for[node.key] = temp_id
            op = {
                "op": "add_element", "temp_id": temp_id, "render": node.render, "layer": layer,
                "label": node.label, "description": node.description, "node_id": node.node_id,
                "group_id": group_id, "meta": meta, "created_by": "ai",
            }
            if node.style is not None:
                op["style"] = node.style
            if node.size is not None:
                op["size"] = node.size
            ops.append(op)

    deleting_element_ids: set[str] = set()
    for key, element in existing_by_key.items():
        if key not in seen_keys:
            deleting_element_ids.add(element.id)
            ops.append({"op": "delete_element", "id": element.id})

    ai_element_ids = {element.id for element in existing_by_key.values()}
    existing_edges_by_pair = {
        (edge.from_, edge.to): edge
        for edge in doc.edges.values()
        if edge.layer == layer and edge.from_ in ai_element_ids and edge.to in ai_element_ids
        # delete_element's own cascade already drops this edge -- don't double-delete it here.
        and edge.from_ not in deleting_element_ids and edge.to not in deleting_element_ids
    }
    seen_pairs: set[tuple[str, str]] = set()
    for edge in result.edges:
        from_ref, to_ref = ref_for.get(edge.from_key), ref_for.get(edge.to_key)
        if from_ref is None or to_ref is None:
            continue
        pair = (from_ref, to_ref)
        existing_edge = existing_edges_by_pair.get(pair) if pair[0] in ai_element_ids else None
        if existing_edge is not None:
            seen_pairs.add(pair)
            # Only fields we will actually emit may flag a change: an optional field that is now
            # None is never shipped (an unrelated re-run must not clear a manual override or a
            # field another layer authored), so comparing it would keep re-emitting `update_edge`
            # forever without converging.
            changed = (
                existing_edge.label != edge.label or existing_edge.kind != edge.kind
                or existing_edge.hero != edge.hero
            )
            if edge.style is not None and existing_edge.style != edge.style:
                changed = True
            if edge.transport is not None and existing_edge.transport != edge.transport:
                changed = True
            if edge.origin is not None and existing_edge.origin != edge.origin:
                changed = True
            if changed:
                op = {
                    "op": "update_edge", "id": existing_edge.id,
                    "label": edge.label, "kind": edge.kind, "hero": edge.hero,
                }
                if edge.style is not None:
                    op["style"] = edge.style
                if edge.transport is not None:
                    op["transport"] = edge.transport
                if edge.origin is not None:
                    op["origin"] = edge.origin
                ops.append(op)
        else:
            op = {
                "op": "add_edge", "from": from_ref, "to": to_ref,
                "label": edge.label, "kind": edge.kind, "layer": layer, "hero": edge.hero,
            }
            if edge.style is not None:
                op["style"] = edge.style
            if edge.transport is not None:
                op["transport"] = edge.transport
            if edge.origin is not None:
                op["origin"] = edge.origin
            ops.append(op)

    for pair, stale_edge in existing_edges_by_pair.items():
        if pair not in seen_pairs:
            ops.append({"op": "delete_edge", "id": stale_edge.id})

    return ops


def run_recipe(doc: CanvasDoc, name: str, resolved: dict) -> list[dict]:
    """The ops one run of recipe `name` needs, given its already-resolved payload."""
    return run_recipe_with_drops(doc, name, resolved)[0]


def run_recipe_with_drops(
    doc: CanvasDoc, name: str, resolved: dict
) -> tuple[list[dict], list[dict]]:
    """The same ops, plus what the converter itself could not draw, for the route to report."""
    recipe = recipe_for(name)
    result = recipe.to_ops(resolved)
    return build_batch_ops(doc, recipe.layer, result), result.dropped
