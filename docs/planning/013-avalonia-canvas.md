# 013 - Canvas UI to Avalonia (C#)

Status: **In progress** (pure logic, the hierarchy canvas, rubber-band/group drag/undo, the code popup, trace playback, the Diff toggle and the agent-window layer are ported and covered by headless tests; the React canvas is untouched and stays the reference, see "Phase 5 parity" below).

> Update 2026-10-18: Electron (`desktop/`, `electron-builder.yml`, PyInstaller, `cryptoCompat.ts`, the install forwarders) was removed from the tree; the last Electron commit is the local tag `electron-last-build`. Mentions below of Electron as the shipping app or reference describe the plan's history. Current state: [`docs/architecture/desktop-app.md`](../architecture/desktop-app.md).

Source: "Plan 3: Canvas UI -> Avalonia" of the four-plan C# migration. Shared rules apply: tests first, audit every test
with three questions (observable behaviour? covered elsewhere? tied to the old framework?), parametrize, shared JSON
fixtures, strangler rather than big bang, docs move with code.

Order across plans: core (1) -> bridge (2) -> shell (4) -> canvas (3). This plan was started early and in isolation: it
only needs the existing `GET/PATCH /canvas` JSON shape, so nothing in the bridge, the old Electron `desktop/` or `web/` was changed.

## Where the code lives

| Path | What |
|---|---|
| `dotnet/CodeChroma.Canvas/` | Pure, UI-free library (net8.0): model, routing, collision, layout, scene graph, viewport, stores, catalog logic, plus (Phase 5) `Hierarchy/` (expansion, nested layout, adapters over `CodeChroma.Core`), `Tracing/`, `Diff/`, `Agents/`, `State/Interaction.cs`, `Highlighting/SyntaxHighlighter.cs` |
| `dotnet/CodeChroma.Canvas.Tests/` | xUnit suite, 503 tests, driven by `tests/fixtures/canvas_logic/*.json` |
| `dotnet/CodeChroma.Canvas.Avalonia/` | Thin views: `CanvasView` (canvas document), `HierarchyView`/`HierarchyCanvas` (nested hierarchy), `CodePopup`, `TraceControls`, `DiffToggleButton`, `AgentWorkspaceView`; Avalonia 11.3.12 |
| `dotnet/CodeChroma.Canvas.Avalonia.Tests/` | Headless journey tests, 66 tests |
| `tests/fixtures/canvas_logic/` | Shared JSON cases (inputs and expected outputs of the vitest files), usable by vitest later |

Target framework is **net8.0** because only the .NET SDK 8.0.302 is installed here; the migration plan's .NET 10 is a
one-line retarget. `dotnet test dotnet/CodeChroma.Canvas.sln` runs everything.

## Step 0 - baseline (measured, not guessed)

Taken with `vite-node` on this machine before any C# existed (synthetic grid of 300x72 boxes, 3 random arrows per box,
seeded; `routeEdges` is the median-of-5 mean, ELK is one cold and one warm `computeElkLayout`).

| Boxes | Arrows | `routeEdges` (ms) | ELK layered, cold (ms) | ELK warm (ms) |
|---|---|---|---|---|
| 10 | 26 | 4.3 | 88 | 21 |
| 30 | 85 | 12.1 | 78 | 61 |
| 60 | 177 | 34.5 | 185 | 182 |
| 120 | 359 | 96.3 | 1206 | 1300 |

Reading: routing is cheap until the router's own cap (120 obstacles); layout is the real cost and grows super-linearly,
1.2 s at 120 boxes on the UI path after every recipe run. Box counts that matter in practice: a router degrades to
plain two-body routing above 120 distinct boxes, and the dependency digest caps below that. The vitest files in scope
(21 files, 251 tests) all passed before the audit.

C# after porting (same 120/359 scene): native layered layout finishes in a few ms inside the xUnit suite
(`A_large_diagram_lays_out_without_overlap_and_far_faster_than_the_elkjs_baseline` asserts < 1200 ms; observed far lower).

