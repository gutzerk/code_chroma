# The one canvas document (`src/codechroma/canvas/`, `web/src/canvas/doc/`) — 016-single-canvas-dashboard

⚠ **This covers Stages 1–5** of `docs/planning/016-single-canvas-dashboard/`. `RootCanvas` now
renders `CanvasDocView` unconditionally — the old six views (C1, Patterns, Epics, Impact, Custom,
plus the bespoke hierarchy-only rendering path) are deleted, not merely hidden behind a flag. Only
backend route/`Workspace` cleanup (Stage 6) remains; see that plan for the full picture.

🔴 **`CanvasDoc` is in-memory only now — it is never itself a single on-disk file**
(`docs/planning/wayfinder/diagram-per-file-storage/`, terms in `CONTEXT.md`'s "Per-diagram
storage"). It is assembled from `canvas-core.json` (every element's position/size, plus content
owned by no diagram — the seeded hierarchy root, notes) and, per diagram, a `diagrams/<kind>/
projection.json` (that diagram's own elements'/edges' content, never position). `apply_batch`
itself is untouched by this — it only ever mutates the assembled in-memory doc; only
`CanvasDoc.load`/`.save` (now taking `canvas_core_path` + `diagrams_root`, not one `path`) know
about the split. The bullets below describe the original single-file shape; treat every mention of
"`canvas.json`" in them as historical.

## Python — Stage 1

- `canvas/document.py` — `CanvasDoc`/`Element`/`Edge` pydantic models (the only pydantic-modeled
  `.codechroma/*` artifact; every other one is a plain dict via `io.load_json`/`write_json`, because
  this is the one file every future recipe and the chat skill will mutate through a single seam).
  `CanvasDoc.load(path)`/`.save(path)` handle a missing/malformed file as a fresh empty document and
  atomic temp+rename writes respectively. `Element.style`/`Edge.style: dict[str, str] | None` are
  optional allow-listed inline styles (`color`/`background`/`border-color`/`border-style`, enforced
  by `apply_batch.py`'s `_sanitize_style`) — an edge's own `style` is `edge_style`/relation `style`
  already resolved by `resolve_diagram` and carried on `RecipeEdge`. See
  [`diagram-skills.md`](diagram-skills.md)'s highlight-process section for the authoring rule and why
  it needed adding.
- `canvas/apply_batch.py` — `apply_batch(doc, ops, *, layer, explanation) -> BatchResult`, the one
  write point. Validates every op against a deep copy of `doc` first; if any op fails, the whole
  batch is rejected (`BatchResult.ok=False`, one `OpError` per failed op) and `doc` itself is never
  mutated. Ops: `add_element`, `add_group`, `add_note` (thin `add_element` variants defaulting
  `render` to `group`/`note`), `add_edge`, `update_element`, `update_edge`, `delete_element`
  (cascades to any edge referencing the deleted element), `delete_edge`. Caps: `MAX_OPS_PER_BATCH`
  (100), `MAX_EXPLANATION_CHARS` (1000), `MASS_DELETE_GUARD` (20 — more delete ops than this rejects
  the batch outright rather than silently wiping a layer).
- `bridge/routes/canvas.py` — `GET /repos/{id}/canvas` (the whole document) and
  `PATCH /repos/{id}/canvas` (one batch envelope `{layer, explanation, ops}`, returns
  `{ok, batch_id, id_map, affected}` or `{ok: false, errors}`). A successful `PATCH` saves the
  document and calls `ws.emit` directly with the richer `{"type": "canvas", batch_id, affected,
  new_elements}` ping — it does not wait for the watcher, so the client the ping matters to isn't
  the one holding the change.
  🔴 **Fixed bug: a failed disk write used to be reported as success.** `io.write_json` (shared by
  every `.codechroma/*` writer) has always swallowed its own `OSError` rather than raising, so a drag
  looked committed (the PATCH returned `ok: true`, the box stayed put) even when `canvas.json` was
  never actually written — the only symptom was the position silently reverting on the next load,
  with nothing logged that a user would ever see. `write_json`/`CanvasDoc.save` now return whether
  the write landed, and `routes/_canvas_write.py`'s `commit_canvas_batch` (shared by this route and
  every `POST /repos/{id}/recipes/{recipe}/run`) returns `{ok: false, errors: [{code:
  "write_failed", ...}]}` when it didn't — which the existing frontend rollback in
  `canvasDocStore.ts`'s `applyCanvasPositions` already knows how to handle, so a genuinely failed
  save now snaps the box back and reports an error immediately instead of lying until reload. Every
  other `write_json` caller keeps ignoring the return value on purpose — they're best-effort
  background writes, not on an interactive drag's report-success-to-the-user path. `layout_store.py`
  (the separate hierarchy-top-box position store, `boxes` strategy only — see its own bullet under
  Web — Stage 2) has the identical swallow-and-report-success shape and was **not** touched by this
  fix; it's a real, still-open gap, just not the one this fix targeted. Test:
  `test_bridge_canvas_route.py::test_patch_canvas_reports_failure_when_the_disk_write_does_not_land`.
- 🔴 **Superseded by the per-diagram storage split above.** `Workspace.canvas_path`/
  `WorkspaceWatchers.canvas_watcher` are now `Workspace.canvas_core_path`/`.diagrams_root` and
  `WorkspaceWatchers.canvas_core_watcher` (`FileWatcher` on `canvas-core.json`) plus
  `.diagram_projection_watchers` (one `FileWatcher` per built-in kind's own `projection.json` —
  deliberately siblings, never a `DirWatcher` over `diagrams_root` itself, which would nest around
  `custom_watcher`/`feature_plan_watcher`'s own dirs and race their startup mkdir). `on_canvas_change`
  still emits the same bare `{"type": "canvas"}`; `on_custom_change`/`on_feature_plan_change` now
  also emit it, since a custom/feature-plan kind's `projection.json` sits inside the dir those two
  already watch. All still follow the shape of every other per-workspace artifact/watcher pair
  (`plan_path`/`plan_watcher`, …) documented in [`graph-bridge-core.md`](graph-bridge-core.md). The
  watcher is a backstop for a write that skips the route; the route's own direct emit is what
  actually makes a `PATCH` feel instant on other connected canvases.

Tests: `tests/unit/test_apply_batch.py` (every op, every rejection code, the three caps, and that a
rejected batch leaves a saved file byte-identical), `tests/unit/test_bridge_canvas_route.py`
(`GET`/`PATCH` against the real app factory, plus the WS ping).

## Web — Stage 2 (the one renderer) — superseded by Stage 4 below

⚠ Historical: Stage 2 shipped `CanvasDocView` behind a `?canvas=doc` flag in `web/src/App.tsx`,
alongside (not instead of) the six old views. Stage 4 removed that flag and the six old views
entirely — `App.tsx` now always renders `RootCanvas`, which always renders `CanvasDocView`. The
bullets below describe what `canvas/doc/` looked like the moment it landed; see "Web — Stage 4" for
what changed since.

- `state/types.ts` — `CanvasDoc`/`CanvasElement`/`CanvasEdge`/`CanvasOp`/`CanvasBatch`/
  `CanvasBatchResult`/`CanvasPing`, the wire shapes verbatim (snake_case, matching the Python
  `model_dump()` output byte for byte — same convention as every other diagram payload type here).
- `engine-client/EngineClient.ts` — `getCanvas`/`patchCanvas`/`subscribeCanvas` added to the
  interface and `HttpEngineClient` (a new `patchJson` helper alongside `getJson`/`postJson`); `"canvas"`
  added to the WS `EventType` union. `stubEngineClient.ts`'s `CANVAS_STUB` is folded into
  `C1_CHANGES_STUB` (the "rest of the interface a test doesn't exercise" bucket already spread by
  every hand-built test client), so no existing test file needed touching. `delegatingEngineClient.ts`
  forwards all three. `mockBridge.ts` gets a real (if simplified) in-memory `apply_batch` port —
  `applyMockCanvasBatch` — covering every op but not every rejection code (the caps are enforced
  server-side only; see the Python section above).
- `canvas/doc/canvasDocStore.ts` — the document in memory (`Store`-based, workspace-scoped like every
  other canvas store) plus `useLoadCanvasDoc` (fetch + `subscribeCanvas` + the shared `subscribe`
  "changed" ping, mirroring `useDiagram`'s shape) and `patchCanvasDoc` (calls `patchCanvas`, refetches
  on success). The one optimistic edit is `moveElement` — a drag settles its own position locally
  before the PATCH round trip resolves; every other mutation just waits for the refetch.
  ⚠ Both refetch paths go through one shared `fetchAndApplyCanvasDoc`, gated by a module-level
  `latestCanvasFetchSeq` counter: a real network gives no ordering guarantee between requests, so a
  "changed" ping's refetch issued just before a drag's own commit can still resolve AFTER it — that
  slower, now-stale response applying last used to silently revert the just-moved box, reading as it
  "jumping back" a moment after you dropped it. Only the reply to the most recently *issued* fetch is
  ever applied, whichever order the responses land in. Tests: `canvasDocStore.test.ts`.
- `canvas/doc/layerStore.ts` — which layers are hidden; local UI state, never written to
  `canvas.json` itself. No `LayerStrip` toggle yet (that's Stage 4's rail wiring) — Stage 2 only
  needs the store to exist and be honored by `CanvasDocView`'s render loop.
- `canvas/doc/elementRules.ts` — **the per-kind element registry** (`BLOCK_RULES`), single source for
  both behavior and box styles, absorbing the retired `nodeStyles.tsx`: which component renders an
  element (`renderer`: hierarchy/note/group/node-box), which sidecar overlay feeds it (`overlay:
  "impact"`), whether its meta row shows the status chip (`statusChip: "impact"`), what click/Enter
  activate does (`activation: inspector | epic-brief`), and each node-box kind's `style`
  (`NodeStyleEntry`: box/row/header/title-row/name/desc/dragging class names, copied verbatim from the
  old per-view `*NodeBox`). The one place CanvasDocView's render dispatch, CanvasNodeBox's activate
  branch, useSidecar's overlay gate, nodeAccent's status chip, and CanvasNodeBox's style lookup read
  their per-kind deltas from — replacing the `render ===` comparisons and the parallel style registry
  those used to carry. Derived `NODE_STYLES` (`web/src/canvas/doc/elementRules.ts`) exposes just the
  node-box kinds to CanvasNodeBox, so the style strings live in one place; `elementRules.test.ts`
  asserts them (it now holds the old `nodeStyles.test.tsx` guards too, so a future rename of e.g.
  `.impact-node-box` in `styles.css` fails loudly instead of silently drifting).
  🔴 **`c1` is the one acknowledged gap, still open after Stage 4**: the deleted C1 view rendered
  through the shared hierarchy `Block` component (`.block.block-c1-system`), not a bespoke NodeBox, so
  this entry only approximates the outer shell — a C1 box on the one canvas visually differs from the
  old view's. C1's change-review/coverage-note/plan-badge chrome was ported afterward (see "C1's own
  chrome" below), and 023-unified-recipe-converter's `nodeAccent.tsx` closed the icon half of the gap
  (a C1 box's `meta.kind`/`meta.icon` now render via `C1BlockIcon`/`BrandIcon`, same glyphs as the old
  view) — what's left is layout/spacing parity with the old `Block` shell, not a functional gap.
- `canvas/doc/CanvasNodeBox.tsx` — the one box component for every styled kind above. `group` never
  reaches it (see `GroupFrame.tsx` below). A **solo** drag runs through the collision system
  (`collision/useCollisionAvoidance.ts`) — the box follows the cursor honestly but settles into the
  nearest free spot beside a neighbour instead of landing on top of it, previewing a `DropGhost`
  outline (`canvas/collision/DropGhost.tsx`) while the button is held, and registering itself as a
  participant/obstacle via `useCollisionParticipant`. Commit is unchanged: the (possibly corrected)
  landing is folded into `element.position` and written straight to `update_element` on drop. A
  **2+ multi-select group drag** stays a free `useGroupDrag` move with no solving — the same split
  as `useSelectionAwareDrag` on the hierarchy's own boxes. Note the canvas-doc box reuses this system
  but still commits position as the document's own absolute truth (no separate saved-layout store to
  reconcile against), so `useCollisionAvoidance`'s returned `resetOffset` is load-bearing here: the
  box zeroes its own hook offset at commit (see the double-count regression notes below). Click opens
  the shared `InspectorPanel` via `inspectorStore.open` when the element carries a `node_id`.
- `canvas/doc/NoteElement.tsx` — a free-text sticky note; click to edit, blur commits the label.
  New UI, no old-view equivalent.
- `canvas/doc/elementRect.ts` — `elementRect(element, sizes) -> Rect`: an element's on-screen
  left/top/width/height, `element.size` (or the shared `DEFAULT_ELEMENT_SIZE`, 300×72) centered on
  `position`, refined by `useMeasuredSizes`' real DOM box once one's measured. The one place this
  formula lives — `CanvasEdges` (arrow routing), `CanvasDocView`'s own `bounds` (page extent), and
  `GroupFrame` (member bounds, below) all call it instead of each carrying its own copy.
  🔴 `useMeasuredSizes` also snapshots each box's size **synchronously in its ref callback** (not
  just on the async ResizeObserver), so arrows/frames/page-bounds receive the box's true footprint
  before first paint instead of lagging a frame behind on the model default.
- `canvas/doc/GroupFrame.tsx` — a group's visual frame. `group_id` was always persisted on a
  member (`document.py`'s `Element.group_id`, set by `recipes.py`'s `build_batch_ops` off
  `RecipeNode.group`) but for a long stretch nothing *rendered* it: `render: "group"` elements went
  through the plain `CanvasNodeBox` like any other kind, at the fixed 220×72 default, regardless of
  how many/far-flung its members were — a floating label, not a container. `GroupFrame` replaces
  that: `CanvasDocView` dispatches `group` to it alongside `hierarchy`/`note` in the one box-mapping
  loop (no separate pass — `.canvas-group-frame`'s own `z-index: 0`, below every box's `1`, is what
  keeps it behind its members, not DOM order), resolves the group's members from a `group_id ->
  member ids` index (`memberIdsByGroup`, built off `renderableElements` so it stays stable across an
  unrelated drag) into `visibleDoc`'s *live-drag-adjusted* elements, and renders a background rect
  sized to their union bounding box (via `elementRect` above) plus fixed padding — recomputed every
  render, never persisted to `element.size`. Colored by `groupColor.ts`'s `groupColorIndex`, a hash
  of the group's own label into the same small fixed palette `nodeAccent.tsx`'s per-box `meta.group`
  accent uses, so a same-named group reads as the same color wherever it shows up. A group with zero
  visible members (e.g. every member's layer is collapsed) renders nothing. Purely decorative: no
  drag, click, or selection of its own — a group is still exclusively AI/recipe-authored (see Stage 3
  below), there's no manual "add group" UI action, so there's nothing yet for a frame's own
  interaction to do. Because members aren't spatially clustered by any layout step today, a frame can
  end up large and overlapping unrelated boxes on an existing diagram — re-running the diagram's
  generator (which re-triggers `recipes.py`'s reconciliation, not layout) doesn't fix that on its
  own; only `autoLayout.ts` clustering members together would. **054-diagram-flow-order** pulled the
  union-bounds math above out into `doc/boundingBox.ts#unionBoundsOf()` (member list + sizes ->
  `{left, top, right, bottom}` or `null` for none) so two siblings could reuse it without copying:
  `doc/LaneArea.tsx` and `doc/ConcurrencyIslandArea.tsx`, both rendered by `CanvasDocView` off
  `meta.lane`/leading-`meta.order`-digit buckets rather than a real `group_id` (see
  `docs/architecture/web-canvas-shell.md`'s Order/Lane/Concurrency island entry for the full
  layout+render story) — same borderless soft-tint treatment, each with its own color hash/palette so
  a box in a real group, a Lane, and an island at once still reads as three distinct colors.
