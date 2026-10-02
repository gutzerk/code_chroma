# CodeChroma

Builds a semantic, zoomable architecture hierarchy from a repo's code structure, and renders it
on a live canvas as diagrams (C1, patterns, custom, etc.).

## Language

### Diagram flow order

**Order**:
An authored, optional string on a diagram box ("1", "2", "2a"/"2b") recording its place in a
process the diagram describes. Two boxes sharing the same leading digit ("2a"/"2b") happen
concurrently — see Concurrency island. Written by whichever agent/skill authors the diagram —
never computed from a call graph or execution trace. When present, Order decides a box's position
directly; it is not merely a tiebreaker within a position decided by arrow topology.
_Avoid_: Step, sequence, index.

**Lane**:
An author-assigned track naming who performs a step (e.g. "Control plane", "VM"). Boxes sharing a
Lane render inside the same soft, tinted area, independent of Order — a Lane groups by performer,
not by when something happens.
_Avoid_: Executor track, performer track, swimlane.

**Concurrency island**:
A highlighted zone marking the boxes that share a leading Order digit (e.g. the "2a" and "2b" of a
concurrent step), keeping them visually grouped as happening at once. Cuts across Lanes: boxes in
one island can belong to different Lanes.
_Avoid_: Parallel lane — this concept was called "Lane" before that name was reassigned to the
executor track above.

**Pipeline-direction layout**:
The layout requirement for a diagram that has Order data: the diagram flows in one increasing-Order
direction overall (e.g. top-to-bottom), while boxes still group into their Lane's soft island rather
than being forced onto one single-file axis. Order decides a box's rank directly, replacing today's
direction-plus-barycenter rank calculation.

**Not to be confused with**:
- *Trace playback* (`TraceFlowOverlay`/`traceStore`) — replays a recorded runtime execution's call
  order. A separate, code-hierarchy-only subsystem; not authored diagram data, and out of scope for
  Order/Lane/Concurrency island.
- *Trigger* (`meta.trigger`, plan 052) — marks a diagram's entry-point node(s). A different,
  unresolved concern (where a flow starts) from Order (what happens after what).

### Feature-plan diagrams

**Feature plan**:
A description of an intended future change — either the user's own words in conversation, or an
arbitrary `.md` document (a spec, a design doc; not limited to a `docs/planning/<feature>` dir) —
that seeds Feature-plan mode.