## Decision - ELK

Chosen: **native layered layout in C#** (`Layout/LayeredLayout.cs`), behind the same `LayoutBoxSpec`/`LayoutEdge`
contract elkjs had.

* No maintained .NET port of ELK exists; running `elkjs` needs a Node runtime at the point of use, which defeats the goal.
* The web's use of ELK is narrow: layered, direction down, `order` pins layers, `lane` clusters, components separated,
  aspect ratio 1.6. That is a small Sugiyama-style algorithm: DFS cycle breaking, longest-path layers, barycentre
  sweeps, lane regrouping, per-component layout, row packing. Every tie breaks on input order, so it is deterministic.
* Costs/risks: edge crossings are worse than ELK on dense graphs (no crossing-minimizing port assignment, no node
  placement refinement), and component packing is shelf packing, not ELK's. The contract tests (relational: source
  above target, order beats topology, lane adjacency, no overlap, determinism) pass; golden-position parity with ELK
  was explicitly not a goal.
* Escape hatch: the layout is a pure function of `(nodes, edges)`. If quality is not enough, run `elkjs` once offline
  (a Node script in CI or a dev tool) and ship precomputed positions as the layout, or swap the function.

## Test audit

Three questions per test: **observable** (a user or neighbour can see it), **unique** (not covered by another test),
**free** (not tied to the old language/framework). Fail 1 -> drop. Fail 2 -> merge. Fail 3 -> rewrite.