- `canvas/doc/HierarchyElement.tsx` — wraps `resolveStrategy(element.meta.strategy).NodeRenderer` at
  the element's `(x, y)`, fetching the pinned node via `getNode` and caching it into
  `expansionStore` exactly like `RootCanvas`'s own root-node effect. **Deliberately injects no
  C1-style Inspector redirect** — `useNodeChrome`'s `opensInspector` and expand-in-place are mutually
  exclusive per row, so redirecting the root row to the Inspector would silently disable its own
  expand arrow. `Block.tsx`/`TreeNode.tsx`/`expansionState.ts` stay genuinely untouched, matching the
  plan's own Decision ("the tree just gains an (x, y)").
- `canvas/doc/CanvasEdges.tsx` — one relationship arrow per `doc.edges` entry, routed off each
  element's own *persisted* position/size via `connectors/diagramLayout.ts`'s `layoutDiagramEdges`/
  `rectFromBox` — unlike the old per-view Connections components, nothing here re-runs dagre; a
  box's position is the document's truth, this only obstacle-routes a line between wherever two
  already are. Reuses the custom-diagram arrowhead styling (`--custom` suffix) as a neutral default
  rather than inventing a new arrow color. `layoutDiagramEdges` carries each edge's authored `style`
  through, and `RelationshipEdge` renders `style.color` onto the stroke + label via `data-auth-color`
  + `currentColor` (`authoredStyle.ts`'s `authoredEdgeStyle`, same allow-list as the nodes) — the
  arrowhead itself stays uncoloured (a per-edge marker would need dynamic `<marker>`s, which
  `ArrowMarkerDefs` forbids for Safari). `layoutDiagramEdges` also carries each edge's authored
  `transport` token (`relations[].transport`) through to `EdgeLabel`, which renders it as a second,
  quieter line under the label's divider — the token survives end-to-end like `hero`: `RecipeEdge`
  (`canvas/recipes.py`) → `add_edge`/`update_edge` op → backend `Edge.transport`
  (`canvas/document.py`, applied in `apply_batch.py`) → `doc.edges` → `CanvasEdge.transport` →
  `RelationshipEdge` → `EdgeLabel`. The same chain carries an edge's caller provenance
  (`relations[].meta.origin`, `file:line`) through as `Edge.origin` → `CanvasEdge.origin` →
  `RelationshipEdge.origin`/`onOpenOrigin`; when set, `EdgeLabel` renders the caption as a clickable
  link that opens that code location in the code sidebar via `canvas/openOrigin.ts`. The `build_batch_ops`
  convergence rule treats `origin` like the other optional edge fields: a now-`None` value is never
  shipped, so an unrelated re-run can't clear it and `update_edge` converges.
- `canvas/doc/autoLayout.ts` — `layoutNewElements(doc, newIds)`: one dagre pass over just the new
  subgraph, then the whole result is shifted below the document's existing content. Its first real
  caller landed in Stage 4: `RecipeMenu.runRecipeAndLayout`.
  🔴 The "below existing content" offset used to be `Math.max(0, ...existing bottoms)`, treating a
  computed max ≤ 0 the same as "nothing on the canvas yet" — but a real, populated diagram sitting
  entirely above y=0 also computes ≤ 0, so its offset silently collapsed to 0 and the next diagram
  landed unshifted, on top of it. Fixed to check `existingElements.length === 0` instead of the
  clamped value; regression test: `autoLayout.test.ts`.
  🔴 Hard-layout layers (epics columns, sequence participants/messages) are never user-dragged, so a
  refresh re-runs their whole deterministic layout (`diagramCatalog.isHardLayoutLayer` — `isEpicsLayer`
  or `render === "sequence"`) instead of only the brand-new elements. Without this a sequence layer
  drawn before a `SEQUENCE_LAYOUT.colW` change keeps its stale narrow participant columns and never
  re-spreads to the current gap.
  Sequence geometry: `SEQUENCE_LAYOUT` (`colW` wider than `headW` so heads never touch; `rowH` is
  centre-to-centre message spacing; `headGap` pushes the first line below the participant heads; the
  gap below the last line is `DiagramFrame`'s own `PADDING.bottom` — never fatten a message's
  `size.h` to fake vertical margins, that pokes the outer rows up into the heads and pinches the
  bottom arrow). Because sequence positions are pure derivations of these constants yet persisted,
  `useReflowSequence` re-runs `layoutSequence` on mount for any sequence layer whose geometry has
  drifted, so a constant change reaches every reloaded diagram, not just freshly-drawn ones.
  Message `return`/`async` flags are read through `elementMeta.flagMeta` (truthiness-aware): the
  backend emits them as JSON booleans (`bool(...)` in `recipes.py`) while authored/mock files use a
  `"true"` string, and only a flag-read that accepts both survives either path — `stringMeta` would
  silently drop the boolean form.
- `canvas/doc/CanvasDocView.tsx` — the single view: iterates `doc.elements`, filters out hidden
  layers before mapping (so they don't mount, not just CSS-hide), dispatches `hierarchy` →
  `HierarchyElement`, `note` → `NoteElement`, `group` → `GroupFrame`, everything else →
  `CanvasNodeBox`, all in one loop. As of Stage 4 it also takes `rootNode`/`strategyName` props and seeds a
  `"hierarchy"` element the first time the document has none (see below) — the rail/breadcrumb/
  `InspectorPanel` chrome around it is inherited from `RootCanvas`, which now mounts it
  unconditionally.

Tests: `canvas/doc/elementRules.test.ts` (the style-parity + behavior registry guard, home of the old
`nodeStyles.test.tsx`), `canvas/doc/CanvasDocView.test.tsx`
(renders every element kind, a hidden layer doesn't mount, a drag writes one `update_element` op, a
group's frame appears/disappears with its members, a Lane area/Concurrency island appear and disappear
with their own `meta.lane`/shared-`order`-digit membership), `canvas/doc/GroupFrame.test.tsx` (the
bounding-box math itself: default-size union, real-measured-size/margin override, no-members renders
nothing), `canvas/doc/LaneArea.test.tsx`/`canvas/doc/ConcurrencyIslandArea.test.tsx` (same bounding-box
contract via the shared `unionBoundsOf()`, plus each area's own color hash),
`canvas/doc/HierarchyElement.test.tsx` (still expands lazily via the real `TreeNode`/`getChildren`).

### `DiagramFrame.tsx` — a whole diagram's own dashed, draggable frame

A dashed rectangle drawn around every visible element on one canvas layer (`c1`/`patterns`/`impact`/
`epics`/`custom/<id>`, i.e. `diagramCatalog.ts`'s `isDiagramLayer` set — the seeded hierarchy tree and
`apply_batch`'s `"default"` fallback layer never get one), labeled top-left with that layer's own
recipe name (`labelForDiagramLayer`). `CanvasDocView` buckets `renderableElements` by `element.layer`
into `memberIdsByLayer` (structural, like `memberIdsByGroup`) and renders one `DiagramFrame` per
bucket, rendered through the same shared `SoftAreaFrame` `GroupFrame`/`LaneArea`/
`ConcurrencyIslandArea` use (so the `unionBoundsOf()` bounding-box arithmetic lives in exactly one
place) — but it is deliberately its **own** component, not a fourth entry in that family: unlike them,
the frame is genuinely interactive, and folding a drag handle into a component whose whole contract is
"purely decorative, steals no pointer event" would break that contract for the other three.
`SoftAreaFrame`'s own `interactiveProps` (an optional pass-through onto its rendered `div`) is what lets
`DiagramFrame` be a real caller of the shared shape without making the other three interactive by
accident — they simply never pass it.

**The whole frame is the drag handle.** Dragging anywhere on its dashed border/background (wherever no
box already covers that spot — the frame sits at the same `z-index: 0` as the other three background
areas, below every box's `1`) moves every element on that layer together with one shared pointer
delta — the same no-collision-solving group move `CanvasNodeBox`'s own multi-select group drag already
does (`collision/useGroupDrag.ts`), just keyed by "shares this layer" (read fresh off the `members`
prop at drag-start) instead of a manual `selectionStore` selection; `getOffset` reads `dragOffsetStore`
imperatively rather than through a reactive `useLiveDragOffsets()` subscription, since it's only ever
consulted once, at drag-start — a reactive subscription here would re-render every *other* diagram's
frame on every pointer-move frame of any drag anywhere on the canvas. The commit path —
`canvasDocStore.ts`'s `commitCanvasPositions(engineClient, positions)` — is shared with
`CanvasNodeBox`'s own solo/group drag (pulled out of what used to be a `CanvasNodeBox`-local closure),
so a whole-diagram drag records one `"canvas"` `undoStore` entry and rolls back on a failed PATCH
exactly like a single box's drag does. `role="button"`/`tabIndex={0}`/a descriptive `aria-label` on the
frame make it discoverable to a keyboard/screen-reader user, even though the drag gesture itself, like
every other drag on this canvas, is still pointer-only.

🔴 **An aborted drag (the frame, or the box that started a group drag, unmounts mid-gesture — e.g.
another window/agent deletes the diagram or a box while it's being dragged) used to leave whichever
elements it had already touched rendering permanently offset.** `useDragOffset`'s own unmount cleanup
only detaches the document-level pointermove/pointerup listeners; it never calls `onEnd`, so
`dragOffsetStore.clear()` — normally only reached from a commit callback — never ran. `DiagramFrame` and
`CanvasNodeBox`'s group path now keep a `trackedIdsRef` of every id their own `onGroupPreview` has
pushed a live offset for (deleted from as `onGroupCommit` clears each one), and clear whatever's left of
it in a mount-lifetime `useEffect`'s unmount cleanup; `useCanvasElementDrag`'s solo path (`NoteElement`/
`HierarchyElement`) does the same for its own single id. A drag that commits normally is unaffected —
the ref is already empty by the time unmount happens.

Color comes from `diagramFrameColor.ts`'s `diagramFrameColorClass(layer)`: the four builtin recipe
kinds (keyed off `diagramCatalog.ts`'s own `BUILTIN_RECIPES`, not a second hardcoded name list) get
their own fixed hue (new `--impact`/`--epics` tokens alongside the existing `--c1`/`--patterns`,
styles.css's "Status / kind hues"); any other layer (a custom type's `custom/<id>`, or a one-off
skill-authored layer with no registered recipe) hashes into its own small indexed palette via
`groupColorIndex` — the same open-ended-label-set trick `GroupFrame` already uses, but with its own
genuinely distinct 6 hex values (verified against WCAG AA's 4.5:1 contrast floor on `--surface-0`),
matching how `LaneArea`/`ConcurrencyIslandArea` each already keep their own palette rather than
`GroupFrame`'s — so a box that lands in a real group and has its diagram's frame hash onto the same
index still reads as two distinguishable colors, not a coincidental match. Renders nothing once its
layer has no visible members (every element removed, or the whole layer collapsed via the Diagrams tab).

Tests: `canvas/doc/DiagramFrame.test.tsx` (bounding-box sizing/label, builtin vs. hashed coloring, the
group-drag commit + its `"canvas"` undo entry, the `role`/`tabIndex`/`aria-label` triple, the
abort-mid-drag cleanup), `canvas/doc/CanvasNodeBox.test.tsx`'s own abort-mid-drag case for the group
path, `canvas/doc/NoteElement.test.tsx`'s abort-mid-drag case for `useCanvasElementDrag`'s solo path,
`canvas/doc/CanvasDocView.test.tsx`'s two new cases (the frame appears with its layer's own label,
disappears once that layer is collapsed), `canvas/doc/diagramCatalog.test.ts`'s `isDiagramLayer` cases.

## Python — Stage 3 (recipes)

`canvas/recipes.py` is deliberately bridge-agnostic (no `Workspace`, no HTTP), the same discipline
`document.py`/`apply_batch.py` follow — it only knows how to turn an already-*resolved* payload (the
same shape `GET /repos/{id}/{kind}` already returns) into a flat `RecipeResult` (`RecipeNode`s +
`RecipeEdge`s keyed by a stable id from the source data, e.g. a C1 trail's `canvas_node_id` or a
pattern instance's own id) and how to reconcile that against a `CanvasDoc`'s existing elements/edges.
It does not fetch anything itself and does not trigger generation — the five skills' output contracts
(`c1.json`/`patterns.json`/`impact.json`/`custom/<id>.json`) are untouched; a recipe run only
re-projects whatever is already on disk.

- **023-unified-recipe-converter (Strategy over one canonical shape), then
  036-shared-diagram-style-catalog (the per-kind reshape itself retired).** The five generators used
  to each hand-roll their own node/edge-building walk (`c1_to_ops`/`patterns_to_ops`/`impact_to_ops`/
  `custom_to_ops`/`epics_to_ops`), which is why a `style` color authored on a C1 block never reached
  the canvas (`c1_to_ops` never read it) and `custom_to_ops` silently dropped relationship `kind`.
  023 replaced those with one thin `*_reshape(resolved) -> GraphShape` function per type
  (`c1_reshape`, `patterns_reshape`, `impact_reshape`/`custom_reshape` via `_flat_reshape`,
  `epics_reshape`) plus one shared `graph_to_ops(shape) -> RecipeResult`. 🔴 **`c1_reshape` /
  `patterns_reshape` / `impact_reshape` / `custom_reshape` no longer exist at all** —
  036-shared-diagram-style-catalog replaced all five — including `epics_reshape`, now that a skill
  writes `epics.json` in the same flat shape (a registered diagram kind, see below) — with **one**
  `reshape(resolved, render) -> GraphShape`, possible only because every diagram type now authors and
  resolves to the same flat `nodes[]`/`relations[]` shape
  (`bridge/diagram_resolver.py::resolve_diagram()` — see [`diagram-skills.md`](diagram-skills.md)). `GraphNode` lost the fields that existed only for c1's
  old nested tree — `aliases`/`dedup_id`/`children` are gone, since a flat, file-wide-unique id needs
  no alias list and no per-branch dedup — and now carries `style`/`meta` (with `kind`/`icon`/`status`/
  `group`/`parent` folded into `meta` for `nodeAccent.tsx` to read) for every type uniformly.
  `graph_to_ops` still always reads `relation.get("kind") or "uses"` with no per-type branch, and
  still resolves every diagram type's relations the same way — that part of 023's unification
  outlived the reshape functions themselves. See
  [`specs/023-unified-recipe-converter/contracts/graph-shape.md`](../../specs/023-unified-recipe-converter/contracts/graph-shape.md)
  for the original per-type contract table (historical: it predates 036's flattening).
- `Recipe` (`name`, `layer`, `render`) + `RECIPES` (`c1`/`patterns`/`impact`/`epics`) is the registry;
  each entry's `to_ops(resolved)` now calls `graph_to_ops(reshape(resolved, self.render))` — one
  reshape function parameterized by which `render` string its elements should carry, not four
  separate functions. `recipe_for(name)` additionally maps any `custom/<id>` to a shared,
  layer-parameterized `Recipe` (`render="custom"`), one layer per custom type — the `custom_reshape`
  special case is gone along with the function itself.
- `build_batch_ops(doc, layer, result)` is the ownership/reconciliation algorithm: it indexes `doc`'s
  existing elements in `layer` with `created_by == "ai"` by their `meta["recipe_key"]` (the field every
  AI-written element carries, set to the `RecipeNode.key` that produced it). A `result` node whose key
  matches one of those emits `update_element` (content fields only — `position`/`size` are never in
  the patch, so a drag survives every re-run); an unmatched key emits `add_element`; an existing
  AI element whose key the fresh `result` no longer has emits `delete_element`. A `created_by: "user"`
  element is invisible to this index, so it is never touched, added twice, or deleted, no matter what
  the recipe re-runs to. Groups (`RecipeNode.group`) get the same treatment one level up, via a
  synthetic `__group__::<name>` key. Edges reconcile by their **endpoint pair** rather than a key of
  their own — `Edge` carries no `created_by` (see the plan's Risks section for the gap this leaves:
  a user-drawn arrow between two AI elements is indistinguishable from a recipe-drawn one, and is
  dropped if the fresh result doesn't repeat it). `add_element`/`update_element` ops also carry a
  `"style"` key, but only when `RecipeNode.style is not None` — a `None` style is never emitted, so an
  unrelated regenerate can never clear a highlight manually applied via the `highlight-process` skill
  (`apply_batch.py`'s `update_element` replaces `style` wholesale, same discipline already proven for
  `position`).
- `run_recipe(doc, name, resolved)` is the one call site: `recipe_for(name).to_ops(resolved)` then
  `build_batch_ops`. Returns a plain ops list — the caller still runs it through `apply_batch` itself,
  so a bad op still rejects the whole batch exactly like a hand-authored `PATCH`.
- `bridge/routes/recipes.py` — `POST /repos/{repo_id}/recipes/{recipe:path}/run` (the `:path`
  converter is what lets `recipe` be `custom/<id>`, a two-segment string). `_resolved_for` fetches the
  payload for *every* kind, epics included, through `routes/diagrams.py`'s `resolve_diagram(ws, name)`
  (which 404s on an unknown kind). This is true since `epics` became a registered diagram kind — a
  skill writes `epics.json` and the recipe re-projects it — no more `epics_index(ws.root)` special
  case. The commit path (`CanvasDoc.load` → `apply_batch` → save + `ws.emit`) is shared with
  `PATCH /repos/{id}/canvas` via the new `routes/_canvas_write.commit_canvas_batch` — both routes now
  return the exact same `{ok, batch_id, id_map, affected}`/`{ok: false, errors}` shape.
- Both gaps above are closed in Stage 4: `RecipeMenu` is the rail button that starts a run, and its
  `runRecipeAndLayout` is what finally calls `autoLayout.layoutNewElements` for the ids a run's own
  `id_map` names as new.

Tests: `tests/unit/test_recipes.py` (the one shared `reshape()`/`graph_to_ops` pair, `style`/`kind`/
`icon`/`description` passthrough, plus `build_batch_ops`'s reconciliation: add/update/delete,
position preservation, user-element immunity, edge reconciliation, the conditional `"style"` key),
`tests/unit/test_recipe_routes.py` (the route against the real app factory: 404 on an unknown recipe,
an end-to-end impact run, a second run keeping a moved element's position, a second run dropping a
node the resolved slice no longer has).

## Web — Stage 4 (flip the default, delete the six views)

`RootCanvas.tsx` no longer has a `view` state, a `CanvasView` union, or `diagramViews.tsx`'s registry
— it always renders `CanvasDocView` inside its `CanvasViewport`, passing `rootNode` and the resolved
`strategy.id`. Every overlay that used to be gated on `isHierarchy` (`ConnectionsOverlay`,
`PlanConnectionsOverlay`, `ChangeConnectionsOverlay`, `TraceFlowOverlay`, `DeletedDiffOverlay`,
`TraceControls`) is unconditional now, since the hierarchy is always potentially present as a canvas
element rather than one of several mutually exclusive views. `UndoManager`'s `activeKind` was
hardcoded `"hierarchy"` at this stage (widened to a `kinds` list including `"canvas"` later — see
the "Group-drag jump / click-to-deselect / undo fixes" section below). `useDiffToggle`'s
`isOverlayView`/`isC1View` are hardcoded `false` at the
call site — the hook itself is untouched, its old C1/Patterns branches are just permanently
unreachable now.

🔴 **The plan's own "Web — deleted" list (see the plan doc) was wrong about several files being
purely view-local — verified before deleting anything, by grepping every real (non-comment) importer
of each candidate:**

- **`c1ChangesStore.ts`/`c1PlanStore.ts` are core hierarchy chrome, not C1-view-only, and were kept.**
  `useNodeChrome.ts`/`nodeChrome.tsx` (called by every `Block`/`TreeNode` row, hierarchy included) read
  them unconditionally for diff/plan badges. They key off synthetic C1 ids (`c1-system`, `c1-sub::…`)
  that never match a real hierarchy `node_id`, so on a plain hierarchy row they're inert no-ops — not
  "currently unused," genuinely harmless. With `C1View.tsx` (their only writer) gone, they're now
  permanently-empty stores; not deleted, since removing them would mean also editing the row-chrome
  code path that reads them, for no behavior change.
- **`C1InspectorContext.tsx` and `C1PlanPanel.tsx` were kept** for the same reason — real imports in
  `useNodeChrome.ts`/`nodeChrome.tsx`.
- **`ConnectionsOverlay.tsx` and `PlanConnectionsOverlay.tsx`/`ChangeConnectionsOverlay` were kept**,
  contrary to the plan's deletion list — both measure via `document.querySelectorAll` against the
  shared pan/zoom SVG coordinate space, so they work unchanged mounted anywhere inside one
  `CanvasViewport`, regardless of whether the hierarchy renders via the old direct
  `<strategy.NodeRenderer>` or the new `HierarchyElement`. Only `C1PlanConnectionsOverlay` (C1-only,
  sourced from `c1PlanStore`) was deleted, out of `PlanConnectionsOverlay.tsx`.
- **`UndoManager.tsx`/`state/undoStore.ts`/`useSavedLayoutAndFitLoop.ts` were kept** — all three are
  load-bearing for `strategies/boxes/TopLevelChildren.tsx`'s own top-level box drag/undo, a real
  hierarchy feature the plan's list didn't account for.
- **`state/epicsFocusStore.ts` and `state/customDiagramStore.ts` really were safe to delete** (the
  plan got these right) — their only real importers were the views dying alongside them.
- 🔴 **Superseded**: every `c1PlanStore`/`C1PlanPanel`/`PlanConnectionsOverlay` mention in the four
  bullets above describes a decision made at Stage 4 (016) — those files were later deleted outright
  (not kept as dead weight) when the separate old Plan overlay (`codechroma-plan` skill,
  `.codechroma/plan.json`) was retired; see `change-cards.md`. `PlanConnectionsOverlay.tsx` itself was
  then renamed to `ChangeConnectionsOverlay.tsx`, since only that one export survived. `c1ChangesStore.ts`,
  `C1InspectorContext.tsx` and `ConnectionsOverlay.tsx` remain exactly as this section describes.
- **`canvas/epics/brief/` survived, `EpicsView.tsx`'s box-graph half didn't.** Deleting
  `EpicsView.tsx`/`EpicBoxes.tsx`/`EpicConnections.tsx`/`epicsGraph.ts`/`epicsLayout.ts` would have
  silently dropped the AI epic-brief feature too (`EpicBriefView` was only ever mounted from
  `EpicsView.tsx`) — the plan never mentions this. `EpicBriefView` turned out to need only `itemId` +
  a fresh `new EpicsDiagramClient(engineClient)`, so it's now reachable via a new standalone
  `canvas/doc/EpicBriefPanel.tsx` (`epicBriefPanelStore.open(itemId)`), wired from `CanvasNodeBox`'s
  click handler for `render === "epic"` (using `element.meta.recipe_key`, the epic item id every
  `epics_reshape`-written element already carries). `epicsGraph.ts`'s pure id/label helpers
  (`stageNodeId`/`sectionNodeId`/`toggleExpanded`/`stageLabel`/`stageHeader`/`sectionHeader`), which
  `SpecsFrame.tsx` (inside `brief/`) also needs, moved to a new `canvas/epics/specStageHelpers.ts`
  rather than dying with the box-graph half that owned the rest of that file.

### New: `canvas/doc/RecipeMenu.tsx` — later shrunk to `DrawDiagramButton.tsx`

🔴 **This section originally described a dropdown that both listed every diagram and opened a
custom-type wizard.** The diagram-management unification retired both jobs off this component:
listing/adding/removing/deleting a diagram moved to `AgentRail`'s Diagrams tab (its own doc coverage
is in [`parallel-agents.md`](parallel-agents.md)), and the custom-type wizard is gone outright (see
[`custom-diagrams.md`](custom-diagrams.md)). What's below is kept for the *why* behind mechanisms
that are still live, just relocated — `runRecipeAndLayout`/`removeLayerAndRefresh`/
`deleteDiagramAndRefresh` now live in `canvas/doc/diagramCatalog.ts` (shared by the button and the
Diagrams tab), and `canvas/doc/DrawDiagramButton.tsx` is the file that replaces `RecipeMenu.tsx`.

The rail's "Add" control originally replaced the five per-kind toggle buttons — mirroring
`CustomDiagramMenu.tsx`'s trigger+list disclosure shape (which it also replaced). It listed the four
built-in recipes (`c1`/`patterns`/`impact`/`epics`, hardcoded name+label pairs — there is no
`GET /repos/{id}/recipes` listing route, since the four names are fixed) plus every saved custom type
(`engineClient.listDiagramTypes()`) plus a "New custom type…" item that opened the wizard. Picking a
listed entry called `runRecipeAndLayout(engineClient, name)`: `POST`s the recipe, `getCanvas()`s the
result into `canvasDocStore`, then folds `autoLayout.layoutNewElements`'s positions for the batch's
own `id_map` values into one more `update_element` batch — new boxes never land on top of old ones.
This part is unchanged today, just called from `AgentRail`'s Diagrams tab's expand-refresh instead of
a dropdown item (the "Available to add" section that used to live there was removed — a soft-removed
diagram is redrawn via Draw…, see `AgentRail`'s docstring). 🔵
`getRecipeStatus`/`cancelRecipe`/`getRecipeOutput` from the plan's original EngineClient-collapse list
were never added: a recipe run is a synchronous re-projection of an already-generated artifact (see
the Python section above), not a background skill job, so there is nothing for those three methods to
poll/cancel/stream.

Three later additions, all covered in [`diagram-skills.md`](diagram-skills.md), still live in
`DrawDiagramButton.tsx` (it still needs readiness to word its task prompt and to drive auto-add):

- **It subscribes.** A diagram that finished while the app was in the background used to stay "not
  ready" until reopened. One `refetchStatus` is shared by the mount effect and a `subscribeDiagram`
  subscription per kind (`diagramCatalog.ts`'s `WATCHED_DIAGRAM_EVENT_KINDS`). ⚠ Custom sends one
  coarse `{"type": "custom"}` ping (never `custom/<id>`), so that branch also refetches
  `listDiagramTypes()`; `DiagramEventKind` carries the bare `"custom"` literal for it.
- **It auto-adds any kind that becomes ready.** When a kind flips not-ready → ready and isn't yet on
  the canvas, `refetchStatus` fires `runRecipeAndLayout` for it — no pending-request set (`doc/
  pendingDrawRequests.ts` was removed), so a diagram written by *any* path appears: the "Draw…"
  button, a terminal/agent-window run, another agent on the workspace. It stays safe because pings are
  scoped per-workspace and the add only fires on a ready transition for a kind `!placed.has(kind)`, so
  an unrelated artifact change never redraws the canvas.
- **It records what could not be drawn.** `runRecipeAndLayout` writes the run's `diagnostics` into
  `state/diagramHealthStore.ts`, which `doc/DiagramHealthNote.tsx` renders beside `C1CoverageNote`;
  `removeLayerAndRefresh` clears that layer's entry. Soft by design — the batch has already
  committed by then, so the note can never block a render.

**Add/remove is `AgentRail`'s Diagrams tab now, not a menu toggle.** `removeLayerAndRefresh`
`delete_element`s every element in a layer, plus any edge tagged with the layer whose *both*
endpoints survive (an edge with either endpoint inside the deleted set is already dropped by
`apply_batch.py`'s own cascade, so re-deleting it would fail as `unknown_target`). Always sends
`confirm_mass_delete: true` — the click that reaches this function already is the confirmation, and a
real diagram routinely exceeds the unconfirmed mass-delete guard (`MASS_DELETE_GUARD = 20`). The
recipe-reconcile route (`routes/recipes.py`'s `POST .../run`) likewise always confirms: its
`build_batch_ops` deletes only AI-owned elements in its own layer, so a refresh that must swap out
many stale boxes/edges to rebuild a large layer is a deliberate replacement, not a suspicious mass
delete — without this a big real diagram was falsely blocked on refresh. No
`window.confirm` either (tried once, dropped — a browser confirm dialog on a normal in-app action read
as broken/intrusive, not protective); a soft remove isn't undoable — this batch delete still doesn't
write to `undoStore`, unlike a `CanvasNodeBox` drag, which does now (see the "Group-drag jump /
click-to-deselect / undo fixes" section below).

🔴 **Fixed bug: a dragged position was lost the moment its diagram was removed.** A canvas-doc
element's position lives only on the element itself (see Stage 2's `CanvasNodeBox.tsx` bullet above —
deliberately no separate saved-layout store), so once `removeLayerAndRefresh` `delete_element`s a
layer, that position exists nowhere. Picking the same recipe again re-projects fresh elements from
disk and always ran them through `autoLayout.ts`'s dagre pass, so a diagram removed and immediately
re-added silently landed back at its auto-computed layout, not wherever the user had last dragged it
— read by a user as "my layout doesn't save." `canvas/doc/layerPositionCache.ts` closes the gap:
`removeLayerAndRefresh` snapshots every element's position keyed by its own `meta.recipe_key` (the
same key `build_batch_ops` reconciles by) right before deleting, and `runRecipeAndLayout` checks that
cache for each freshly-added element before handing it to `layoutNewElements` — a hit restores the old
spot; only an unmatched (genuinely new) element still gets a fresh dagre position. Module-level and
consumed-on-read, same discipline as the canvas-doc stores; it survives only within the page's own
lifetime; a full reload still re-projects at a fresh layout, same as `scripts/migrate_canvas.py`'s
still-deferred gap. Test: `canvas/doc/diagramCatalog.test.ts`.

⚠ **Removed:** `canvas/doc/LayerStrip.tsx` (the per-layer hide/show chip strip) and its
`layerStore.ts`/`layerMeta.ts` support, cut once a real remove action existed — a chip that could only
ever dim a layer, never delete it, was confusing next to an action that actually removes one.

**Collapse/expand, a real toggle, unaffected by the button's shrink:** a diagram-level collapse/expand
landed as AgentRail's "Diagrams" tab (see [`parallel-agents.md`](parallel-agents.md)), backed by
`canvas/doc/collapsedLayersStore.ts`. `CanvasDocView` filters `doc.elements`/`doc.edges` before
rendering by a workspace-scoped client store keyed on `Element.layer`, and never deletes anything:
`renderableElements` (built once per render from `doc.elements` minus whatever `useCollapsedLayers()`
reports) feeds both the element map and `visibleDoc`'s edge list, so a collapsed diagram's edges
disappear for free via the same "edge whose endpoint is missing" filter that already existed for a
partial batch. The Diagrams tab's own remove/delete rows are the only way to actually delete a
diagram's elements/edges from `CanvasDoc`. 🔵 The filter is layer-name-agnostic, so it also works,
unmodified, on the seeded root hierarchy element's own `"hierarchy"` layer — `RootCanvas.tsx`'s rail
button that used to switch the code-popup/inline mode (`code-view-mode-button`) was repurposed into a
`collapsedLayersStore.toggle("hierarchy")` call (`RailIcon name="hierarchy"`), so the whole code tree
can be hidden/shown the same non-destructive way a diagram layer can, even though `"hierarchy"` stays
out of `isDiagramLayer`'s allow-list and so never appears in AgentRail's Diagrams tab.

**Readiness gating + "Draw" handoff.** Picking `c1`/`patterns`/`impact`/a custom type used to be a
dead click when that type's artifact didn't exist yet on disk (`run_recipe` re-projects an
already-generated file; with none, it just returns an empty batch — no error, nothing appears), so
the menu used to fetch `GET /repos/{id}/diagrams/status` (`bridge/routes/diagrams.py::get_diagrams_status`)
alongside `listDiagramTypes()` and only list an entry once ready. 🔴 **The unification changed what
that gate does, not how it works.** `diagramCatalog.ts`'s `computeReadyDiagrams(status, customTypes,
activeLayers)` is the one shared split `DrawDiagramButton` reads (to word its task prompt) — same
`isReady` fails-open rule as before: `status === null` means "the route hasn't answered, or couldn't", treated as ready rather
than hidden, since erasing every generated diagram from view on one failed fetch (with no error shown
and no way back) was worse than briefly over-showing. The payload is a flat
`Record<string, {ready: boolean; fingerprint?: string | null}>` keyed by the **same name the canvas
uses for that diagram's layer** — `"c1"`, `"custom/<id>"` — so both readiness lookups are one
`status?.[name]` and neither side hardcodes a kind list. The route builds it by iterating `DIAGRAMS`,
calling each kind's own `skill_agents[kind].has_artifact(...)` (the same validated-JSON check
`only_if_missing` uses, so a corrupted or half-written artifact reads as not-ready, not ready), then
adds one `custom/<id>` entry per `library.list_types()` via `bool(ws.load_diagram(...))`.
`fingerprint` is `_content_fingerprint`'s `hash_lines` hash of the diagram's raw JSON (`None` when
there's no diagram) — `DrawDiagramButton`'s `refetchStatus` diffs it against the previous fetch to
catch an in-place edit of a diagram already placed on the canvas and re-runs that kind's recipe, no
pending-request gate needed (see `diagram-skills.md`'s "Delivery" section). `epics` has no readiness
concept at all (file-derived, never AI-generated); `BuiltinRecipe.generated` marks that, and it always
counts as ready.

`DrawDiagramButton` is now always clickable, not conditionally shown — clicking it calls `attachAgent`
with a `task` string naming whatever's still missing (or, once nothing is, a generic "ask what to
draw" prompt — see `buildDrawDiagramTask`), which `launchAgent` forwards to
`AgentClient.create(..., contextKind: "task")` instead of the ordinary acknowledge-only `context` —
see `parallel-agents.md`'s "Current-view context on launch" for the `context_kind` split this reuses.
Unlike `"view"`, that `task` text is never typed into the PTY after boot: `post_agent_start` bakes it
straight into the `claude` process's own argv (`terminal/agents.py::agent_cli(..., initial_prompt=...)`),
so the agent's window opens already showing its question ("which kind would you like...") instead of
an idle prompt waiting on injection — the user never has to already know a skill name or the right
phrasing. Tests: `tests/unit/test_bridge_diagrams_status_route.py` (empty repo, a written `c1.json`, a
saved custom type's own instance file), `web/src/canvas/doc/DrawDiagramButton.test.tsx`'s readiness
cases, `web/src/agents/{launchAgent,attachAgent}.test.ts` (`task` takes priority over `context`,
tagged `context_kind: "task"`).

### New: `canvas/doc/epicBriefPanelStore.ts` + `EpicBriefPanel.tsx`

A `Store`-based `{itemId: string | null}` — `open(itemId)`/`close()` — plus a panel component reusing
the `.inspector-panel` CSS shell (header/close button/body) around `EpicBriefView`. Mounted
unconditionally in `RootCanvas` beside `InspectorPanel`; renders `null` while closed, so it needs no
latched-mount handling the way the terminal/wizard panels do (nothing in it needs to survive
close/reopen).

### The seeded root block — one invariant, enforced server-side

🔴 **A canvas document always holds a `render: "hierarchy"` root block, and the server is what
guarantees it.** `canvas/document.py`'s `ensure_seeded(path, node_id)` writes a document containing
just that block (`id: "seed-hierarchy"`, `created_by: "user"` so no recipe re-run reconciles it away)
whenever the file is missing or parses to an empty document. Two callers:

| Caller | Covers |
|---|---|
| `Workspace.create` (skipped when `read_only`) | main and every agent worktree, at bring-up |
| `pr_import_seed.seed_canvas_doc` | a PR, after copying main's `canvas.json` — main may have none |
| `PrManager.reconcile()` | the same `seed_canvas_doc`, backfilling a PR imported before seeding existed |

🔴 **`ensure_seeded` never raises, and that is load-bearing** — every caller above sits on a startup
path, so one bad file must not take a whole workspace (or the bridge) down with it. `_is_seedable`
is the gate, and it refuses three kinds of document rather than clobbering data the user might still
recover:

| On disk | Outcome | Why |
|---|---|---|
| missing | seeded | the ordinary fresh-repo case |
| `{}` | **seeded** | a legitimately empty document — ⚠ this is why the check uses `load_json_or_none`, not `load_json`: the latter reports a literal `{}` as falsy, identically to a parse failure, so the old check left such a canvas blank forever |
| unparseable, or valid JSON that isn't an object | left alone | `CanvasDoc.load` reports a malformed file as an *empty* document, so seeding would overwrite it |
| parseable, but a shape `CanvasDoc` rejects | left alone | 🔴 this used to raise `ValidationError` straight out of `model_validate`; neither caller catches anything but `OSError`, so one such file crashed `Workspace.create` and `PrManager.reconcile()` — i.e. bridge startup |

⚠ It returns `path.is_file()`, not a bare `True`: `io.write_json` swallows its own `OSError`, so the
file actually landing is the only proof a seed happened.

Everything else that used to enforce this is gone. The invariant previously lived in **four** places:
the PR-import copy, the `reconcile()` backfill, a `read_only` branch in `get_canvas` that
synthesized the element *on the read path* (giving the client an id that existed in no document — so
any drag, layout save or `removeLayerAndRefresh("hierarchy")` against it failed), and a
`useSeedHierarchyElement` React effect that `PATCH`ed one in behind three refs, a bounded retry loop
and a client-identity reset effect. `get_canvas` is now two lines and has no `read_only` case;
`CanvasDocView` seeds nothing, lost its `rootNode` prop entirely, and renders whatever it is served.

**The strategy selector is gone.** The hierarchy always renders as nested boxes (`strategies/boxes/
Block.tsx`, via `BoxesRenderer`); the former `?strategy=` / `VITE_CANVAS_STRATEGY` switch and the
`strategyName` threading through `CanvasDocView` were removed (see `strategies/types.ts` /
`web-canvas-shell.md`).

Tests: `tests/unit/test_canvas_document_seed.py` (every row of the table above),
`tests/unit/test_bridge_canvas_route.py` (a fresh repo already serves the block; it is real on
disk, not synthesized per request; a read-only workspace serves what the import wrote),
`tests/unit/test_pr_import_seed.py` (the canvas is seeded even when main has no diagrams at all; an
existing PR canvas.json is never overwritten; `seed_canvas_doc` alone touches nothing else).
`mockBridge.ts` and `RootCanvas.test.tsx` both start
from `SEEDED_CANVAS_DOC` (`state/types.ts`) so they serve what the bridge serves.

Removed CanvasDocView's own `<CanvasViewport>` wrapper from Stage 2 — `RootCanvas` now provides the
one `CanvasViewport` (with the `viewportRef` the rest of its chrome needs), so `CanvasDocView` mounted
inside a second, nested one would have double-wrapped the pan/zoom transform.

### `web/src/engine-client/` — `runRecipe`, and what *didn't* collapse

Added `runRecipe(recipe: string): Promise<CanvasBatchResult>` (`POST /recipes/{recipe}/run`) to
`EngineClient`/`HttpEngineClient`/`DelegatingEngineClient`/`stubEngineClient.ts`'s `CANVAS_STUB`.
`mockBridge.ts` got a real (if simplified) implementation: `c1RecipeResult`/`patternsRecipeResult`/
`impactRecipeResult`/`customRecipeResult`/`epicsRecipeResult` (one JS port of each Python `to_ops`
adapter, reading the existing `MOCK_C1`/`MOCK_PATTERNS`/`MOCK_EPICS_INDEX`/`mockCustomDiagrams`
fixtures) plus `buildMockRecipeOps` (a JS port of `build_batch_ops`'s reconciliation rule, keyed the
same way by `meta.recipe_key`), so `npm run dev`'s default mock mode can demo Draw…/AgentRail's
Diagrams tab for real, including a stable second run.

🔴 **The plan's "~20 diagram methods collapse to 8" claim does not hold as literally written — verified
by grepping every real caller before removing anything, and nothing was removed in Stage 4**:
`getDiagramLayout`/`saveDiagramLayout` are kind-parametrized (`LayoutKind`, not `DiagramFetchKind`) and
`useSavedLayoutAndFitLoop.ts` calls them directly for `kind: "hierarchy"` — collapsing them away would
break the hierarchy's own box-drag persistence, not just diagram views. `getEpicsItem`/
`resolveEpicRef`/`generateEpicBrief`/`getEpicBrief`/`cancelEpicBrief`/`getEpicBriefOutput` stay for
`EpicBriefPanel`. `getC1Plan` stays because `usePlanToggle.ts` (kept, untouched) still calls it.
`getDiagramStyles`/`listDiagramTypes`/`getDiagramType`/`saveDiagramType`/`deleteDiagramType` stayed at
Stage 4 for the type-authoring library, which the plan's own Decision table said survives — true then,
but the five `*DiagramTypeInterview*` methods and `DiagramTypeWizardPanel` were later deleted outright
in the diagram-management unification (see [`custom-diagrams.md`](custom-diagrams.md)'s "interview
(retired)" note); only the library CRUD methods above are still live. The methods that really are now dead code with no
caller (`getDiagram`, `subscribeDiagram`, `generateDiagram`, `cancelDiagram`, `getDiagramStatus`,
`subscribeDiagramStatus`, `getDiagramOutput`, `subscribeDiagramOutput`, `getC1Changes`,
`getImpactReview`, `getImpactReviewPath`, `getImpactFeatures`, `subscribeImpactReview`,
`getC1Coverage`) were deliberately **left in place** rather than trimmed: the backend routes they call
are untouched (routes/diagrams.py etc. deletion is Stage 6), so they're harmless, and trimming ~14
interface methods across four client files purely for cosmetic cleanup — with no backend counterpart
change to force it — was judged not worth the risk in the same pass as the rest of Stage 4. Leave this
for Stage 6, alongside the backend route deletion that actually makes them unreachable.

### Deleted (verified zero real remaining importers before each removal)

`canvas/patterns/`, `canvas/impact/`, `canvas/custom/` (whole directories); `canvas/C1View.tsx`,
`C1ChangeSummary.tsx`, `C1CoverageNote.tsx`, `C1InternalConnections.tsx` (+ their `.test.tsx`);
`canvas/diagramViews.tsx`, `canvas/CustomDiagramMenu.tsx`; `canvas/epics/EpicBoxes.tsx`,
`EpicConnections.tsx`, `EpicsView.tsx` (+ test), `epicsGraph.ts`, `epicsLayout.ts`;
`state/useC1Diagram.ts`, `usePatternsDiagram.ts` (+ tests), `useImpact.ts`, `useDiagram.ts`,
`useC1Generation.ts`, `customDiagramStore.ts`, `epicsFocusStore.ts`,
`impactFocusStore.ts`; e2e specs `c1-view`, `c1-changes`, `custom-diagram`, `epics-view`,
`patterns-view`.

⚠ **`useC1ChangeReview.ts` (+ test) was later restored, unchanged, once the C1 change-review chrome
was ported onto the one canvas** — see the "C1 chrome onto the one canvas" section below. It was
correctly identified as C1-view-only at the time this list was written; the porting work it enabled
came after Stage 4, not as part of it.

⚠ The E2E specs that previously asserted hierarchy-box multi-select and collision were superseded
when `RootCanvas` began collapsing the hierarchy layer on load and the Project Tree became the
hierarchy's visible surface. `e2e/multi-select.spec.ts` now verifies modifier-click behavior in the
Project Tree; `e2e/block-collision.spec.ts` verifies that expanding the tree does not add hierarchy
boxes to the diagrams canvas. Those tests no longer claim coverage of the hidden
`TopLevelChildren` drag surface; its mechanics remain covered by focused component/unit tests. The
second top-level fixture node (`folder::billing-lite`) remains part of the mock graph.
🔴 Adding that second top-level fixture node exposed a real, narrow bug in `RootCanvas.tsx`'s own
initial camera-centering effect: with `?autoexpand=off` (every e2e spec), a **single**
`requestAnimationFrame(() => centerOnNode(id))` call raced `TopLevelChildren`'s async
`useMeasuredSizes` (a `ResizeObserver`, not synced to rAF) — with only one top-level box this settled
instantly (a lone box's grid position is `(0, 0)`, no measurement dependency), but a second box's x
position depends on the first's measured width, so the root's true rect could still move for a frame
or two after that one call. Fixed by retrying `centerOnNode` a few more frames, but **only** for the
`boxes` strategy specifically (`strategy.id === "boxes"`) — an early version retried unconditionally
and, even bounded to just 4 frames, that was long enough to occasionally clobber a real camera action
a fast test gesture triggered in the same window (confirmed via `change-cards.spec.ts`/
`pr-review.spec.ts` regressing when a PR-workspace switch remounted this effect immediately before
toggling Diff). The `tree` strategy (the app default, used by most e2e specs including these two) has
no such measurement dependency and keeps the original single call, unchanged.

### Not done in Stage 4 (deliberately, not oversights)

- **`scripts/migrate_canvas.py` was not written.** The plan's Stage 4 line calls for it, but every
  recipe already re-projects straight from the same `.codechroma/{kind}.json` files a migration would
  read from — running the matching recipe once gets an old repo's authored content onto the canvas
  with no separate script. What a migration would add on top: preserving old `.codechroma/
  {kind}-layout.json` drag positions instead of a fresh dagre pass. Deferred as a nice-to-have, not
  required for the feature to work.
- **C1's own change-review/coverage-note/plan-badge chrome was not folded into the one canvas** — see
  the 🔴 note under Stage 2's `elementRules.ts` bullet above and `c1-diagram.md`'s own banner. The plan's
  Risks section already called this out as large enough to be its own sub-stage.
- **The Impact review's per-box severity highlight** was later ported onto `CanvasNodeBox` (037
  US2), then removed again along with the rest of the judgmental review sidecar (038 follow-up) — an
  Impact box on the one canvas has no problem highlighting today.

Tests: `RootCanvas.test.tsx`'s "RootCanvas render strategy" describe block now exercises the seed
path — its `client()` helper carries a real (not stubbed) in-memory `getCanvas`/`patchCanvas` so the
hierarchy actually round-trips through a seeded element before `tree-node`/`block` testids appear, the
same way the real bridge does. The old "RootCanvas view switching" describe block (view-switch
characterization tests) was deleted outright — the behavior it characterized no longer exists.
`canvas/doc/CanvasDocView.test.tsx`'s three cases now pass `rootNode` explicitly. Full project `tsc
-b`, `eslint`, and `vitest run` (877 tests, 107 files) all pass after these changes.

## Stage 5 (the chat) — Removed

The free-text "canvas chat" panel described in this section (a chat message became a batch of ops
through `apply_batch`, the same seam every other canvas write uses) shipped, then was retired end to
end by 008-unify-agent-diagrams: `bridge/routes/canvas_chat.py`, `bridge/canvas_chat_agent.py`,
`prompts/canvas_chat_agent.yaml`, `.claude/skills/codechroma-canvas/`,
`web/src/canvas/ChatPanel.tsx`/`chatPanelStore.ts`, `web/src/state/useCanvasChat.ts`, the
`sendChatMessage`/`getChatState`/`cancelChatMessage` `EngineClient` methods, and the `ChatTurn`/
`CanvasChatState` types are all deleted; `RailIcon` lost its `"chat"` glyph.

Its replacement is the diagram-agent-task flow already documented in
[`parallel-agents.md`](parallel-agents.md)'s "Current-view context on launch" section:
`DrawDiagramButton.tsx`'s "Draw…" button opens an agent via `attachAgent(agentClient, null,
buildDrawDiagramTask(...))`, whose `context_kind: "task"` first message states what's missing and
asks what to draw — one natural-language diagram entry point instead of two competing ones. See
[`c1-diagram.md`](c1-diagram.md)/[`patterns-diagram.md`](patterns-diagram.md) for what that agent
actually produces once it has an answer.

⚠ `missingLabels` (every not-yet-drawn built-in plus every not-yet-drawn custom type) has no upper
bound, but a multiple-choice tool call caps out at 4 options — offering more than that as one such
call fails validation, which the user only ever sees as a bare "Invalid tool parameters" with no
diagram drawn. `buildDrawDiagramTask` (exported from `DrawDiagramButton.tsx` for this reason) appends
an explicit "ask in plain text, not a multiple-choice tool call" hint once `missingLabels.length > 4`,
so a project with 2+ saved custom types alongside missing built-ins can't cross that cap silently.
Test: `DrawDiagramButton.test.tsx`'s `buildDrawDiagramTask` describe block.

## C1's own chrome, ported onto the one canvas (post-Stage-4 follow-up)

🔵 **The *change-review* half of this section moved to Impact in a later 038 follow-up** — see
"Change review moved from C1 to Impact" right after this section for the current names/keys/gate.
Everything below about the **coverage note** and the **plan panel** is still accurate and unchanged;
only the change-badge/change-summary-panel bullets are now historical (kept for the *why*, same
convention the 037 disclaimer below already uses).

Stage 4's own "not done" list called out that C1's change-review/coverage-note/plan-badge chrome
never got a home on `CanvasNodeBox`. Ported afterward, reusing the working stores untouched — the gap
was only ever on the *read* side.

🔵 **037-total-diagram-unification superseded several file names this section still narrates as
current** (the narrative below is kept for the *why*, not as a current file listing): `c1ChangesStore.ts`
and `impactReviewStore.ts` are gone, replaced by one generic `web/src/state/sidecarStore.ts`
(`SidecarStore<T>`); `useC1ChangeReview.ts`/`useImpactReviewSync.ts`/`useC1Coverage.ts` are gone,
replaced by `web/src/state/useSidecar.ts`'s `useC1Change`/`useReviewSidecar`/`useCoverageSidecar`;
`canvas/doc/C1CoverageNote.tsx` and `ImpactReviewSummary.tsx` are gone, replaced by one
`canvas/doc/SidecarSummaryCard.tsx`. `c1PlanStore.ts`/`C1PlanPanel.tsx` were untouched by 037 — the
`"plan"` overlay kept its existing `CardStore<T>`-based UI rather than moving onto `SidecarStore<T>`
— but both files, and the `"plan"` overlay itself, were later deleted outright with the Plan
overlay's retirement (see `change-cards.md`); the rest of this section's file listing still stands.
See [`diagram-skills.md`](diagram-skills.md)'s "037: five named registries" section for the backend
side of this rename.

- **The key**: a C1 `CanvasNodeBox` element's `meta.recipe_key` is the node's own flat `id` (see
  `canvas/recipes.py`'s shared `reshape()`) — the exact same string `c1ChangesStore`/`c1PlanStore` are
  keyed by. 🔴 **036-shared-diagram-style-catalog re-keyed both stores**: `c1_changes.py` and
  `c1_plan.py` used to synthesize a `canvas_node_id(trail)` key (a c1-only tree-trail address);
  since every block is now a flat, file-wide-unique `nodes[]` entry, both modules key by that same
  `id` directly — `c1_changes.py`'s `"block"`/`"node_id"` fields and `c1_plan.py`'s `node_id` are the
  literal node id, no synthetic trail. `c1ChromeKey()` in `CanvasNodeBox.tsx` reads
  `meta.recipe_key` unchanged; a non-C1 element (or one missing the field) gets `""`, a harmless
  miss.
- **Change badge + status accent**: `nodeChrome.tsx`'s `NodeChangeBadge` was widened to take
  `change: C1BlockChange | undefined` directly instead of a whole `NodeChrome`, so `CanvasNodeBox`
  can reuse it (`Block.tsx`/`TreeNode.tsx` updated to the new prop, unchanged behavior). The outer
  box gets a `block-change--{status}` class exactly like a hierarchy `Block` does — `styles.css`'s
  `.block-change--* > .block-row` rules already target `.block-row` generically, and a C1 box's own
  `elementRules.ts` entry already uses `.block`/`.block-row`, so no new CSS was needed.
- **Plan panel** (🔴 superseded — this bullet describes a feature since deleted with the Plan
  overlay's retirement; kept for the *why* of the `block-code-view--inline` convention it reused):
  `C1PlanPanel`, then kept and real, rendered as a sibling inside the box, populated by
  `usePlanToggle.ts`'s `getC1Plan()` call whenever Plan mode toggled on, via the same
  `block-code-view--inline` fly-out convention `NodePanels` uses on a hierarchy row.
- **Coverage note**: `C1CoverageNote.tsx` restored verbatim at `canvas/doc/C1CoverageNote.tsx`
  (reusing the kept `useC1Coverage.ts` and the newer `useDiagramGeneration` in place of the deleted
  `useC1Generation.ts`), mounted unconditionally in `RootCanvas` beside `.fit-all-button`, same reason
  as before (outside `.canvas-content`'s camera transform).
- **Change summary panel**: `C1ChangeSummary.tsx` and its driver `useC1ChangeReview.ts` (both
  incorrectly listed as Stage-4-deleted-and-gone in the section above) restored verbatim — their own
  logic needed zero changes, only *what enables them* changed. First cut used plain `isDiffActive`
  for both the hook's `enabled` and the panel's mount condition (no gate on a C1 layer being
  present, since there's no more "C1 view" to gate on), but that meant the panel — and its
  `c1-sub::…` node ids — surfaced on Diff whenever *any* diagram was open, even with no C1 recipe on
  the canvas, which read as "C1 opening itself." Second cut computed `hasC1Layer` (`doc.elements`
  has any element with `layer === "c1"` — the one-canvas equivalent of "the C1 recipe is on the
  canvas," since a diagram's presence is a binary layer-membership fact) and gated **both** the hook's
  `enabled` and the panel's mount on `isDiffActive && hasC1Layer` — but `useC1ChangeReview.publish()`
  is also what populates `c1ChangesStore`, which `useNodeChrome` reads unconditionally to badge
  every hierarchy/C1 block's diff status (see the "core hierarchy chrome, not C1-view-only" note
  above), so that second cut silently killed hierarchy diff badges for anyone who hadn't added the
  C1 diagram to their canvas — clicking Diff ran the review fine server-side but nothing ever
  rendered. Final shape: the hook's `enabled` is back to plain `isDiffActive` (badges always work on
  Diff); only the panel's own mount condition is `isDiffActive && hasC1Layer`. ⚠ `hasC1Layer` comes
  from `canvasDocStore`'s `useHasCanvasLayer("c1")`, **not** `collectActiveLayers(useCanvasDoc())`:
  `useCanvasDoc` returns a fresh object on every emit, so subscribing to it from `RootCanvas` re-rendered
  the whole tree on every drag commit, canvas PATCH and live ping. The boolean selector bails out
  unless the answer itself changes. `AgentRail`/`DrawDiagramButton` still use `collectActiveLayers`
  directly — they need the whole set, not one layer's membership. Mounted in
  `RootCanvas` next to `DeletedDiffOverlay`, outside the pan/zoom camera, exactly where it always
  floated.

Tests (coverage-note/plan-panel only — the change-badge case moved, see the next section):
`web/src/canvas/doc/CanvasNodeBox.test.tsx`; the coverage-note case lives in
`web/src/canvas/doc/SidecarSummaryCard.test.tsx` (037 — `C1CoverageNote.test.tsx` is deleted).

## Change review moved from C1 to Impact (038 follow-up)

Not the judgmental-axis removal the next section describes — this is the surviving *explanatory*
axis (before/after prose), retargeted from `c1` to `impact` because impact boxes already carry a
real graph `node_id` (attribution is a direct lookup + ancestor walk through the actual graph), while
C1's blocks are hand-authored and addressed by path (a longest-prefix match). C1 needed no
pre-drawn diagram at all for this to work once the axis moved — impact already is a diff-only slice.

Current names, mirroring the old C1 ones one for one:

| Was (C1) | Now (Impact) |
|---|---|
| `c1ChangesStore` | `impactChangesSidecarStore` (`web/src/state/useSidecar.ts`) |
| `useC1Change(nodeId)` | `useImpactChange(nodeId)` |
| `useC1ChangeReview`/`useChangesSidecar` | `useImpactChangesSidecar` |
| `C1ChangeSummary.tsx` | `ImpactChangeSummary.tsx` |
| `c1ChromeKey(element)` | `recipeChromeKey(element)` — generalized, since it's now shared by two different callers (see below) |
| `hasC1Layer` (`useHasCanvasLayer("c1")`) | `hasImpactLayer` (`useHasCanvasLayer("impact")`) |
| `.codechroma/c1-changes.json`, `/c1-changes(-path)` routes | `.codechroma/impact-changes.json`, `/impact-changes(-path)` |

🔴 **`CanvasNodeBox.tsx` now needs two separate render-kind checks, not one.** Before this move, a
single `isC1` (from `useNodeOverlays`) gated *both* the change badge and the plan panel, since both
lived on c1 boxes. Now the badge is gated on `isImpact` (`useNodeOverlays`'s field, renamed from
`isC1`) while the plan panel keeps its own `isC1 = element.render === "c1"` check (the "plan" overlay
stayed on c1 — only "changes" moved). Both still read the same `recipeChromeKey(element)` (i.e. the
element's `meta.recipe_key`), because that key is diagram-agnostic; only the diagram/overlay it's
looked up against differs. `useNodeChrome.ts`'s `changeClass` fallback to `hierarchyChangesStore`
(plain-hierarchy diff badges, independent of any diagram) is unchanged by any of this.

Tests: `web/src/canvas/doc/CanvasNodeBox.test.tsx`'s "change review chrome (Impact) and plan chrome
(C1)" describe block (badge/accent/plan-panel wiring, and that neither reads the other's chrome even
with a matching key), `web/src/canvas/ImpactChangeSummary.test.tsx`,
`web/src/state/useImpactChangesSidecar.test.ts`, `web/src/state/impactChangesSidecarStore.test.ts`.

## Impact always-on diff data (no global Diff toggle needed)

The Impact diagram is *about* changes, so its blocks show diff + change-colored file/function lists
with the global Diff toggle **off**. `web/src/state/useSidecar.ts`'s `useImpactDiffSync`
(`RootCanvas.tsx`, gated on `useHasCanvasLayer("impact")`) refills `diffOverlayStore` and
`hierarchyChangesStore` from the same deterministic GETs (`getDiff`/`getChangeCards`'s
`by_node_status`) that the Diff toggle's `refreshDiffs` uses — so `DiffView` in the inspector/popup
renders for impact nodes and `InspectorRow` tints its list by status.

Two load-bearing details:

- **It must not "turn Diff on".** `DiffOverlayStore.write(entries, setActive)` is the single writer:
  the global Diff toggle calls `write(entries, true)` (raises `isActiveState`) while the impact
  path calls `write(entries)` — it writes the diff map + deleted snapshot + emits, but never sets
  `isActiveState`. Setting `isActive` would raise `DeletedDiffOverlay`/`ChangeConnectionsOverlay`/
  `ImpactChangeSummary` chrome the user didn't ask for. Impact's own deleted blocks stay on the
  review/ghost path — the deleted snapshot is populated but `DeletedDiffOverlay` is gated on
  `isActive`, so it stays hidden. A single emit after both writes means a subscriber observing
  `isActive` sees a real transition rather than a no-op intermediate.
- **It refills after Diff turns off.** The Diff toggle's off-path calls `clear()`, which wipes this
  impact fill too. `useImpactDiffSync` subscribes to `diffOverlayStore` and re-syncs on the
  active-fell transition (tracked, not bare re-check — `write`'s emit would otherwise loop). The
  always-on fetch is single-flight (one run in flight, one coalesced rerun) so a changed-ping storm
  can't stack N concurrent `getDiff`+`getChangeCards` pairs, and it re-checks `getIsActive()`
  post-await so a run that straddles a Diff turn-on can't clobber the reveal's data.
- **Status inherits up to every nesting level.** `InspectorRow` resolves a row's status as its own
  diff/change-card status, else the status of the enclosing `component::<file>` (which the whole-file
  diff entry in `git_diff.py` supplies). A function/class/`service::…::functions` container row with
  no status of its own inherits its file's, so the always-on color reaches deep levels — not just
  the leaves the pull-down diff happened to name (see `InspectorPanel.tsx`'s `componentOf`).
- **A block carries one badge chip per distinct status.** `NodeChangeBadge` counts `change.files`
  by their `status` (`deleted` folds into `removed`) instead of trusting the single aggregate
  `change.status`, and renders one chip per status in a fixed order (`added`, `modified`, `removed`)
  — so a block whose subtree mixes added *and* modified files shows `+1 ~2` side by side rather than
  hiding one behind the other. When `files` is empty it falls back to one chip from the aggregate
  `status`/`change_count` (see `nodeChrome.tsx`).

Gating on the impact layer's presence means with no impact layer these GETs stay idle (same rule as
`useImpactChangesSidecar`'s review fetch). Tests:
`web/src/state/useImpactDiffSync.test.ts` (fills without `isActive`, idle when layer absent,
re-syncs on ping and on Diff-off), `web/src/state/diffOverlayStore.test.ts` (`fillDiffs` doesn't
flip active), `web/src/canvas/InspectorPanel.test.tsx` (row tint from diff status and from
change-card status).

## Impact review — ported onto the one canvas, then removed (038 follow-up)

A post-Stage-4 follow-up once ported the Impact review's per-box severity badge/accent onto
`CanvasNodeBox` (keyed by `element.node_id`, via `reviewSidecarStore`/`useImpactReview`) plus a
floating summary card (`SidecarSummaryCard`'s `"review"` variant). The whole judgmental review flow
was removed rather than left half-wired (038 follow-up, see [`graph-bridge-core.md`](graph-bridge-
core.md)) — `CanvasNodeBox` carries no Impact-specific chrome today, and `SidecarSummaryCard` has
only its coverage variant left. The plan-role status accent (`.block-change--<status>`, driven by
authored `meta.status` via `nodeAccent.tsx`'s `accentFor()`) is unrelated and still applies to every
diagram kind including Impact.

## Copy-context button, restored on `CanvasNodeBox` (post-Stage-4 follow-up)

The old C1 view rendered its System/Actor boxes through the shared hierarchy `Block` component
(`elementRules.ts`'s own comment flagged this as "the one deliberate gap"), so every C1 box carried
`NodeButtons`' copy button for free. `CanvasNodeBox` never got an equivalent — a real regression, not
a scoped-out gap, since users had relied on it to grab a block's path/name for pasting into an AI
chat as context.

- **Shared button, generalized**: `nodeChrome.tsx`'s private `NodeCopyButton` (bound to a
  `HierarchyNodeRef`) was split into an exported `CopyButton({ text, name, variant })` plus a thin
  `NodeCopyButton` wrapper that computes `text`/`name` from a node via `nodeCopyText` — `Block.tsx`/
  `TreeNode.tsx` keep using the wrapper unchanged.
- **Path decode without a `HierarchyNodeRef`**: `CanvasNodeBox` only has a `CanvasElement`
  (`node_id: string | null`, `label`), not a full node with a `level`. `nodeCopyText.ts` now exports
  `elementCopyText(nodeId, label)` — the same folder/file prefix-strip `nodeCopyText` already did,
  minus the `level` check (a symbol id like `function::get_db` was never in `PATH_PREFIXES` anyway, so
  it already fell through to the label/name either way). `nodeCopyText` itself is now defined in terms
  of `elementCopyText`.
- **Wired into every render kind, not just C1**: `CanvasNodeBox` renders one `CopyButton` per box,
  keyed off `elementCopyText(element.node_id, element.label)` — pattern/impact/epic/custom boxes tied
  to a real `node_id` get a working copy button for the first time (their old bespoke `*NodeBox`
  components never had one), and a synthetic box with no `node_id` (a C1 Person/System, an epic) falls
  back to `element.label`, same behavior `nodeCopyText`'s own "root sentinel" case already covered.
- **New CSS variant**: `.canvas-node-box-copy-button` added alongside `.block-copy-button`/
  `.tree-node-copy-button` in every shared rule (idle/hover/is-copied/is-failed), plus a new
  `.canvas-node-box-buttons` row, pushed to the header's far side by `justify-content: space-between`
  — every render kind's `headerClass` is row-direction with its own title-wrap column beside it (see
  `elementRules.ts`'s `DIAGRAM_NODE_BASE`/`titleWrapClass`), the same shape as C1's `.block-header`/
  `.block-title`. 🔴 **This used to be two different layouts, and the mismatch was a real bug**:
  `.diagram-node-box-header` (pattern/impact/custom/epic) was column-direction, but its `headerClass`
  string also carried the literal class `block-header` for no real reason. `.block-header`'s
  `justify-content: space-between` leaked in from that second class, and once the header stretched to
  the box's full height (the default flex `align-items: stretch` down the ownership chain from
  `.diagram-node-box`), that pushed the copy/desc buttons all the way to the *bottom* of the block
  instead of stacking directly under the title. The fix made every kind's header genuinely
  row-direction and self-contained (no more piggybacking on `.block-header`'s CSS), with its own
  `titleWrapClass` (`.diagram-node-box-title-wrap` for these four, `.block-title` for C1) — see
  `CanvasNodeBox.test.tsx`'s "title/description layout" describe block.
- **Bare top-level folder falls back to the label**: a coarse C1/pattern/impact block's authored
  `path` is sometimes a whole top-level directory rather than a real sub-path — e.g. a `Control
  Plane` box whose `path` is just `application` (the repo's biggest folder), because it hasn't been
  decomposed into narrower sub-blocks yet (see `c1_resolver.py`'s `_resolve_children`/
  `resolve_path_node`, exact-match only). Copying that path is technically correct but useless as AI
  context and actively misleading for a block named something else entirely. `elementCopyText` now
  only returns the decoded path when it has more than one segment (`path.includes("/")`); a bare
  one-segment folder falls back to the label instead, same as a `node_id`-less synthetic box already
  did. `nodeCopyText` (the hierarchy strategies' own version) inherits this for free since it's
  defined in terms of `elementCopyText` — harmless there too, since a real top-level folder's single
  path segment already equals its own name.

Tests: `web/src/canvas/doc/CanvasNodeBox.test.tsx` ("copy button" describe block — decodes a real
node's path, falls back to the label with no `node_id` or with a bare top-level folder path),
`web/src/canvas/strategies/nodeCopyText.test.ts`
(unchanged, still exercises the shared decode logic through `nodeCopyText`).

## Stage 6 (backend cleanup + docs) — Landed, narrower than the plan's own text

The plan's Stage 6 said "Delete `routes/diagrams.py`, `routes/custom_diagrams.py`, the per-kind
layout routes and `Workspace`'s per-kind artifact accessors." Two of those four claims didn't hold,
same pattern as Stage 4's own corrections above:

- **`routes/diagrams.py` and `routes/custom_diagrams.py` are NOT deleted.** `routes/recipes.py` (the
  mechanism every `RecipeMenu` click runs through) imports `diagrams.py`'s `resolve_diagram` directly
  and calls it in-process for c1/patterns/impact/custom; the interactive skills (at the time,
  `codechroma-c1`/`codechroma-patterns`/`codechroma-impact`/`codechroma-impact-review` — since merged into
  `codechroma-draw-diagram`/`codechroma-review-diagram`, see `diagram-skills.md`) also curl several of
  these files' own GET routes from the terminal. Both files stay, trimmed only where confirmed dead
  (below).
- **`Workspace` has no per-kind artifact accessors to delete.** No `c1_path`/`patterns_path`/
  `impact_path`/`epics_path`/`custom_diagram_path`/`*_layout_path` methods exist on `Workspace` at
  all — those names are free functions in `c1_agent.py`/`patterns_resolver.py`/etc., wired into
  `diagram_registry.py`'s `DiagramSpec.artifact_path`. `Workspace`'s only artifact accessors are
  generic and kind-parametrized (`diagram_artifact_path(kind)`, `diagram_path(kind)`,
  `layout_store(kind)`, `load_diagram(kind)`), and every one still has a live caller (`recipes.py`'s
  `to_ops` adapters, the coverage/`impact-changes` routes, the hierarchy's own layout persistence) — none
  were deletable.

**What actually was dead and got removed** — a canvas box's position now lives on `canvas.json`'s
own `Element.position` (written through `PATCH /canvas`, the Stage 1 write point), which made every
diagram-kind's separate `.codechroma/<kind>-layout.json` obsolete except one:

- `diagram_registry.py`: `has_layout=False` on the `c1`/`patterns`/`impact` `DiagramSpec`s and on the
  synthesized custom-type spec, and `"epics"` dropped from `EXTRA_LAYOUT_KINDS` (only `"hierarchy"`
  remains — its top-level-box drag is a separate concept from the canvas document, unaffected).
  `layout_kinds()` no longer registers a `GET/POST /repos/{id}/{kind}/layout` pair for any of them.
  🔴 `has_layout` turned out to be overloaded: `pr_import_seed.py` was (ab)using it as its filter for
  *which diagram kinds to copy into a PR worktree at all*, not just their layout file — flipping it
  to `False` for patterns/impact silently stopped seeding their whole artifact into a new PR. Fixed
  by dropping that filter (`pr_import_seed.py` now only special-cases `"c1"`, unconditionally copying
  every other built-in's artifact+layout the same as before `has_layout` existed as a concept there).
  `diagram_seed.py`'s agent-worktree seeding has the same `has_layout`-gated layout copy but no such
  bug — its artifact copy was already unconditional, and no longer copying a layout file nothing will
  ever read again is the correct new behavior, not a regression; its test was updated to match.
- `routes/custom_diagrams.py`: deleted the per-repo generate/status/output/cancel trio and the
  layout GET/POST pair (`generate_custom_diagram`, `get_custom_diagram_status`,
  `cancel_custom_diagram`, its `register_output_route` call, `get_custom_diagram_layout`,
  `save_custom_diagram_layout`) — the skill (at the time `codechroma-custom-diagram`, since merged
  into `codechroma-draw-diagram`) writes its artifact straight to disk and never posts `/generate`,
  confirmed by reading its own `SKILL.md`. The library CRUD,
  the interview trio, and the per-repo GET/`-path` routes are untouched and stay live.
- Frontend: `web/src/state/usePatternsGeneration.ts` (+ its test) deleted — its only caller was
  `PatternsView.tsx`, gone since Stage 4, so it had zero production callers left; and
  `useAbsoluteSavedLayout` deleted from `web/src/canvas/useSavedLayoutAndFitLoop.ts` for the same
  reason (its only would-be caller was Patterns' own layout hook). `LayoutKind`'s TS union was
  **deliberately left wide** (not narrowed to `"hierarchy"`) — `undoStore`/`UndoManager` are shared,
  kind-parametrized infrastructure with no reason to shrink just because no live caller currently
  passes anything but `"hierarchy"`.
- Three now-pointless contract tests deleted outright: `tests/unit/test_bridge_c1_layout_route.py`,
  `test_bridge_patterns_layout_route.py`, `test_bridge_epics_layout_route.py` (each tested only the
  now-404 layout pair for its kind), plus the generate/status/cancel/output/layout cases in
  `tests/contract/test_custom_diagram_routes.py`.

**Deliberately left alone (out of Stage 6's literal scope, flagged for a future pass, not done
speculatively here):** `diagrams.py`'s and `custom_diagrams.py`'s generate/status/cancel/output
route *registrations* are still reachable even where nothing calls them (patterns' and impact's
whole trio; c1's `generate`/`cancel` specifically — only its `status` is live, polled by
`C1CoverageNote.tsx`) — trimming those would mean restructuring the shared
`_register_generate_routes` factory that `impact-changes` and the diagram-type interview also depend on,
a bigger and riskier change than the plan's literal "per-kind layout routes" ask called for.
`impact.py`'s `get_impact_features` route and `EngineClient.getImpactFeatures` (zero caller
anywhere — it served the deleted `ImpactView`'s search box and was never re-ported) were removed in
038's dead-code cleanup.

**Docs — not a wholesale rewrite.** The plan asked to "retire `c1-diagram.md`, `patterns-diagram.md`,
`custom-diagrams.md`, `epics-view.md`, `impact-review.md`, `change-cards.md` and
`skill-artifact-merge.md` into [this file] or mark them historical." The first five already got a
Stage-4-era ⚠ banner pointing here and needed no further change. The last two turned out to describe
subsystems Stage 4 barely touched, not deletion candidates:

- `change-cards.md` — the plain hierarchy Diff toggle's card layer is unrelated to the five deleted
  diagram views and stays fully current. It got one corrective ⚠, not a banner: its own text
  describes `PatternNodeBox.tsx` rendering `DiffView` inline for a dedupe-dropped card, and that file
  is gone with no replacement wired into `CanvasNodeBox` — a real, open gap, now written down instead
  of left for the next reader to discover the hard way.
- `skill-artifact-merge.md` — the plan's own open question #3 ("does this idiom get retired once the
  batch protocol owns merging? Probably — confirm during Stage 3") is answered **no**: `resolve_c1`/
  `resolve_patterns`/`resolve_brief`'s fresh-source-plus-authored-overlay splice operates one layer
  below `canvas.json` (on the artifact a recipe reads *before* it becomes ops), and the batch
  protocol's `created_by`/`layer` ownership rules never touched it. The doc stays as the current
  reference for those three resolvers, unedited.

`CLAUDE.md`'s Documentation map already carried the `single-canvas.md` row (added in Stage 4); its
Stage-1–4 wording was widened to cover 1–6.

## Group-drag jump / click-to-deselect / undo fixes (post-Stage-4 follow-up)

Three bugs reported against `CanvasNodeBox`'s drag/select/undo behavior, all traced to supporting
systems that worked for the older hierarchy view never being fully carried over to the one-canvas
box type:

- **Reselecting a box that once led a group drag rendered it displaced, with no drag involved.**
  `CanvasNodeBox.tsx`'s `onGroupCommit` never reset the `group` hook's own internal `useDragOffset`
  offset back to zero after a commit (unlike `solo`, which calls `resetOffset()` explicitly). That
  leftover offset stayed invisible while deselected (deselection routes rendering through `solo`,
  whose offset never moves), but resurfaced the instant the box was selected again as part of a 2+
  group — the render's idle-branch fallback (`liveDragOffsets[element.id] ?? offset`) read straight
  from the stale `group` offset. Fixed by not trusting `offset` in that fallback while `isGroupDrag`
  is true: zero is always the right idle answer for a group member, since a real in-progress drag is
  already covered by the dragging branch above it, which reads the live `dragOffsetStore` instead of
  local state. One line in `CanvasNodeBox.tsx`. 🔵 An earlier candidate fix (`resolveStartOffset`,
  mirroring `useSelectionAwareDrag.ts`'s hierarchy-side pattern) was tried and empirically ruled out:
  it only resyncs inside `handlePointerDown`, so it can't affect a render that happens before any new
  drag starts, which is exactly when this bug shows.
- **Selection never cleared on click-elsewhere.** `CanvasViewport.tsx`'s `handleClickCapture` had no
  branch for a plain click landing on neither a box (`REDIRECTABLE_CLICK_SELECTOR`), a marquee
  participant (`[data-select-id]`), nor a pan-excluded control (`PAN_IGNORE_SELECTOR`) — only Escape
  and a completed marquee touched `selectionStore`. Fixed by clearing selection there when none of
  those match. `NoteElement.tsx`'s own click handler had the same gap (unlike `Block`/`TreeNode`/
  `CanvasNodeBox`, which already cleared on a plain click) — fixed the same way, skipped when a
  modifier key is held so an in-progress shift-click/marquee gesture isn't disturbed.
- **Ctrl+Z never undid a `CanvasNodeBox` drag.** `commitPositions` (`CanvasNodeBox.tsx`) never wrote
  to `undoStore`, and `UndoManager` only ever popped the `"hierarchy"` kind (see the Stage 4 section
  above). Added a `"canvas"` `LayoutKind`; `commitPositions` now records the pre-move positions under
  it before applying them (`canvasDocStore.ts`'s new `applyCanvasPositions`, extracted from the old
  inline commit body so `CanvasDocView.tsx`'s undo-restore listener can reuse the identical
  optimistic-apply-plus-PATCH path). Since hierarchy and canvas-doc boxes are both on screen at once
  now (not separate views the way they were pre-Stage-4), one Ctrl+Z has to undo whichever kind was
  genuinely touched last — `undoStore` gained `undoLatest(kinds)` (compares a monotonic sequence
  number across the given kinds' stacks) and `UndoManager`'s `activeKind: LayoutKind` prop became
  `kinds: readonly LayoutKind[]`; `RootCanvas.tsx` passes `["hierarchy", "canvas"]`. Restoring a
  popped "canvas" entry does not call `recordCommit` again, or it would clobber the entry it just
  popped. Not covered by this pass: `NoteElement.tsx`/`HierarchyElement.tsx` each still call
  `canvasDocStore.moveElement`/`patchCanvasDoc` directly in their own `onEnd`, bypassing
  `CanvasNodeBox.tsx`'s `commitPositions` chokepoint entirely, so note and pinned-hierarchy-element
  drags remain non-undoable — same fix shape would apply if wanted later.

Tests: `web/src/canvas/doc/CanvasNodeBox.test.tsx`'s "group drag" describe block (the reselect-jump
regression, and undo-recording), `web/src/canvas/CanvasViewport.test.tsx` (empty-canvas click clears
selection, a marquee's own ending click doesn't), `web/src/canvas/doc/NoteElement.test.tsx`
("selection" describe block), `web/src/canvas/UndoManager.test.tsx` (`kinds` prop, cross-kind
recency), `web/src/state/undoStore.test.ts` (`undoLatest`).
