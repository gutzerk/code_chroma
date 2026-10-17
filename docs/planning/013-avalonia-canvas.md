# 013 - Canvas UI to Avalonia (C#)

Status: **In progress** (pure logic and a first headless view are done; the React canvas is untouched and stays the reference).

Source: "Plan 3: Canvas UI -> Avalonia" of the four-plan C# migration. Shared rules apply: tests first, audit every test
with three questions (observable behaviour? covered elsewhere? tied to the old framework?), parametrize, shared JSON
fixtures, strangler rather than big bang, docs move with code.

Order across plans: core (1) -> bridge (2) -> shell (4) -> canvas (3). This plan was started early and in isolation: it
only needs the existing `GET/PATCH /canvas` JSON shape, so nothing in the bridge, `desktop/` or `web/` was changed.

## Where the code lives

| Path | What |
|---|---|
| `dotnet/CodeChroma.Canvas/` | Pure, UI-free library (net8.0): model, routing, collision, layout, scene graph, viewport, stores, catalog logic |
| `dotnet/CodeChroma.Canvas.Tests/` | xUnit suite, 365 tests, driven by `tests/fixtures/canvas_logic/*.json` |
| `dotnet/CodeChroma.Canvas.Avalonia/` | Thin view (`CanvasView`, `AvaloniaTextMeasurer`), Avalonia 11.1.5 |
| `dotnet/CodeChroma.Canvas.Avalonia.Tests/` | Headless journey tests, 8 tests |
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
persistence, locked-layout immobility, render with edges does not throw, text measurement.

Not done (still React-only): expand-in-place of the hierarchy, trace playback overlay, diff accept / change cards,
agent windows (16 Playwright tests), rubber-band multi-select and group-drag collision, undo, the code popup, the
terminal panel (stays an xterm.js WebView), the real REST/WS bridge client, theming/pixel parity.

## Remaining work

1. Bridge client: implement `ICanvasBridge` over the Plan 2 REST contract; WS `changed` ping to `FetchAndApplyAsync`.
2. Hierarchy canvas: expand-in-place nesting, `Block` / `CanvasNodeBox` visuals (59 + 38 DOM tests to rewrite as scene-graph
   and journey tests; decide which of the two survives when porting, they overlap on props).
3. Interaction parity: rubber-band select, group drag with collision (`web-collision-drag.md`), undo, keyboard, focus-fit
   animation, snap/ghost landing preview.
4. Overlays: trace playback, diff / change cards, impact chips on the model (chip text logic is already ported).
5. AvaloniaEdit + TextMate for the code popup; add the "tokens reassemble to source" invariant per language.
6. Agent windows and the terminal WebView host (belongs to Plan 4's shell).
7. Quality: measure the native layout against ELK on real diagrams and decide on the offline-elkjs fallback.
8. Run the shared fixtures from vitest too (a one-line loader per file) so the two implementations stay locked together
   until the web code is removed.
9. Retarget to net10.0 together with the other plans.

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