| vitest file (tests) | Verdict | C# home | Notes |
|---|---|---|---|
| `orthogonalRoute` (31) | kept, parametrized | `OrthogonalRouteTests` (+ `orthogonal_route.json`) | 31 became 9 theories over fixture tables (about 45 rows) + 3 facts. **Rewritten** the case named "routes around the boxes when sides face away": it never wrapped (boxes were vertical neighbours) so it asserted a straight line. Renamed honestly and **added** a real wrap case. New: invariant-culture number formatting, no `-0`. |
| `obstacleRouter` (14) | kept, merged | `ObstacleRouterTests` (+ `obstacle_router.json`) | Five cases on the same scene (no doubling back, pinned anchors, caption on routed path, axis aligned) **merged** into one case with an expectation list. Stateful and determinism cases stay facts. |
| `routeEdges` (7) | kept, merged | `EdgeRouterTests` | The two "two arrows into one side" tests **merged** into one theory (two geometries). New: an unresolved item is skipped. |
| `resolveDrop` (17) | kept | `DropResolverTests` (+ `resolve_drop.json`) | The `it.each` over scenarios was already the right shape; expectations in fixture as literals. |
| `collisionStore` (8) | **rewritten** | `CollisionRegistryTests` | It read `getBoundingClientRect`, divided by zoom, and used DOM `contains`. Now participants report canvas-space boxes from the model; nesting is a container chain; the two "divide by scale" tests moved to `ViewportTests` (screen gap -> canvas gap). Fails question 3 as written. |
| `autoLayout` (9) | kept | `AutoLayoutTests` | Behaviour tests kept; ELK replaced by the native layout. |
| `elkLayout` (8) + `diagramLayout.layoutBoxes` (4 of 10) | rewritten as the layout contract | `LayeredLayoutTests` | Third-party-engine tests become the contract of the engine that replaces it. The `layoutDiagramEdges` pass-through tests (6, same shape) were not ported: they test that fields are copied; they belong to the view model and are listed as remaining work. |
| `epicsLayout` (15) | kept, parametrized | `EpicsLayoutTests` (+ `epics_layout.json`) | The full-graph fixture was asserted twice with near-identical checks: **merged**. Layout checks are a tiny shared vocabulary (`sameX`, `gtY`, ...) usable from vitest. Added fit-width/height tables and a story-card count invariant. |
| `pileLayout` (6) | kept, parametrized | `PileLayoutTests` | `findUnplaced` as a table; added the locked-layout rule and `LayoutOps`. |
| `elementRules` (8) | kept, **partly dropped** | `ElementRulesTests` (+ `element_rules.json`) | Renderer/overlay/chip/activation/lock table kept. The `NODE_STYLES` CSS class-string tests (5) are **dropped**: they pin web styling, not behaviour. |
| `diagramCatalog` (32) | kept, merged, split | `DiagramCatalogTests`, `DiagramOrchestratorTests` | Per-layer predicate tests (`isDiagramLayer`, `isRecipeBackedLayer`, delete flag) **merged** into one `layerFlags` table. Stateful tests (position restore, deferred snapshot, delete order) use a fake bridge. |
| `nodeAccent` (39) | **rewritten**, parametrized | `NodeAccentTests` (+ `node_accent.json`) | CSS classes (`custom-node-kind-flow`) and DOM chips (`getByTestId`) are web details. Now semantic: icon id, kind, status (with `new` to `added` alias), palette index, shape, no-code reason; chip text as strings. Per-kind variants collapse into tables. |
| `DrawDiagramButton.test.ts` (4) + `.test.tsx` (5) | `.ts` kept; `.tsx` split | `DiagramCatalogTests` (task prompt), `DiagramStatusPlannerTests` | The ".ts / .tsx duplicate" is not a duplicate: the `.ts` tests the pure prompt builder, the `.tsx` the component. The prompt cases are one table. The two fingerprint tests (stale on reload / unchanged) became `DiagramStatusPlanner` tests with three more rows. The click/launch/disabled tests are DOM and are listed as remaining work. |
| `canvasDocStore` (4) | kept, extended | `CanvasDocStoreTests` | Fetch-race and defer tests kept. New: optimistic move rollback (rejected and thrown), pile auto-layout path, layout failure marks the layer unlayoutable. |
| `collapsedLayersStore` (10) | kept | `CollapsedLayersStoreTests` | `localStorage` becomes `IKeyValueStore`; the "starts empty / collapse / expand / toggle" trio stays distinct because each pins one rule. |
| `dragOffsetStore` (3) | kept | `DragOffsetStoreTests` | Plus the same-value no-op. |
| `diagramStatusCache` (4) | kept | `DiagramStatusCacheTests` | `sessionStorage` becomes `IKeyValueStore`. |
| `highlighting/registry` (8) | kept, widened | `LanguageRegistryTests` (+ `highlighter_aliases.json`) | 7 languages become every alias of 21. |
| `go/python/yaml/jsx Highlighter` (9) | **dropped** | n/a | They assert Prism's token output and "reassembles to source" for a third-party lib. Replaced by the TextMate-scope mapping; the reassembly invariant belongs with the AvaloniaEdit/TextMate binding (remaining work). |

Totals: 251 vitest tests in the audited files -> 365 xUnit tests (theories expand fixture rows) + 8 headless journey tests.
The growth is table rows and new coverage (wire JSON, viewport, scene graph, rollback, culling), not duplication; the
fixture tables are the place to look for the merged cases.

Test discipline followed: the red suite (365 failures against `NotImplementedException` stubs) was committed first
(`657d1cd`), then logic went green area by area, then the view's 8 journey tests were committed red before `CanvasView`.
Fixture expectations that were hand-derived were checked against the TypeScript implementation with a throwaway script
before being trusted (all matched).

## What was built

* **Model**: `CanvasDoc`/`CanvasElement`/`CanvasEdge` with the bridge's wire names, `RenderKind`, `ElementRules`,
  `NodeAccents`. Unknown JSON fields are tolerated.
* **Scene graph** (`SceneGraph`): rectangles come from the model, not the DOM. Centre-anchored by default, bottom-left for
  epic/spec/task, size from `size` or default, unsized boxes grown by `ITextMeasurer` with a 3-line description clamp. A
  512 px uniform grid answers viewport queries (10 000 boxes tested against brute force).
