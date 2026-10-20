# Web canvas shell (`web/src/canvas/`)

Has grown well past the "minimal canvas + navigation base" the docs in `web/README.md` and
`web/QUICKSTART.md` still describe — those files understate the current feature set and shouldn't be
trusted as-is (see caveat in [`web-engine-client.md`](web-engine-client.md)).

Everything is one continuous in-memory DOM/CSS canvas — no per-node routing. A pluggable-camera
pan/zoom system sits on top of that canvas (wheel-zoom toward cursor, drag-to-pan, zoom in/out/reset
buttons, per-block "Center" focus, and a "Fit All" that fits the whole canvas) — see
`CanvasViewport.tsx` and `web/e2e/pan-zoom.spec.ts`. 🔴 **A reload returns to the exact saved spot —
both the camera and the tree's expansion persist per workspace.** The camera's `view {x, y, scale}`
is persisted to `localStorage` per workspace (`web/src/canvas/canvasCameraStore.ts`, same
`codechroma.*.<workspace>` namespace as `collapsedLayersStore`) on every pan/zoom; which blocks are
open (`expanded` + `codeVisible`) persists the same way (`web/src/state/expansionPersistence.ts`,
written by `ExpansionStore.persist()`). At mount both are restored before first render, and
`RootCanvas`'s first-load auto-expand/auto-frame is skipped when **both** a saved camera and a saved
expansion came back — so a refresh/workspace switch lands exactly where the user left off instead of
auto-expanding a fresh tree (which used to re-layout content off the saved camera and slide it
rightward on every reload). `ExpansionStore.load()` (invoked on workspace switch in `App.tsx`, like
`collapsedLayersStore.load()`) re-reads the now-active workspace's snapshot and re-seeds `restored`,
so a switch onto a restored tree also skips auto-expand. 🔴 `fitToAllNodes` unions both
`[data-node-id]` (hierarchy `Block`/
`TreeNode` and any code-backed box) **and** `[data-canvas-element]` (every canvas-doc box/note/group/
lane/frame — stamped on `CanvasNodeBox`/`NoteElement`/`SoftAreaFrame`), so a fit-all covers the whole
canvas instead of collapsing onto whichever diagram happened to carry code-backed `node_id`s.