**Planned block**:
A diagram node authored with `meta.plan_kind` set to `add`/`create`/`modify`/`delete` marking it as
part of a Feature plan — the field's mere presence is the marker, not a separate flag. Lives under
`meta`, **not** the node's own `kind` — that field is already a closed icon-selection vocabulary
(`api`/`ui`/`service`/... ), and reusing it for a plan role trips the self-check's `BADKIND` rule on
every Planned block. `add`/`create` describes code that doesn't exist yet: drawn as its own distinct
box, with no real `path` behind it, so clicking one shows a description instead of the usual
source-code popup. `modify`/`delete` describes existing code the plan will change or remove: a real,
already-existing box just tagged with its role in the plan — clicking it still opens real source,
unchanged. Every `plan_kind` shares one visual convention: a dashed border, colored by `plan_kind`
(reusing the app's existing `add`/`modify`/`delete` palette, not a new one), plus an explicit text
chip naming it — a prototype comparing three visual treatments showed it needs to read as text, not
color alone.
_Avoid_: Ghost — already reserved (the review overlay's `can_ghost`) for a node that *used to* exist
and was removed, the opposite direction from a Planned block's `add`/`create` case. Also avoid
"draft"/"stub", and avoid bare "kind" when meaning this field — say `plan_kind` to keep it distinct
from the node's own `kind`.

**Feature-plan mode**:
The `codechroma-draw-diagram` mode that authors or updates Planned blocks from a Feature plan —
either into a fresh diagram (minimal current-implementation context, agent-selected, plus the new
Planned blocks) or added onto whichever diagram is currently active on the canvas. A sibling of the
skill's existing `highlight-process.md` mode, not a new separate skill. Distinct from `impact`'s own
`source=plan` mode (unaffected by this section) — see the diagram-skills architecture doc for both.
_Historical_: an older, separate mechanism also called itself "the Plan overlay" (the `codechroma-plan`
skill, `.codechroma/plan.json`, a canvas "Plan" toggle that pinned step badges onto the nearest
existing block). It has been retired; if you see "Plan overlay" in an older doc or commit, that's
what it meant — it is not Feature-plan mode under an old name.

**Not to be confused with**:
- *`impact`'s `status: new`* — colors an already-resolved *existing* node inside `impact`'s
  deterministic 1-hop graph slice; it never draws a node that isn't in the graph yet, unlike a
  Planned block.
- *"Slice"* (as `impact` uses it) — `impact`'s deterministic seed-plus-1-hop-neighbors algorithm.
  Feature-plan mode's current-implementation context is selected by agent judgment instead (the
  same way `patterns`/`custom` diagrams already explore the repo), so it deliberately has no
  "slice" of its own — describe it in plain language, not this term.

### Per-diagram storage (wayfinder map `diagram-per-file-storage`)

**Diagram artifact**:
The authored `nodes[]`/`relations[]` JSON a drawing skill writes for one diagram (the shape
`docs/architecture/diagram-skills.md` calls "the one shared diagram shape"). Unchanged in content;
only its location moves under this map, to its own diagram's directory.
_Avoid_: nothing new here — this term already existed in `docs/architecture/graph-bridge-core.md`
before this map; listed here only so the two new terms below can be defined against it.

**Diagram projection**:
The canvas-layer slice belonging to one diagram — its elements' and edges' *content* (identity,
`created_by`, `recipe_key`, `node_id`, `group_id`, style/meta overrides) reconciled from that
diagram's artifact by a recipe run. Deliberately excludes position/size — see Canvas core below.
Named for the existing verb: a recipe run "re-projects" an artifact onto the canvas
(`docs/architecture/single-canvas.md`); this is what it projects *into*, one file per diagram
instead of every diagram sharing one canvas file.
_Avoid_: "layout" — already taken by the unrelated saved-drag-position store (`LayoutStore`,
`.codechroma/{kind}-layout.json`, `GET/POST /repos/{id}/{kind}/layout`) for the hierarchy's "boxes"
strategy top-level box positions. A diagram projection is a different thing entirely: recipe-authored
canvas content, not a user's manual drag record.

**Canvas core**:
The one shared file holding two things: (1) every element's and edge's *position*/*size* —
regardless of which diagram, or no diagram, it belongs to — since geometry is inherently a
whole-canvas concern (relative arrangement, multi-select drag across diagrams) rather than one
diagram's own data; and (2) whatever *content* belongs to no single diagram — the seeded hierarchy
root, manual notes, and the rare hand-authored edge or group spanning two diagrams' elements. A
diagram's own regenerate prunes canvas core's stale position entries for elements the fresh artifact
no longer names, the same reconciliation discipline `build_batch_ops` already applies within one
file today.
_Avoid_: "canvas.json" alone once this map ships — that name stops meaning "the whole document" and
starts meaning specifically this one file. Also avoid describing canvas core as "leftover" — its
position-holding half is load-bearing for every diagram, not a residual bucket.

### Diagram draw-pass speed (wayfinder map `diagram-draw-speed`)

**Self-check**:
The shared `check_diagram.py` script (`--kind {c1,patterns,impact,custom,feature-plan}`) that
validates a diagram artifact's shape, flagging findings like `BROKEN`/`DUPLICATE`/`DANGLING`/
`ORPHAN`/`ISLAND`/`UNREVIEWED`/`BADKIND`. Runs locally as a script, not an HTTP call.

**Self-check loop**:
Inside one Draw pass, the edit-artifact-then-rerun-Self-check cycle a drawing skill repeats until
Self-check reports `OK`. Unbatched today: each fix is its own tool call followed by its own full
script rerun — the prime suspect for a Draw pass's high tool-call count.
_Avoid_: "self-check" alone when meaning the repeated cycle rather than the script itself.

**Draw pass**:
One end-to-end attempt to produce a diagram: from the triggering prompt (a user request or canvas
action) through context-gathering, the Self-check loop, and the final commit to canvas
(`POST /recipes/{kind}/run` or the feature-plan equivalent) that makes it visible. The unit whose
wall-clock length this map's ~4x speed target applies to.
_Avoid_: "session" — already means an assistant/terminal/parallel-agent session elsewhere in this
repo. "Run" alone — collides with "recipe run", the specific commit call inside a Draw pass.

**Rework**:
Time spent after a Draw pass has already committed a diagram to canvas, going back to fix something
the Self-check loop didn't catch (e.g. a click on a diagram node that resolves to nonexistent
backend data). A separate, later Draw pass in practice — not an iteration of the first pass's
Self-check loop — but counted toward the same time budget this map is optimizing.
_Avoid_: conflating with Self-check loop — Rework happens after canvas commit; the Self-check loop
happens before it.