* **Viewport**: one scale+translate matrix, wheel/button zoom around the cursor, clamp 0.25-2.5, fit with focus ceiling
  3.5, `VisibleCanvasRect` with a screen-pixel margin. `SceneGraph.Cull` is the virtualization the web lacks: the view
  realises only the boxes on screen (2 000-box test realises about 100 at most).
* **Routing / collision / layout / stores / catalog**: ports of the logic above.
* **View**: `CanvasView` renders the culled slice through one `PushTransform`, routes edges for realised boxes, handles
  pan, wheel zoom, click / ctrl-click selection, and a collision-resolved drag (`DropResolver`) that settles
  optimistically and persists through `CanvasDocStore`. Locked-layout kinds are not draggable.

## Journey coverage (headless)

Done: pan, wheel zoom, culling plus pan swap, selection / multi-select / clear, drag with collision resolution and
persistence, locked-layout immobility, render with edges does not throw, text measurement (first pass, 8 tests); and, from
Phase 5, everything in "Phase 5 parity" below.

Not done (still React-only): focus-fit animation and snap/ghost landing preview, camera persistence, the project-tree and
code sidebars, the terminal panel itself (stays an xterm.js WebView, Plan 4's shell), the real REST/WS bridge client,
theming/pixel parity. See "What is left".

## Phase 5 parity (docs/planning/016-remove-electron.md) - what was ported, with the test that replaces each Playwright journey

All of it is driven by the C# graph core (`CoreHierarchySource` over `CodeChroma.Core.Graph`, fed in the tests by the shared
`tests/fixtures/graph_golden/sample_repo.input.json`), not by the mock bridge. Tests were written beside the code and committed
together (the red-suite-first discipline of the first pass was not repeated).

| Feature | Native implementation | Replaces | Headless test |
|---|---|---|---|
| Expand-in-place hierarchy canvas | `Hierarchy/ExpansionState`, `HierarchyLayout` (nested boxes, 5-column row else one column, description line, code panel), `HierarchyView` | `expand-in-place.spec.ts`, `multi-expand-collapse.spec.ts`, `Block.test.tsx` (expand/collapse/leaf/layout/description cases), `expansionState.test.ts` | `HierarchyJourneyTests` (expand chain to a function, sibling independence, leaf rule, persistence across reload), `HierarchyTests` |
| Rubber-band select | `Marquee`, `SelectionModel`, shift-drag in `HierarchyView` and `CanvasView` | `multi-select.spec.ts` (canvas half), `selectionStore.test.ts`, `Block.test.tsx` "Block selection" | `HierarchyJourneyTests` (band selects what it touches, second band extends, Escape clears, plain drag still pans), `CanvasJourneyTests` |
| Group drag | free move of the whole selection, solo drop settles through `DropResolver` | `TopLevelChildren.test.tsx`, `block-collision.spec.ts` | `HierarchyJourneyTests`, `CanvasJourneyTests` |
| Undo | `UndoHistory` (per kind, cap 10, `UndoLatest`), `TopLevelLayoutStore`, Ctrl/Cmd+Z | `undoStore.test.ts`, `UndoManager.test.tsx` | `HierarchyJourneyTests`, `CanvasJourneyTests`, `UndoHistoryTests` |
| Code popup + syntax highlighting | `CodePopup` (drag by title, corner resize, Escape/backdrop/close), `SyntaxHighlighter` (in-house tokenizer, 21 languages via `LanguageRegistry`), inline code panel | `CodePopup.test.tsx`, `code-popup-resize.spec.ts`, `inline-code-drag.spec.ts` (popup part), Prism highlighter tests | `HierarchyJourneyTests` (popup journeys), `SyntaxHighlighterTests` |
| Diff / change cards | `Diff/DiffController` (refresh + reveal + restore + cancel + coalesced live refresh + Accept), `DiffOverlay`, `LineDiff`, `ChangeCardLayout`; recolored borders, diff popup, `DiffToggleButton` | `global-diff.spec.ts`, `diff-accept.spec.ts`, `change-cards.spec.ts` (all `test.skip` upstream: the rail button was pulled), `refreshDiffs/useDiffToggle/useAcceptDiff/DiffView/ChangeCardsPanel` tests | `DiffJourneyTests`, `DiffControllerTests` |
| Trace playback | `Tracing/TracePlayer` (injectable clock), `TraceFlow` overlay math, `TraceControls` | `trace-playback.spec.ts` (2, `test.skip` upstream), `traceStore.test.ts`, `TraceFlowOverlay.test.tsx` | `TraceJourneyTests`, `TracePlayerTests` |
| Agent windows (window layer only) | `Agents/AgentWindowStore` (limit 5, clamp, minimize/restore, branch scope, workspace follow), `AgentWorkspaceView`/`AgentWindow` with a content slot for the shell's terminal | 10 of the 15 `agent-windows.spec.ts` journeys | `AgentJourneyTests`, `AgentWindowStoreTests` |