- **`src/canvas/`** — `RootCanvas` composes the whole app shell. 🔴 **As of
  016-single-canvas-dashboard Stage 4, there is only ever one renderer: `canvas/doc/CanvasDocView`.**
  The old `CanvasView` union (`"hierarchy" | DiagramViewId`) and its `canvas/diagramViews.tsx`
  registry are gone, along with `C1View`/`PatternsView`/`ImpactView`/`CustomDiagramView`/`EpicsView`
  and the rail's per-kind toggle buttons — see [`single-canvas.md`](single-canvas.md) for the
  document model and its Stage 4 section for exactly what survived the cut and why (`c1ChangesStore`/
  `c1PlanStore`/`C1InspectorContext`/`C1PlanPanel` turned out to be core hierarchy chrome, not
  C1-view-only, and stayed at the time — `c1PlanStore`/`C1PlanPanel` were later removed outright with
  the Plan overlay's retirement, see `change-cards.md`; `c1ChangesStore`/`C1InspectorContext` remain;
  `canvas/epics/brief/` stayed too, reachable from an "epic" canvas element
  via a small standalone `EpicBriefPanel` instead of the deleted `EpicsView`). `RootCanvas` always
  renders `CanvasDocView` inside its `CanvasViewport`. The canvas opens empty and holds only
  diagrams; the Project Tree sidebar is the hierarchy surface (see
  [`single-canvas.md`](single-canvas.md)'s "No root block anymore").
  `DrawDiagramButton` (now mounted hidden in `RootCanvas` only for its auto-add-on-draw-finish effect; the visible "Draw…" control is the Diagrams tab's `DrawPopover`, replacing the five per-kind toggle buttons and,
  since the diagram-management unification, `RecipeMenu`'s own dropdown — see
  [`diagram-skills.md`](diagram-skills.md)) and
  `LayerStrip` (the layer-visibility chips, docked in `.canvas-chrome`) both live in `canvas/doc/`
  alongside it. `ConnectionsOverlay`/`ChangeConnectionsOverlay`/`TraceFlowOverlay` are unconditional
  now (they used to be gated on `isHierarchy`, and there used to be a fourth, `PlanConnectionsOverlay`,
  before the Plan overlay's retirement) are mounted unconditionally, but resolve no hierarchy
  endpoints while its layer is collapsed. `UndoManager` handles both `"hierarchy"` and `"canvas"`
  layout kinds. The hierarchy `collision/` multi-select/group-drag implementation remains in
  `strategies/boxes/TopLevelChildren.tsx`, but that hierarchy box surface is not shown on initial
  load. 🔴 **`canvas/doc/CanvasNodeBox.tsx` (the one box every recipe-authored element
  renders through) deliberately does not join that collision/multi-select system** — a canvas-doc
  element's position is the document's own absolute truth, committed straight through
  `update_element`. `web/e2e/multi-select.spec.ts` now verifies Project Tree modifier-click behavior,
  while `web/e2e/block-collision.spec.ts` verifies that expanding the tree does not put hierarchy
  boxes on the diagrams canvas. Neither exercises the hidden hierarchy-box drag surface; collision
  and group-drag behavior is covered by focused unit tests. 🔴 `CanvasNodeBox`'s inline style pins
  a real, fixed `width` (not just `minWidth`) equal to `element.size?.w ?? DEFAULT_WIDTH` — its own
  box classes (`.custom-node-box`/`.pattern-node-box`/`.impact-node-box`/the C1 `.block`) declare no
  CSS `width` of their own, so a `minWidth`-only box shrink-to-fits against `.canvas-content`'s own
  auto-computed extent, which is unconstrained once nothing sits nearby — that let an isolated box
  grow wider and wider until its description resolved onto one line (the reported "drag a block far
  away and it stretches" bug). The matching `descClass` (`.block-description`/`.pattern-node-box-desc`/
  `.impact-node-box-desc`/`.custom-node-box-desc`) is `-webkit-line-clamp`-d to 4 lines with an
  ellipsis instead, so the box can still grow taller for a longer description but never wider, and
  never past that line cap. The "?" button next to a description (`canvas-node-box-desc-button`)
  opens `DescriptionPopup.tsx` — a small backdrop+modal (`descriptionPopupStore.ts`, an
  `epicBriefPanelStore`-style single-entry store) showing the full, untruncated text — deliberately
  separate from the box's own click, which still calls `inspectorStore.open`; ⚠ `InspectorPanel` is no longer mounted by `RootCanvas`, so that click has no visible effect today (the panel and store stay in the tree because `InspectorNote` is still used by the epics view). 🔴 A second,
  independent bug had the name and description visually colliding for a C1 box specifically:
  `elementRules.ts`'s `c1` entry's `headerClass` (`.block-header`) is a row-direction flex container
  (mirroring `Block.tsx`'s own title-column-beside-buttons header), but `CanvasNodeBox` rendered the
  name-row and description as two direct siblings of that header rather than nesting them inside
  `Block.tsx`'s own `.block-title` column wrapper — so for `c1` boxes only, the two sat side by side
  as two more row items instead of stacking. `pattern`/`impact`/`custom` didn't show *this* bug
  because their own `headerClass` was column-direction at the time — fixed by a new, optional
  `NodeStyleEntry.titleWrapClass` (set only on the `c1` entry, to `"block-title"`) that
  `CanvasNodeBox` wrapped the name-row + description pair in when present. 🔴 **That column-direction
  header for pattern/impact/custom/epic turned out to be its own, separate bug**: `headerClass` also
  carried the literal class `block-header` (for no real reason), whose `justify-content:
  space-between` leaked into the column layout once the header stretched to the box's full height —
  pushing the copy/desc buttons to the *bottom* of the block instead of beside the title. Fixed by
  making every kind's header row-direction and self-contained, `titleWrapClass` now required on every
  `NodeStyleEntry` (`.diagram-node-box-title-wrap` for the shared four, `.block-title` for C1) — see
  `single-canvas.md`'s "Copy-context button" section for the detail. Two hooks
  still own what used to be inline:
  `useCanvasCamera` (the retry-until-mounted `frameFitTo` plus the auto-fit suppression lock — a
  memoized object, so an effect may depend on it) and `useDiffToggle` (owns its toggle, its
  pre-toggle expansion snapshot, and its live-ping reconciler) — it is called with its old
  C1/overlay-view flag hardcoded to `false` now, since there is only ever one view to special-case
  around. (A sibling `usePlanToggle` existed here too, fetching/populating the by-then-permanently-
  empty `c1PlanStore` as harmless dead weight — both were deleted outright with the Plan overlay's
  retirement rather than trimmed in place.) 🔴 `useDiffToggle` returns
  `{ toggle, isPending }`, not a bare function: `isDiffActive` (`diffOverlayStore.getIsActive()`)
  only flips once `refreshDiffs()`'s whole fetch/reveal chain has resolved, so on a large diff (many
  changed files, or a freshly-activated PR workspace still reanalyzing) the button could sit unpressed
  and inert for several seconds with zero feedback that the click landed. `isPending` is local state
  set the instant the "turn on" branch starts and cleared in a `finally`, independent of the store —
  `RootCanvas.tsx`'s `diff-toggle-button` uses it to swap its icon for a `.diff-toggle-spinner`
  while the fetch is in flight. Turning diff mode off is synchronous, so it never sets `isPending`.
  🔵 The Diff, "Show AI plan", and Replay buttons are currently not rendered anywhere (the rail they lived on is gone) (their logic — `useDiffToggle`/`usePlanToggle`/`traceStore` — still
  runs unchanged, just with no button wired to it); re-adding a button is a small JSX change, not a
  logic change.
  ⚠ That spinner (and `.workspace-banner-spinner`, which shares the one `@keyframes spin`) is held
  still under `@media (prefers-reduced-motion: reduce)` — it can run for the whole length of a slow
  fetch, which is exactly the moving content WCAG 2.2.2 is about. Held rather than hidden: the ring
  is still the "busy" signal, and the button's `aria-label` already carries the state in words
  ("Loading diff… click to cancel").
  🔴 The button must **not** be `disabled` while pending, and it originally was: nothing in
  `EngineClient` had a timeout or an abort, so an activation that never settled left Diff dead for
  the rest of the session (with `camera.suppress()` stuck on with it) — reload-only recovery, and
  the reported "the diff never finishes" bug.

  🔴 **That gap is now closed in `EngineClient` itself, not worked around here.** Every request goes
  through one of two `fetch()` calls (`fetchJson`/`fetchJsonOrNull`) and both carry
  `requestSignal(init, caller)` — the caller's own signal, plus, **for a GET only**, a
  `READ_TIMEOUT_MS` (30s) ceiling, combined with `AbortSignal.any` so whichever fires first wins. (A
  write gets no blanket timeout; see [`web-engine-client.md`](web-engine-client.md) for why.)
  `activationRef` is now simply an `AbortController`:
  a click during activation is the **cancel** gesture, and `cancelActivation()` aborts it, which
  really stops the in-flight `getDiff`/`getChangeCards`/`getNode` storm rather than merely declining
  to publish its result. `refreshDiffs(client, signal)` resolves to `null` on abort instead of
  rejecting, so callers treat "cancelled" exactly like "nothing to frame". The old
  `ACTIVATION_WATCHDOG_MS` timer, the `cancelled`/`busy` token pair and the `shouldAbort` callback
  are all deleted — one platform mechanism replaced three hand-rolled ones.

  🔴 **Cancelling also puts the expansion back.** A reveal that got partway through has already
  expanded real blocks, so `cancelActivation()` calls the same `restorePreDiffSnapshot()` the second
  ("turn off") click uses — one helper shared by both exits, rather than the snapshot being restored
  on only one of them. Without it those expansions survived the cancel *and* the next activation then
  snapshotted the polluted state as its own baseline, so they could never be undone at all. Order
  matters: abort first, then restore, because `revealNode` re-checks `signal.aborted` immediately
  before it expands — otherwise a walk whose last `getNode` landed a tick before the click would
  re-expand a block the restore had just collapsed. Covered by
  `useDiffToggle.test.ts`'s cancel cases (that the cancel click really aborts the signal
  the client saw rather than just the publish, and that it restores exactly what the reveal added
  while leaving what the user had open before the click alone) and `RootCanvas.test.tsx`'s "render
  strategy" describe block and `useCanvasCamera.test.ts`/`useSavedLayoutAndFitLoop.test.ts`. The shell
  is a full-bleed canvas with floating panels — see "Shell layout" below (it replaced the old
  IDE-style row of rail, project tree, code sidebar, agent dock, agent rail and inspector). The
  standalone `EpicBriefPanel` is still mounted unconditionally beside `.app-body`, rendering nothing
  while closed. `.canvas-chrome` (the top bar) still carries `data-testid="app-chrome"`
  (`e2e/pan-zoom.spec.ts` asserts it never moves under Ctrl+wheel). ⚠ `.canvas-stage` wraps the
  viewport plus `DeletedDiffOverlay`/`TraceControls` and the diagram notices for a reason: those are
  absolutely positioned, and the stage is their anchor (the panel-aware ones read `--shell-left`/
  `--shell-right`/`--shell-bottom` custom properties set on it). Two independent Strategy-pattern
  subsystems live here:
  - **`strategies/`** — the hierarchy always renders as nested boxes (`strategies/boxes/Block.tsx`,
    via `BoxesRenderer`). There is no boxes-vs-tree *choice* anymore: the former
    `strategies/registry.ts` (`resolveStrategy`), the `tree` strategy wrapper, and the
    `?strategy=` / `VITE_CANVAS_STRATEGY` startup switch were all removed. `TreeNode.tsx` survives
    only as `Block`'s interior `ChildRenderer` (e.g. the C1 view), and the shared node shape
    `CanvasNodeRendererProps` in `strategies/types.ts` is what `Block.ChildRenderer` stays
    interchangeable over — it must stamp `data-node-id={node.node_id}` on a real positioned element
    (CanvasViewport/ConnectionsOverlay rely on it). The root's direct children (Systems) render
    through `strategies/boxes/TopLevelChildren.tsx` instead of the ordinary flow-grid
    `block-children` container every deeper level still uses — a row-major grid (`gridLayout`) sized
    via the shared `canvas/useMeasuredSizes.ts` hook, each box independently draggable and
    group-draggable (`useSelectionAwareDrag`), top-rank-only. Nested levels are unaffected: still
    plain `Block`, flow-laid-out, no drag. Covered by `RootCanvas.test.tsx`'s "RootCanvas render
    strategy" describe and `strategies/boxes/TopLevelChildren.test.tsx`.
  - **`highlighting/`** — `getHighlighter(language)` (analogous to `AnalyzerRegistry.for_file()`)
    picks a `LanguageHighlighter`; each `<lang>Highlighter.ts` wraps one Prism.js component
    (python, go, yaml, java, typescript, javascript, jsx, tsx, c, cpp, csharp, ruby, rust, swift,
    kotlin, json, css, markdown, sql, bash, toml), `plainTextHighlighter.ts` is the no-op fallback.
    The registry maps backend `language` strings plus common aliases (`ts`/`js`/`c++`/`c#`/`rs`/…)
    onto them. This is static syntax coloring for already-fetched source shown in the `CodeOverlay`, not
    a live-sync-with-a-running-process feature.
  - Code view — `CodePopup.tsx` (the full-viewport overlay) and `CodeSidebar.tsx` were deleted; a project-tree
    row or a hierarchy function block (`useNodeChrome` → `CodePopupContext`, provided as `openCodeFor`) now opens `shell/CodeOverlay.tsx` (see "Code overlay" below). The overlay,
    the inline block code and the project tree all share `CodeView.tsx`, which reads/writes its mode
    via `codeViewModeStore.ts`, an `ExpansionStore`-style in-memory store (no persistence across
    reload; no UI flips the mode now).
  - `ConnectionsOverlay.tsx` — draws call/reference connection lines between currently-visible
    blocks, resolving each endpoint to its nearest visible ancestor when the real endpoint is
    collapsed. Routes through `connectors/` like every other arrow renderer, so its lines steer
    around the blocks they don't attach to. ⚠ Blocks here are nested DOM — a parent's rect contains
    its children's anchors — which only works because `obstacleRouter` skips any obstacle containing
    an endpoint's anchor. Read that rule before changing what this passes as `obstacles`.
    Its per-node `getConnections` fan-out is bounded (`util/mapWithConcurrency.ts`, allSettled
    semantics — one failed node no longer discards every other's result), and the block
    row/header selectors overlays walk the DOM with are the shared
    `canvasOverlay.BLOCK_ROW_SELECTOR`/`BLOCK_HEADER_SELECTOR` constants (also used by
    `ChangeConnectionsOverlay` and `TraceFlowOverlay`, whose border-to-border segment math is the
    shared `canvasOverlay.borderSegment`). Node ids in attribute selectors go through
    `CSS.escape()` everywhere — epic titles and custom type ids can carry selector-breaking
    characters. All three overlay `<svg>`s (`ConnectionsOverlay`,
    `ChangeConnectionsOverlay`, `TraceFlowOverlay`) carry `role="img"` and a live `aria-label`
    (e.g. "3 connections between nodes", "No plan steps") so a screen reader announces one
    description instead of raw path data or silence.
  - `RouteProbeOverlay.tsx` + `RouteProbeTrigger.tsx` (019-route-probing-and-label-clearance) —
    select exactly two nodes (`state/selectionStore.ts`'s `useSelectedIds()`), click "Trace route",
    and `EngineClient.getRoute(fromId, toId)` asks `GET /repos/{repo_id}/route?from=&to=` for the
    dependency path between them (`src/codechroma/bridge/routes/graph.py`'s `get_route`: a fresh
    `DependencyIndex` off `ws.engine.snapshot()`, callee-direction BFS first, caller-direction
    fallback, 12-hop cap, `{"path": null}` on no route/unknown id rather than an error).
    `state/routeProbeStore.ts` holds `{fromId, toId, path, isLoading}`; the overlay renders the path
    as `.route-probe-edge` segments, modeled on `ConnectionsOverlay`.
  - `LabelClearanceMonitor.tsx` (019-route-probing-and-label-clearance) — dev-only, renders
    nothing. On settle it DOM-queries `.connector-label-chip` (`connectors/EdgeLabel.tsx`) and
    `BLOCK_HEADER_SELECTOR` boxes, runs the pure `connectors/labelClearance.ts#findOverlaps`
    (pairwise AABB test), and `console.warn`s any clashing pairs. Detection only in v1 — no
    auto-reposition, no chrome badge. Re-checks on `canvasLayoutStore` version bumps and resize.
  - `connectors/` — the one shared arrow-geometry module set, used by every diagram view.
    `orthogonalRoute.ts` is the two-body solver (border anchors, stubs, rounded elbows, per-pair
    lanes). An anchor's point along its side defaults to the midpoint but takes an arbitrary
    `laneOffset` (`anchorOf`); `routeEdges.ts` feeds it a real one per endpoint via `assignPorts`,
    grouped by the exact box+side (`chooseSides`), not by which pair the arrow joins — so several
    unrelated arrows into the same side of a busy box spread across it instead of all landing on that
    side's exact midpoint. `obstacleRouter.ts` wraps it with an A\* search that avoids every *other* box;
    `RelationshipEdge.tsx` is the rendered arrow (casing + stroke + hit-stroke + caption) and
    `EdgeLabel.tsx` its measured, opaque caption chip. Three further shared pieces replaced per-view
    copies: `diagramLayout.ts`'s `layoutBoxes()` — the stable, **async** adapter surface every diagram
    view reaches through `autoLayout.ts`'s `layoutNewElements()` — delegates its body to
    `elkLayout.ts#computeElkLayout()`, which runs [ELK](https://github.com/kieler/elkjs)'s `layered`
    algorithm (`elkjs/lib/elk.bundled.js`, in-thread, no worker). It replaced the hand-rolled
    `layeredLayout.ts` (051-directed-layered-diagram-layout), which had replaced 024's radial layout
    and the original dagre layout. Direction is `DOWN`: for every one-directional edge A→B, A's box
    ends up above B's, so the diagram reads top-to-bottom in data/process-flow order; ELK breaks
    cycles itself. Duplicate same-direction edges collapse and self-loops / edges to unknown ids are
    dropped before ELK sees them (they still render). Spacing comes from `collision/constants.ts`'s
    `ELK_NODE_SEP` (nodes in a layer and between components) and `ELK_RANK_SEP` (between layers); disconnected components are packed by ELK
    (`separateConnectedComponents`, `aspectRatio` 1.6) — 🔴 ELK separates components with
    `elk.spacing.componentComponent` (default 20), which must be set explicitly or components touch.
    ELK returns top-left corners; the adapter converts to the center-anchored boxes the canvas uses.
    Every edge kind reads the same way — source above target, no per-kind inversion.
    **Fresh draw vs incremental update** (`autoLayout.ts#layoutNewElements`): a fresh draw (no other
    placed element in the new elements' layer) is laid out alone by ELK and stacked below existing
    canvas content. An *incremental update* (the layer already has placed boxes — a recipe re-run that
    added blocks) goes through `doc/incrementalLayout.ts#placeIncrementally`: ELK lays out placed +
    new boxes together with every edge among them (so a new box wired to an old one is ranked against
    it), but only the new boxes get positions — a placed box keeps its saved position exactly, whether
    or not the user dragged it, and the server's re-run never touches a kept element's position
    either. Each new box takes the offset (saved position minus ELK position) of the placed boxes it
    connects to — the global median offset if it has none — so new blocks follow a diagram the user
    moved or rearranged. `resolveDrop()` then clears overlaps against every other canvas element
    (other diagrams, user boxes; group frames excluded) and against earlier new boxes. A removed block
    simply leaves a gap; nothing reflows. `runRecipeAndLayout` passes its cache-restored positions as
    `fixed` so a layer being re-added counts as placed at its restored spots. Sequence and epics
    layers still relay out whole.
    **054-diagram-flow-order:** a box carrying an authored `meta.order` (`LayoutBoxSpec.order`,
    threaded from `element.meta.order` by `autoLayout.ts` via the shared `stringMeta()` helper,
    `doc/elementMeta.ts`) is authoritative over topology (see
    [ADR 0002](../adr/0002-order-on-box-overrides-rank.md)). ELK's own `partitioning` option was tried
    and rejected — it disables component packing and stacks unconnected nodes — so `applyOrder()`
    instead drops any real edge between two ordered boxes that runs *against* their order and adds
    synthetic ordering edges (never rendered) from every box of one order value to every box of the
    next distinct one. The order is the leading digit run (`parseOrderRank()`, 0-indexed, clamped at 0
    — `order: "0"` logs a `console.warn` and lands with `"1"`); an order-less box keeps the rank its
    real edges give it. Only relative order matters, so `"1"` and `"100"` leave no empty rows.
    Rendered as a "STEP n" tag inside the box's own top band
    (`NodeTopBand`, `doc/nodeAccent.tsx`, wired into `CanvasNodeBox.tsx`;
    `.canvas-node-top-band`/`.canvas-node-order-badge` in styles.css — see that file's "Band + meta
    row, ghost no-code" box-format section). 🔵 **Box format ("Band + meta row, ghost no-code"):** `CanvasNodeBox`'s
    meta chrome (plan_kind, order, impact status, no_code_reason) is no longer a set of floating
    corner pills/badges/strips — `NodeTopBand` (`doc/nodeAccent.tsx`) renders an in-flow strip above
    the header holding `meta.plan_kind` (tinted by role) and `meta.order` ("STEP n"), and
    `NodeMetaRow` renders an in-flow row between the title and the description holding an Impact
    `meta.status` chip (`render === "impact"` only) and a `meta.no_code_reason` chip side by side — no
    mutual exclusion between the two the old floating layout needed. The impact chip carries a mark
    (`+ ~ −`) and the box's real attributed change count (`~ MODIFY · 2`) from the same
    `useNodeOverlays` sidecar as `NodeChangeBadge`, matching the form's `~ MODIFY · 17`. A no-code box (`no-code-conceptual`/
    `no-code-unresolved`, `accentFor`'s `noCodeReasonClassName`) gets a solid 3px frame in the reason's
    color plus a transparent ("ghost") fill and an italic title (styles.css); `meta.plan_kind` no
    longer drives a border accent at all, only the top band. **`Lane`/`Concurrency island`** (the other two 054 terms, CONTEXT.md):
    within one layer, `elkLayout.ts#clusterByLane()` reorders the ELK input so every box sharing a
    `meta.lane` value is adjacent — a lane sits where its earliest member is — and ELK's
    `considerModelOrder.strategy: NODES_AND_EDGES` keeps that input order as a tie-break (a soft
    preference, unlike the old hard clustering; crossing minimization can still override it). A
    lane-less diagram passes through unchanged. Both are rendered, not laid out,
    as their own soft-tinted background areas — `LaneArea`/`ConcurrencyIslandArea` (`doc/`) — computed
    purely off `CanvasDocView.tsx`'s `renderableElements` through one shared `bucketPerLayer()`
    helper: it partitions box ids by diagram `layer`, and within each layer by `meta.lane` — and
    separately by the leading digit run of `meta.order` via the shared `leadingOrderDigits()`,
    `doc/elementMeta.ts` — so a Lane or leading digit shared by boxes in *different* diagrams never
    collapses their areas into one spanning the whole canvas (the same layer-scoping
    `memberIdsByLayer` gives `DiagramFrame`);
    a digit bucket with only one member is dropped before rendering (keepSingletons=false), since a
    lone numbered step has nothing to be concurrent with), not off any layout-time grouping — neither
    is a real document
    element, unlike `GroupFrame`'s `group`. All three (`GroupFrame`, `LaneArea`,
    `ConcurrencyIslandArea`) share one bounding-box calculation, `doc/boundingBox.ts#unionBoundsOf()`,
    but each area picks its color from its own hash/palette (`groupColor.ts`/`laneColor.ts`/
    `concurrencyIslandColor.ts`) so a box in all three groupings at once still reads as three distinct
    colors — deliberately never a shared hash, since a real structural group, a Lane, and a
    Concurrency island are independent, non-exclusive concepts that can freely overlap on one box.
    `routeEdges.ts` — the
    lanes→router→map idiom (lanes *and* ports assigned across EVERY item first — pairs via
    `assignLanes`, box+sides via `displacePorts` — one router per pass in input order, unresolvable
    items skipped but still consuming a lane/port). Each end's `displacePorts` group is fed *sorted*
    by the far box's centre along the exit side (060-connector-port-ordering): the pool's exit/entry
    points rise monotonically with the direction the arrow turns, so two arrows out of one busy side
    order by target position instead of by input order and stop crossing at the junction; and
    `ArrowMarkerDefs.tsx` — the
    `<defs><marker>` arrowhead block (`markers` must be a module-level constant, or Safari drops
    arrowheads referencing a re-created marker; `size`/`refX` stay props, but `refX` now defaults to
    `size` — the triangle's own tip — so the head lands exactly on `anchorOf`'s border point instead
    of poking past it into the box. The old per-view tuning (C1 boxes 8, epics/patterns 9, C1's
    internal overlay 7) was every view's own guess at compensating for that overshoot, not a value
    anyone had a reason to prefer; only `TraceFlowOverlay`'s trace arrow still overrides it, and only
    because its `orient="auto-start-reverse"` variant needs its own head anchored on the source end).
    🔴 `.c1-relationship-path`/`.c1-relationship-casing` (styles.css) use `stroke-linecap: butt`, not
    `round` — corner rounding already comes from `roundedPath`'s explicit `Q` curves, so `round` would
    only bulge the two open ends (half the casing's 5px stroke width) past the border into whichever
    box the arrow touches. Captions sit at the line's true arc-length midpoint, so a label block's
    centre lands on the middle of the connection even for an elbow route; `labelPointOf`
    (orthogonalRoute.ts) takes an `avoid: Rect[]` of the arrow's
    own two endpoint boxes and skips any candidate segment whose midpoint falls inside one, so a
    caption never lands on top of the block its own arrow connects to — it still does no
    collision-avoidance against any *other* box or label (that stays `LabelClearanceMonitor`'s
    dev-only warning, per docs/planning/019). Full routing notes, including the load-bearing rules,
    live in [`c1-diagram.md`](c1-diagram.md)'s arrow-routing bullets.

Panel plumbing lives in `canvas/panelStore.ts`: `PanelStore` is the shared open/closed store the
chat, wizard and terminal stores are (or extend — terminal adds agent selection), and
`useLatchedMount(isOpen)` is the once-open-stays-mounted latch RootCanvas applies to all four dock
panels (terminal/wizard/inspector) instead of hand-copied effects. Adding a panel is now: a
`new PanelStore()`, one `useLatchedMount` line, one render slot, one rail button — the now-removed
canvas chat panel (016-single-canvas-dashboard Stage 5, since retired by 008-unify-agent-diagrams;
see [`single-canvas.md`](single-canvas.md)) followed exactly this recipe, reusing the bottom-dock
CSS shell rather than inventing a new one.

Failure visibility: `main.tsx` wraps the app in `AppErrorBoundary.tsx` (a render-time throw shows a
reload panel instead of blanking the app) and installs `util/reportError.ts`'s global
`unhandledrejection` reporter; every read-path fetch hook (`useNodeChildren`, `useDiagramGeneration`, `useSkillOutput`,
RootCanvas's root fetch and auto-expand) catches into `reportAsyncError` instead of leaving an
unhandled rejection and a permanently-stuck loading state.

See [`web-collision-drag.md`](web-collision-drag.md) for the `collision/` subsystem, which lives in
this same `src/canvas/` directory but is documented separately given its size.

### Shell layout (`src/shell/`, `RootCanvas.tsx`)

The redesign ("MVP · Canvas") makes the canvas full-bleed and floats every panel over it. Scope was
panels and agents only: canvas behaviour and box styling are unchanged. Layout:
`.app-root > .canvas-chrome` (top bar) `+ .app-body.shell-body > .canvas-area`, where
`.canvas-stage` is `position:absolute; inset:0` (`shell/shellLayout.css`) and the panels are absolute
siblings stacked canvas < panels < terminal dock < code overlay < full-screen agents < popovers.
The old `nav.app-rail`, `AgentTerminalDock`, `AgentRail`, `AgentLedStrip`, `CodeSidebar`,
`CodePopup` are gone, and `InspectorPanel` is no longer mounted (the file and `inspectorStore` remain).

- **Top bar** (`.canvas-chrome`): optional `PR #n · head_ref` label, `BranchSwitcher`, spacer, then
  the Terminal toggle (moved off the rail), Report issue, `GamesMenu`, separator, PR and Settings
  buttons, and Run agent (`attachAgent`; disabled at agent capacity or while launching; the tutorial
  routes it to `tutorialSimStore.startAgent2`).
- **`shell/shellStore.ts`** — the single source of truth for shell chrome, persisted per workspace in
  `localStorage` as `codechroma.shell.<workspace>` (re-read by `shellStore.load()` after a workspace
  switch). State: `left {mode: open|collapsed, tab: diagrams|files, width}`, `agents {mode:
  normal|full|collapsed, activeId, width}`, `terminal {height}` (open/closed stays in `terminalPanelStore`), `codeOverlayOpen` (transient,
  never persisted) and `arrangeMode` (`side|stack|grid|null`, not restored on load: its snapshot is in memory). Hidden diagrams live in `collapsedLayersStore`. `App.tsx` calls `shellStore.load()` and `clearArrange()` on a workspace switch. Widths clamp to
  240-520 (left) and 340-720 (agents); `full` is not restored (a reload lands on `normal`).
  Transitions: left `open <-> collapsed` (`openLeft(tab?)` / `collapseLeft`); agents `normal -> full`
  (`agentsFull`, the ‹ on the handle), `full -> normal` and `normal -> collapsed` (`agentsStepOut`,
  the › on the handle, also Esc in full screen), `collapsed -> normal` (`openAgent(id)` from an
  a1/a2 button, or `expandAgents()` when there is no agent); `openCodeOverlay()` (a code click) drops
  `full` to `normal` so the overlay has a panel to sit over, `closeCodeOverlay()` leaves the agents
  state alone. An agent created while the panel is collapsed does not steal focus (the strip just
  gains a button).
- **Left panel** — `LeftPanel.tsx` (Diagrams / Files tabs; both bodies stay mounted so tab state
  survives), `EdgeHandle.tsx` (resize dots plus ‹/› buttons, mirrored per side), and
  `LeftCollapsedStrip.tsx` (the collapsed form). The Files tab is `ProjectTreePanel` with
  `embedded`; the Diagrams tab is `DiagramsTab.tsx` (rows: checkbox, colour dot, name, `type · n
  boxes`, eye = hide, ⋯ = delete behind `DeleteDiagramDialog`; header `Draw…` opens `DrawPopover.tsx`,
  which starts the draw agent with a kind preselected via `buildPickedDrawTask`) with
  `ArrangeControls.tsx` below the list (see [`single-canvas.md`](single-canvas.md)). The ticked rows
  live in `diagramSelectionStore.ts`.
- **`ZoomDock.tsx`** — bottom-left −, percent, +, Fit All (the same `CanvasViewportHandle` calls the
  rail used; `data-testid="fit-all-button"` kept). The percent follows `CanvasViewport`'s new
  `onViewChange`.
- **Agents panel** — right side, always present: `AgentsPanel.tsx`, `AgentsCollapsedStrip.tsx`
  (full screen is the same panel restyled over the canvas); see [`parallel-agents.md`](parallel-agents.md).
- **Code overlay** — `CodeOverlay.tsx`, rendered by `AgentsPanel` over its body (the agent terminals
  stay mounted underneath). `openCodeFor(node)` toggles the node in `openFilesStore` (MRU order, the
  same store `CodeSidebar` used: `open`/`toggle`/`activate`/`close`) and opens the overlay while any
  file stays open, closes it when the last one is toggled off. Tab strip with ✕ per tab and a "▾"
  menu for files past 8 (`useDisclosureMenu`); Esc or ✕ closes the overlay; the active file renders
  through the shared `CodeView`. It replaced both `CodeSidebar` (the tree-beside-code panel) and the
  full-viewport `CodePopup`.
- **Terminal dock** — `TerminalPanel` is a bottom dock inside `.canvas-area`; see
  [`web-panels.md`](web-panels.md).
- **Viewport insets and refit** — `CanvasViewport` takes `insets {left, right, bottom}` (the pixels
  floating panels cover). `RootCanvas` computes them from `shellStore` (left = 16 + panel width or the
  44px strip + 12; right = 12 + agents width or strip + 12; bottom = terminal height + 12 when the
  terminal is open) and also exposes them as `--shell-left/-right/-bottom` on `.canvas-stage` for the
  absolutely positioned notices (`wiki-general-notice`, `diagram-health-note`,
  `route-probe-trigger`). `computeFitView`, `fitToNode(s)`, `focusOnNode`, `centerOnNode`,
  `fitToAllNodes`, `fitToSelector`, the new `fitToBounds(rect)` (world-space rect, 0.9 padding; used by
  Arrange) and `viewportCenter()` (zoom buttons) all target the *visible* rect, the stage minus the
  insets. When insets change, `RootCanvas` pans the camera by the shift of the visible rect's centre
  (`CanvasViewport.panBy`), keeping zoom and the user's place instead of re-fitting; the first render
  does nothing. ⚠ The stage no longer resizes when a panel opens, so the viewport's resize
  re-centring (`VIEW_SETTLE_MS` gate) is not what moves the camera for panel changes. Panel widths and
  the terminal height reach the store (and so the insets) only when a drag ends. The viewport's debounced settle gate (`VIEW_SETTLE_MS`) that stops a startup resize from re-centring a restored camera is unchanged. The viewport also clears its click-swallow
  flag on `pointerdown` capture so a draggable box that stops propagation cannot leave a stale flag.
- **Narrow windows** — the plan's "one side panel at a time under 1100px" and "agents full-screen
  only under 720px" rules are not implemented in the code.
- Tests: `web/src/shell/*.test.tsx`, `RootCanvas.test.tsx`, `CanvasViewport.test.tsx`, e2e
  `agents-panel.spec.ts` (replaced `agent-windows.spec.ts`), `arrange.spec.ts`,
  `terminal-resize.spec.ts`, `inline-code-drag.spec.ts`, `pan-zoom.spec.ts`.

### Project tree panel (`src/canvas/ProjectTreePanel.tsx`)

The tree now lives in this sidebar rather than on the canvas: `RootCanvas` collapses the seeded
`hierarchy` layer on load (`collapsedLayersStore.collapse("hierarchy")`), so the canvas opens
diagrams-only, and the panel — the sole tree surface — is **open by default**
(`projectTreePanelStore = new PanelStore(true)`; superseded by `shellStore.left`). The old "Code tree" rail toggle (which flipped the
hierarchy layer on/off the canvas) was removed as redundant with the panel.

Layout: since the shell redesign the panel is the **Files tab** of the floating `LeftPanel` (rendered
with `embedded` and `hidden={false}`; the tab, not `projectTreePanelStore`, decides visibility), and
the panel's width is the left panel's (`useResizableSize` on `LeftPanel`, 240-520px).
`ResizableRail.tsx` and `projectTreePanelStore.ts` still exist but `RootCanvas` no longer mounts them.

It deliberately **reuses the hierarchy's `TreeNode` renderer** rather than inventing a filesystem
explorer: `ProjectTreePanel` mounts the same `TreeNode` (via `strategies/tree/TreeNode.tsx`) over
the hierarchy root. `TreeNode` reads/writes the shared global `expansionStore` and fetches children
lazily through `useNodeChildren` (which already re-fetches on live pings), so expansion and live
updates stay consistent within the sidebar. The canvas's hierarchy layer remains collapsed by
default and is not a second visible tree surface.

The panel passes `TreeNode` panel-only flags: `openCodeOnActivate` (a code-capable row opens in the
Code overlay via `openFilesStore`, instead of expanding) and `hideCodeButton` (drops the redundant
Show/Hide-code button from the row, since the click already reveals the source).

The open-file highlight is not a per-row subscription: `ProjectTreePanel` subscribes to the
open-files store **once**, builds an `openFileIds` `Set` + `activeFileId`, and threads them down the
tree as props — so `TreeNode` never subscribes to the sidebar's store (keeping the canvas/C1 trees
decoupled from it) and each row's lookup is O(1) instead of an O(n) scan. A tab change still
reconciles the expanded tree (the shared row is unmemoized and `activeFileId` is a global prop it
receives), but it fires one store render rather than one per row. Open rows get
`.tree-node-open-file` (subtle highlight); the active row additionally gets
`.tree-node-active` (stronger accent + green marker dot).

`RootCanvas` still provides `onActivate` as `navigateTreeTo` (`revealNode(nodeId)` followed by
`camera.frameFitTo([nodeId])`) where a hierarchy element is available on canvas; with the layer
collapsed by default, Project Tree expansion itself does not pan the diagrams canvas. `TreeNode`'s
label is keyboard-accessible (`tabIndex` + Enter/Space, with `aria-expanded` on rows that expand).
The panel is latched (`useLatchedMount`); its
`.project-tree-panel` CSS is a full-height scrollable column whose `[hidden]` override wins over
`display:flex`.

🔴 Because the tree is hidden from the canvas by default, the canvas-drawn overlays — the diff
`ChangeConnectionsOverlay`, `TraceFlowOverlay`, `ConnectionsOverlay` — resolve their endpoints
against `[data-node-id]` blocks in the canvas DOM, so with the tree off-canvas they render nothing.
This is accepted for now (see the "tree to the sidebar" decision): the overlays reappear if the
hierarchy layer is expanded back onto the canvas (`collapsedLayersStore.expand("hierarchy")`). A
full port of those overlays to the sidebar's scroll coordinates is out of scope.

### Open files (`src/canvas/openFilesStore.ts`)

`CodeSidebar.tsx` (a resizable panel beside the project tree) was deleted in the shell redesign; its
store lives on and now backs `shell/CodeOverlay.tsx` (see "Shell layout"). `openFilesStore` is a global
`Store` holding open `HierarchyNodeRef`s in **most-recently-viewed (MRU) order**: `open(node)` moves the
node to the front and activates it, `toggle(node)` opens (or re-activates) a not-current file and closes
the active one on re-click, `activate(id)` re-marks active without reordering (used by the overflow
dropdown), `close(id)` removes it and activates the next-most-recent neighbour. Resets on reload, same as
`ExpansionStore`. A code-capable tree row calls `TreeNode`'s `onOpenCode` (`openCodeFor`), which is why
those rows hide the Show/Hide-code button (`openCodeOnActivate`).

### Theming (`src/styles.css`)

All visual style lives in `src/styles.css`. Its single `:root` block at the very top is the design
token vocabulary — semantic surfaces (`--surface-0`…`--surface-4`), borders, text tones, accent and
per-view status colors (`--added`, `--trace`, `--c1`, `--patterns`; `--plan` is the purple token too
— named for the now-retired Plan overlay it originally colored, it's since been repurposed for the
C1 person-actor box and the multi-select outline, so don't read the name as still meaning "plan"),
the icon-control
gray trio (`--control-*`), radius, shadow, and type steps. Rules reference `var(--token)` instead
of literal hex, so one edit re-themes the whole app.

A literal "floating rounded cards on dark ground" palette (`--bg-ground`, `--bg-panel`,
`--bg-canvas`, `--bg-raised`, `--bg-raised-2`, `--bg-inset`, `--text-soft`, `--text-muted-soft`,
`--icon`, `--accent-bg`, `--success`, `--select-ring`, `--dot-grid`) sits above the semantic layer
and is aliased onto it, so the restyle re-themes the whole app without touching the ~7000 rules that
still reference `--surface-*`/`--text-*`/`--accent`. The canvas background/dot grid is the one part users can override: a saved Canvas style (Settings → Canvas style, `canvas-style/canvasStyleStore.ts`) reaches `.canvas-viewport` as `--canvas-bg`/`--canvas-texture-image` vars set by `CanvasViewport`, overriding `--dot-grid`; see [`assistant-settings.md`](assistant-settings.md). `--radius-panel` (22px), `--radius-card`
(14–16px) and `--radius-btn` (14px) are the new radius steps; pills (tabs, Run agent, Fit All,
chips, counters) use `border-radius: var(--radius-full)` instead. The main-window regions (top
bar `.canvas-chrome`, left panel `.left-panel`, agents panel `.agents-panel`, terminal dock,
full-bleed canvas `.canvas-stage`) render as separate floating cards with no hard
borders and no drop shadows — depth comes only from the background-shade steps above.

Two conventions when touching it: use a token for any value that repeats more than once (add a new
token rather than a new hex), and keep every font size at or above `--text-2xs` (0.68rem) — nothing
renders smaller. A global `:focus-visible` accent ring is defined at the top too, so interactive
elements get one consistent focus treatment. Scrollbars use the shared theme tokens globally: thin
tracks stay transparent, with rounded thumbs that become more visible on hover and drag.

## Avalonia port (in progress, `dotnet/`)

An Avalonia (C#, net8.0, Avalonia 11.3.12) port of the canvas lives under `dotnet/`: the pure logic (routing, collision solver, native layered layout instead of elkjs, scene graph with culling, viewport, stores) and, from 016 Phase 5, native equivalents of the expand-in-place hierarchy (`HierarchyView`, fed by the C# graph core), rubber-band select, group drag, undo, the code popup with syntax highlighting, trace playback, the Diff toggle with change cards, and the agent-window layer. This React canvas stays the reference and is unchanged; the audit, ELK decision, baseline numbers, the Phase 5 feature table (which Playwright journey each headless test replaces), what is left, and the list of `web/src/canvas/` files that become removal candidates once the C# canvas passes the same journeys are in [`docs/planning/013-avalonia-canvas.md`](../planning/013-avalonia-canvas.md). Shared test cases live in `tests/fixtures/canvas_logic/*.json`; run `dotnet test dotnet/CodeChroma.Canvas.sln`.