### Test audit additions (what was dropped or not ported, and why)

Three questions as before. A reason is recorded for everything not ported; anything not listed was **not audited** (see the end).

| Web test(s) | Verdict | Reason |
|---|---|---|
| `expand-in-place` / `multi-expand-collapse` / `multi-select` Project Tree steps (`clickTreeNodeName`, URL unchanged, `code-sidebar` visible) | dropped | The Project Tree and code sidebars are web chrome that is not ported; the canvas assertions (expand in place, ancestors stay open, siblings independent, modifier-click selects instead of expanding) are kept. "URL does not change" is meaningless without a router. |
| `Block.test` focus/"Center" button, copy-path button (3), `className` prop, `data-select-id` stamping | dropped | DOM buttons, CSS hooks and test attributes; clipboard copy and per-block centre are not ported (listed under What is left). |
| `Block.test` params signature | not ported | `HierarchyItem.Params` exists but the Core node has no parameter text yet, so the adapter passes null. |
| `Block.test` ChildRenderer (C1 box interior), "inline code panel dragged by its header" | dropped | C1 interior renderer is retired in single-canvas; the inline panel is not a draggable window in the native view (the popup is, and is tested). |
| `Block.test` "diff accept" inside the inline panel | merged into popup | Accept lives on the popup (`DiffJourneyTests`); an inline Accept button is not drawn. |
| `expansionState.test` snapshot-reference-stability (4), `cacheNodeRefs`/name fallback/cached-ancestor-path (5), `reset()` | dropped | `useSyncExternalStore` reference identity and the fetch-time parent cache do not exist: parents come from `IHierarchySource` synchronously. Deepest path and nearest-visible ancestor are kept. |
| `selectionStore.test` stable-reference, `undoStore.test` notify variants | merged | Same shape as the kept notify tests; reference identity is a React concern. |
| `CodePopup.test` "source area stays selectable (not a drag handle)" | dropped | Text selection is a DOM/browser behaviour. |
| `refreshDiffs.test` "shared ancestor fetched once", "nothing fetched when cache has the chain" | dropped | There is no per-ancestor fetch to dedupe; ancestors are read from the in-memory source. |
| `refreshDiffs.test` "drops a run whose workspace was switched mid-flight" | not ported | The C# canvas has no workspace registry yet (belongs with the bridge client). |
| `useDiffToggle.test` camera-lock release | dropped | There is no auto-fit loop or camera suppression in the native view. |
| `ChangeCardsPanel.test` "stamps its own node id for the connector overlay", `TraceFlowOverlay.test` aria-label counts | dropped | DOM attributes / accessibility labels of SVGs. |
| `change-cards.spec` "dragging a change-card panel moves its connector" | not ported | Panels are not draggable in the native view (placed beside their block). Upstream test is `test.skip`. |
| `agent-windows.spec` "resizing an agent window reflows its xterm grid", "the rail body has no scrollbar", "branch switcher stays usable" | not ported | xterm lives in the shell's WebView; the scrollbar test is a CSS pixel check; the branch switcher is not ported. |
| `trace-playback.spec` / `change-cards.spec` / `global-diff.spec` / `diff-accept.spec` | ported although `test.skip` | They are skipped upstream only because the rail buttons were pulled; the logic is live, so the journeys are the right acceptance tests. |
| `highlighting/*Highlighter` (Prism) | replaced (as in the first pass) | `SyntaxHighlighterTests`: kinds from a table plus "tokens reassemble to the source" for every canonical language. The in-house tokenizer is lexical only (keywords, strings, comments, numbers); it is not a TextMate grammar. |

**Not audited individually** (Phase 5 scope was the journeys, the stores and the components named above): `AgentRail.test`,
`AgentWindow.test`, `AgentWindowLayer.test`, `agentStore.test`, `windowActions.test`, `launchAgent.test`, `attachAgent.test`,
`branchScope.test`, `branchStore.test`, `CanvasViewport.test`, `CanvasNodeBox.test` / single-canvas group-drag tests,
`useSelectionAwareDrag`, `useDragOffset`, `CodeView`/`CodeSidebar`/`ProjectTreePanel` tests, `ConnectionsOverlay`,
`RouteProbe*`, `LabelClearanceMonitor`, the epics/wiki/PR/C1 canvases.

## What is left after Phase 5 parity

1. The hierarchy surface is not yet wired to a live bridge: `ICanvasBridge` over the Plan 2 REST contract, the WS `changed` ping
   into `HierarchyView` (rebuild the `IHierarchySource`), `IDiffBridge`/`IAgentClient` implementations, and a trace list/stream client.
2. Camera persistence, focus-fit animation, snap/ghost landing preview, per-block "Center", copy-path button, `Params` on function
   blocks, doc-only styling checks, inline-panel Accept button, change-card panel dragging.
3. Project tree + code sidebar (`openFilesStore`, MRU tabs), `ConnectionsOverlay` (call/reference lines between blocks), route probe.
4. Real terminal inside an agent window and the dock/branch switcher (Plan 4's shell hosts the xterm WebView); a TextMate grammar
   if token fidelity beyond the in-house tokenizer is wanted.
5. Epics, C1, patterns, wiki and PR canvases, the single-canvas recipe menu, and layout-quality measurement against ELK.
6. Pixel/theming parity and real-font text measurement (the headless platform uses stub metrics).

## Review fixes (views and stores)

Avalonia views subscribe to model stores in `OnAttachedToVisualTree` and unsubscribe on detach, and marshal `Changed` to the UI
thread (`UiThread.Run`); `ApplyCanvasPositionsAsync` returns whether the write landed (the undo entry is recorded only then and a
failed refetch no longer rolls back); auto-layout refetches and applies the doc, with `LayoutTimeout` bounding a hung PATCH;
`DiffController` ignores results of cancelled/deactivated runs; `DiffOverlay.LinesOf` caches line diffs and `LineDiff` falls back
to a prefix/suffix diff above `MaxCells`; `FitAll` sets `Viewport.State` once, capped at `MaxScale`.

## Removal candidates in `web/` (nothing deleted yet - do not delete until the journeys above pass)

`web/src/canvas/` (including `connectors/`, `collision/`, `doc/`, `highlighting/`), its share of `styles.css`, the matching
vitest files, and the canvas Playwright specs; then drop `prismjs`, `elkjs`, and any `react` dependency nothing else uses.
The strangler rule: delete in a separate commit after the C# canvas passes the same journeys on real repos.

## Risks

* A rewrite of the UI, not a translation: CSS transitions, text metrics and pixel behaviour will differ.
* The Avalonia headless platform uses stub font metrics, so wrapping/height assertions on real text are weak; real-screen
  verification is still needed.
* Layout quality versus ELK (see Decision). Do this plan last, and only if plans 1, 2 and 4 leave the canvas the measured
  bottleneck - the Step 0 numbers say layout (not routing) is the bottleneck today.
