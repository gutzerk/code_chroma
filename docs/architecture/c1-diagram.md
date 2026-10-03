# C1 (system-context) diagram


> ⚠ **The skill that writes this diagram is no longer its own.** `codechroma-c1` was merged
> into the one `codechroma-draw-diagram` router skill; its authoring rules now live in
> `references/type-c1.md` and its self-check is `check_diagram.py --kind c1`. See
> [`diagram-skills.md`](diagram-skills.md) for the router, the shared rules, the retire/prune
> pass, and the soft-diagnostics path this diagram's resolver now feeds.

⚠ **016-single-canvas-dashboard Stage 4 deleted `C1View.tsx` and its own box/overlay chrome** — a C1
box now renders through the one canvas's `CanvasNodeBox`, reached via the rail's `DrawDiagramButton`
("C1", labeled "System context" before 042-c1-diagram-quality-and-speed's rename; `RecipeMenu` was
its own dropdown before the diagram-management unification shrank it to a single "Draw…" button —
see [`diagram-skills.md`](diagram-skills.md)) rather than a dedicated rail toggle. Everything below describing `C1View.tsx` itself,
`diagramViews.tsx`'s C1 entry, or C1's own `PlanOverlay`/`ChangeOverlay`/`StageChrome` is historical.
The change-review/coverage-note/plan-badge chrome this file describes **has since been ported** onto
`CanvasNodeBox` — see `single-canvas.md`'s "C1's own chrome, ported onto the one canvas" section for
what changed and what stayed identical.

⚠ **036-shared-diagram-style-catalog then replaced `canvas/recipes.py`'s `c1_reshape`** (the bridge
onto the one canvas this note used to point at as "current") **with one shared `reshape()`** every
diagram kind now goes through — see [`diagram-skills.md`](diagram-skills.md)'s "036: one shared
shape, one resolver, one render path" for what that section of this file, and the "Two arrow
renderers, split by `scope`" passage further down (relations carry no `scope` field any more — that
whole split was `C1View.tsx`'s own concern and no longer applies), should be read against instead.
The generation pipeline and the current, much-shrunk `c1_resolver.py` are still accurately described
below; the resolver/schema bullets have been updated in place for 036, the rest of this file has not.

Part of the [Graph bridge](graph-bridge-core.md); see also [Patterns diagram](patterns-diagram.md),
the sibling top-level view.

⚠ **042-c1-diagram-quality-and-speed narrowed what the skill *authors*, not what the schema/resolver
*support*.** `type-c1.md` no longer tells the skill to decompose the system box: a freshly-authored
`c1.json` now has exactly one `system` node plus actors (`kind: "person"`/`"external_system"`), no
`parent` anywhere, and relations are only `actor ↔ system` — a true C4 "C1" system-context view, not
a component/service breakdown. The paragraph below describing a **multi-layer decomposition**, the
5-layer cap, `parent`-nesting below the top level, coverage/`unmapped`, the `TreeNode`
inline-decomposition rendering, and c1-changes' internal-arrow handling are all still real,
unmodified code paths — they still run correctly against an older, manually-decomposed `c1.json`, or
one a user hand-edits back into a tree — but the skill itself will not author that shape again. Read
everything below as **what the bridge and canvas still support**, not what a fresh AI-authored
diagram now looks like; see `docs/planning/042-c1-diagram-quality-and-speed/` for the rationale
(an 8-minute run producing an over-decomposed, "garbage-looking" diagram on a large monorepo, versus
a true system-context view that should take seconds).

- C1 (system-context) view — `GET /repos/{id}/c1` serves `<repo>/.codechroma/c1.json` (format/schema
  authority: `drawing-rules.md`'s "The one shared diagram shape" +
  `.claude/skills/codechroma-draw-diagram/references/type-c1.md`'s content rules — see
  [`diagram-skills.md`](diagram-skills.md)'s "036: one shared shape, one resolver, one render path").
  The **schema still supports a multi-layer decomposition**, not just two levels: since
  036-shared-diagram-style-catalog there is no nested `system`/`children` tree in the authored or
  resolved payload — every block (the system, each actor, every sub-block) is a flat entry in
  `nodes[]`, and `parent` (another node's own `id`) says which block it decomposes. Grouping blocks
  ("DB models", "Adapters") nest further blocks the same way a leaf does — via `parent`, not a
  container field — and a leaf names a repo path that bridges into the real hierarchy, which
  continues unbounded below. Up to **5 authored layers** (`MAX_AUTHORED_DEPTH` — enforced by the
  shared resolver/self-check's own parent-chain walk, not a tree-recursion depth counter); deeper
  ones are dropped server-side. Since 042, the skill itself only ever authors depth 1 (the system
  plus top-level actors, no `parent` at all) — the deeper layers this bullet describes are reachable
  only through an older or hand-edited file. A pre-036 saved file (the old nested shape) converts
  once on first read (`bridge/diagram_migration.py`), or is left untouched and served
  `needs_regeneration: true` if it can't be parsed.
- `GET /repos/{id}/structure?root=&depth=&max_children=&max_nodes=` (`context/structure.py`) — a
  bounded folder/file tree carrying real `dir::`/`component::` node ids, summaries and `truncated`
  flags, and deliberately **no `source`**. This was the C1 skill's only legitimate source of `path`
  values for decomposition: the digest never carried more than top-level names for this (and, since
  no C1 consumer read that field, `build_context_digest` dropped it entirely — see `context/digest.py`),
  and `/nodes/{id}/children` returns the full text of every file child (~16k tokens per directory), so
  neither can serve deep path authoring. `ls` is also wrong — the graph excludes
  `node_modules`/`dist`/`build`/`__pycache__`/`.venv`/`.codechroma`. Since 042, `type-c1.md` no longer
  tells the skill to call this route at all — a flat `c1` has nothing below the system box to give a
  `path` to; the route and the mechanism above remain real for any type that still decomposes
  (`custom`) or a hand-edited `c1.json`.
- **Wiki-first (029-wiki-driven-diagrams), historical for C1:** before decomposing a path, the skill
  used to try `GET /repos/{id}/wiki-context?paths=...` first (`docs/architecture/diagram-skills.md`'s
  "Wiki-first fetch order", Step 1). When the repo already has a wiki, its pages substitute for the
  `/structure` summaries above for every path they cover; `/structure` still runs for any path in
  the bundle's `gaps[]`, or the whole run when the repo has no wiki at all. `c1_resolver.py` and
  `c1.json`'s shape are unchanged — this only ever affected what the skill read while authoring, and
  since 042 the C1 skill no longer decomposes, so it no longer makes this call; the fetch order still
  applies to `patterns`/`custom` (`impact` opted out too, 049).
- **Wiki-general root, post-049, not historical:** unlike Step 1 above, C1 *does* read Step 0 —
  `GET /repos/{id}/wiki-general-context` — but only ever `root`, the system-level narrative, never
  `containers[]`. This is a separate first sub-step in `type-c1.md`'s own "Gather context", ahead of
  `context-digest`, not a return of the decomposition Step 1 removed: there's still nothing below the
  system box for a C2/C3 page's detail to attach to. See `docs/architecture/wiki-general.md`'s
  "Consumed by `codechroma-draw-diagram`" section.
- 🔴 **`c1_resolver.py` is now almost empty** — since 036-shared-diagram-style-catalog it holds only
  `resolve_path_node` (`component::{path}` then `dir::{path}`, **exact match, no ancestor
  fallback** — a stale path stays `null` rather than silently expanding into the wrong directory;
  `custom_diagram_resolver` used the same rule, now via `diagram_resolver`'s own copy). Everything
  else this bullet used to describe — attaching `node_id` per node, nulling pathless leaves,
  dropping a duplicate id, capping depth, and the old per-block `unmapped_ids`/"+N more" mechanism —
  moved into the one shared `bridge/diagram_resolver.py::resolve_diagram()` every `DiagramSpec`
  (c1 included) now calls; `unmapped_ids` itself is gone (the whole-repo `unmapped` sibling key
  described below is the only "what's uncovered" signal left). `canvas_node_id`/`index_blocks`/
  `scope_for` — the old synthetic-trail-key machinery `c1_changes.py`/`c1_plan.py` used to import —
  are gone too: both modules address a block by its own flat `id` directly now (no id-trail concept
  survives anywhere post-036). 🔴 037-total-diagram-unification moved `c1_changes.py`'s and
  `c1_plan.py`'s bodies (including `resolve_c1_changes`, `resolve_c1_plan`) into
  `bridge/overlays.py` as the named `"changes"`/`"plan"` `OverlayProvider`s — see
  [`diagram-skills.md`](diagram-skills.md)'s "037: five named registries" section. The `"plan"`
  provider (and the Plan overlay it served) has since been retired; only `"changes"` survives.
- `bridge/c1_tree.py` and `c1_resolver.py` were renamed to `bridge/diagram_paths.py` (037) — no
  c1-specific logic in either; `clean_path` is the one piece every path-based resolver (c1, custom,
  the `"changes"` overlay's own file attribution) still shares.
- 🔴 **Every file in the graph is reachable from the diagram, whether or not the agent modelled it.**
  `bridge/c1_coverage.py` `uncovered_roots` walks the real hierarchy against the set of authored
  paths (`diagram_resolver.authored_paths` — every flat `nodes[]` entry's own `path`, so an actor's
  decomposed children count, they are real code too) and returns the **minimal** set of subtrees no
  path accounts for: a covered node
  ends the branch, a *partially* covered one is descended into, a wholly uncovered one is emitted and
  not descended into. 🔴 It walks a `_FileTree` — the graph's filesystem layer indexed in **one**
  sweep — which also matches `engine.get_children`'s own indexed cache: since the engine's children
  fix, `get_children` is O(1) per call (a parent→children index built once per graph, invalidated by
  identity when `analyze`/`seed` swap the graph), so the naive per-directory recursion is no longer
  quadratic. That one sweep (for the filesystem level filter) is what lets it sit on every `GET /c1`
  as the `unmapped` key. `c1DiagramClient.attachUnmapped`
  hangs the list off the system box as one `c1-unmapped` block ("Unmapped code (N)"), each entry
  registered as an ordinary **bridged leaf** — so expanding it walks folders → files → classes and
  `codeBoundaryTarget` opens it in the `InspectorPanel`, with no navigation code of its own. Three
  details are load-bearing: `unmapped` is a **sibling key, not a child of `system.children`** (the
  skill's shape checks and their tests must keep reading that tree as purely authored work);
  `useC1Diagram`'s `normalizeC1Diagram` rebuilds the payload key by key, so the key has to be
  normalized there or it is silently dropped; and `C1View`'s `systemNode` counts the remainder in
  `child_count`, or a box whose blocks are all uncovered code would report no children and never
  offer to expand. This closed the hole that `_attach_unmapped`'s "+N more" never could — that one
  needs a block with **both** a path and children, and the system box has no path, so a directory
  nobody named was not merely unnamed, it was unreachable and invisible.
  ⚠ `unmapped` riding on `GET /c1` means the payload now moves when the *filesystem* moves, not only
  when c1.json does, so `useDiagram`'s deep-equal skip stops suppressing the rebuild whenever a new
  subtree appears or disappears in an uncovered area. That is correct — the remainder block's own
  label changed — and it stays rare because entries are whole subtrees: editing or adding a file
  *inside* an already-listed directory changes nothing. `_FileTree` sorts every sibling list with
  `graph.models.filesystem_order` and `_walk` is depth-first over it, so an unchanged repo always
  serializes identically and the skip still holds for the ordinary save.
- ⚠ **042-c1-diagram-quality-and-speed turned this feature off for C1.** A flat C1 has no
  path-bearing sub-blocks left (`authored_paths(diagram)` returns `[]` for a fresh, skill-authored
  diagram — only `system` + actors, neither carries a `path`), so a percentage of "how much of the
  repo is named" is always ~0% and meaningless. `BUILTIN_TYPES["c1"].addons["coverage"]` is now
  `False` (`registry.py`), so `.coverage` on `/c1/context` is always `None` for C1, and
  `check_diagram.py`/`bridge/inspect.py`'s `COVERAGE` finding can no longer fire for it
  (`CheckConfig.coverage_source` unset). The mechanism below is unchanged and still real — it still
  runs for a hand-decomposed legacy `c1.json` if a future type re-enables `addons.coverage`, and for
  any other type that opts in — it simply has no live C1 caller today.
- The `.coverage` field of `GET /repos/{id}/c1/context` (037's unified context envelope,
  [`diagram-skills.md`](diagram-skills.md); the old standalone `GET /repos/{id}/c1/coverage` route
  is 🔴 deleted) — backed by `coverage.coverage_report` (renamed from `c1_coverage.py`, since there
  is no c1-specific logic left in it; `addons.coverage` is the flag that turns it on, C1's own now
  `False` per the note above) — adds the **file counts** behind those subtrees: `total_files`,
  `covered_files`, `percent` and a `file_count` per entry. It reads the same `_FileTree` sweep, so
  the counts are a flat pass
  over `file_paths` rather than a second traversal — measured 1.0 ms against this repo's 15.9k-node
  graph, with `uncovered_roots` at 0.6 ms.
  🔴 **The two entry points are scoped differently on purpose.** `uncovered_roots` stays whole-repo,
  because it feeds the canvas and reachability is the promise. `coverage_report` drops
  **dot-directories** (`.idea`, `.claude`, `.github`, `.specify`, …) from `total_files`,
  `covered_files` *and* `entries`, because it feeds a percentage an agent is judged against and
  nobody should ever spend an architecture block on IDE config. Both sides are dropped together, so
  the entries still sum to `unmapped_files`. `.idea` therefore stays expandable on the canvas while
  contributing nothing to the score. Pinned by
  `test_a_dot_directory_{is_scored_out_of_the_report_on_both_sides,stays_reachable_on_the_canvas}`.
  🔴 `covered_files` classifies every file against the authored paths
  directly — **not** by subtracting the entry list, because `MAX_UNMAPPED_ROOTS` can truncate that
  list and the percentage would then silently read high. That cap is 200 and is a runaway guard, not a
  display budget: this repo alone yields 23 entries against two authored blocks, because descending
  into a partially covered directory lists its loose files one by one (`web/src` covered ⇒ `web/e2e`,
  `web/scripts`, `web/package.json`, … each its own entry). Rows only render once the block is opened.
  ⚠ `percent` is **floored, not rounded** — 417 of 418 files must read 99%, never 100%.
  ⚠ `has_diagram` is not redundant with a 0% reading: with no c1.json the bridge honestly reports
  every file as unmapped, and "you haven't drawn one yet" must not render as "your diagram misses
  everything". Every consumer gates on it.
- Two consumers of the coverage data. 🔴 **`C1CoverageNote`/`useC1Coverage` are deleted (037)** —
  **`SidecarSummaryCard`** (`canvas/doc/SidecarSummaryCard.tsx`, via `useSidecar("coverage")`,
  reading `EngineClient.getSidecar`'s unwrapped `.coverage` field) renders the same
  `.c1-coverage-note` line now, generalized so any type opting into `addons.coverage` gets it for
  free. 🔴 **RootCanvas mounts it beside
  `.fit-all-button`, outside `CanvasViewport` — not inside `C1View`.** `.canvas-content` carries the
  camera transform and sizes to fit its blocks, so an absolutely-positioned child of it zooms with
  the camera, and a `bottom`-anchored one slides further down every time a block is expanded.
  C1View's own overlays (`.c1-change-summary`, `.c1-empty-state`) live inside on purpose — they are
  draggable canvas furniture. This one is chrome. jsdom lays nothing out, so **no test can catch a
  regression here**; keep it a sibling of the viewport. It carries `role="status"`, since it appears
  asynchronously after the canvas has settled, and stays silent while `has_diagram` is false, while a
  generation run is in flight, and at full coverage. The hook returns `null` until the fetch answers
  (a seeded 100% would be indistinguishable from a genuinely covered repo), guards against
  out-of-order replies with a sequence number, dedupes by serialized value the way `useDiagram` does,
  and **keeps the last good answer when a fetch rejects** — the live bridge pings on every save, so
  overlapping fetches are the normal case. Second consumer, historical for C1: `check_diagram.py`'s
  `COVERAGE` finding, advisory and never blocking (it appends to `report.advisories`, so the script
  still exits 0) — it fires under 50% and names the biggest gaps, but counts tests, docs and
  examples the same as source, so a blocking gate would fail diagrams that name every line of real
  code. Since 042 turned off `addons.coverage`/`coverage_source` for C1 (see the note above), this
  finding can no longer fire for C1 at all — the description above is accurate for any other type
  that opts into `coverage_source`.
- ⚠ **Relationships are not boundary-only.** `relationships[].from`/`.to` may name **any** block, so
  the C1 view draws the internal call chain (handler → service → repository → adapter → actor), not
  just system↔actor arrows. `resolve_relationships` resolves each endpoint by **exact id trail first,
  then unambiguous bare id**, and annotates the edge with `from_node_id`/`to_node_id` (canvas ids,
  matching `c1DiagramClient.registerChild`) plus `scope`. 🔴 An unusable endpoint (unknown, ambiguous,
  self-referential) is tagged `scope: "unresolved"` with null node ids rather than **dropped** — the
  skill's `check_c1.py` reads the *resolved* payload, so a deleted edge would be an unreportable
  error. That is why `scope` has three values and not two. Because bare ids are addressable, a block
  `id` must now be unique across the whole diagram, and a repo path must have exactly one home —
  both enforced by `check_c1.py` (`DUPLICATE`, `DUPLICATE-PATH`), not by the resolver.
- Two arrow renderers, split by `scope`. `"box"` edges stay on `C1View`'s **dagre** path (geometry from
  dagre coordinates, drag-following, `fitKey`). `"internal"` edges go to
  `C1InternalConnections.tsx`, a **DOM-measured** overlay in the `ChangeConnectionsOverlay` mould
  (`getToLocal`/`useOverlaySvgRef`), because a sub-block is laid out by flow inside its box and has no
  dagre node. Internal edges are excluded from `layoutDiagram` so they can't distort box ranking. An
  endpoint inside a collapsed subtree bundles up the **id trail** to the nearest mounted block —
  string arithmetic, deliberately not `expansionStore.getNearestVisibleAncestor`, whose `parentLinks`
  only exist once children have been fetched — and an edge whose two ends bundle to the same block is
  dropped. ⚠ `getToLocal` now returns null when `getScreenCTM` is absent (jsdom), so mounting an
  overlay in a unit test that doesn't stub it degrades to "not measurable yet" instead of throwing.
- 🔴 **`C1View`'s box `ResizeObserver` is the only producer of `canvasLayoutStore` in the C1 view**, and
  it bumps on **every** delivery, deliberately outside the no-op size filter that guards `setSizes`.
  The asymmetry is the point: the filter keeps a drag from triggering a dagre relayout, but the
  DOM-measured internal arrows must re-measure even when a box's own border box is unchanged (rows
  reflowing inside a column already at `--block-max-width`). Only the box arrows are safe by
  construction — they are recomputed from dagre in the render body. Before this, `canvasLayoutStore`
  was **never** bumped here at all: `CanvasViewport`'s observer watches `.canvas-content`, whose comment
  states the premise "sizes to fit its content", which is false in C1 mode (`.c1-view` is
  `display: contents` and every descendant is `position: absolute`). The one bump that reached C1 was
  drag-settle — so expanding a block left every arrow on its pre-expand geometry until the user
  dragged a box, which is the bug that looked like "the arrows fix themselves if I move something".
  `useOverlaySvgRef` also re-measures over `OVERLAY_SETTLE_FRAMES` (4) rather than a single
  `requestAnimationFrame`, because rAF callbacks run *before* ResizeObserver delivery; the slower
  async window (a child fetch resolving) is the store's job, not the frame loop's. jsdom has no
  `ResizeObserver`, so the unit coverage stubs one (`C1View.test.tsx`, "C1View box measurement") and
  the real regression guard is `e2e/c1-view.spec.ts`'s no-drag expand test.
- A review delta and the arrow it annotates are matched on the **resolved node-id pair**, with the
  authored `from->to` pair as a fallback (`pairKeys` in `C1View`) — c1.json and c1-changes.json may
  spell the same endpoint as a bare id or a full trail, and an older bridge emits no node ids at all.
  `relationships[].technology` is now rendered, as `label [technology]` on both arrow kinds.
- 🔴 **Both renderers route through one shared module**, `canvas/connectors/orthogonalRoute.ts` — the
  whiteboard-style geometry, not a straight line between two centres. An arrow leaves and enters
  through a point on each side at a right angle (a `stub` before the first turn), turns in rounded
  elbows, and takes its own **lane** when other arrows already join the same pair: `assignLanes` groups
  by `pairKeyOf` (direction-insensitive, so A→B and B→A separate too) and spreads the group
  symmetrically, nudging the crossing segment. Without the lanes two relationships between the same
  two blocks drew as one stroke with their two captions stacked — which is the whole reason the module
  exists. `anchorOf`'s border point defaults to the side's midpoint but takes an arbitrary
  `laneOffset`, and `routeEdges.ts` (the shared lanes → router → map pipeline every view calls into)
  now feeds it a real one via `displacePorts` (per side edge), grouped by the exact box+side each
  endpoint resolves to through `chooseSides` — *not* by which pair the arrow joins. `chooseSides` is a
  single dominant-axis rule: it compares the centres' X/Y deltas and routes horizontally (left/right)
  when X dominates, vertically (top/bottom) otherwise — applied uniformly to adjacent, stacked, and
  diagonal placements. It deliberately has no separate gap threshold, so a box being dragged flips its
  sides only where the centres' deltas actually cross, never jitters on a moving gap boundary. `assignLanes` only
  ever separates two arrows on the *same* pair; a box with several unrelated arrows into one side (A→C
  and B→C both hitting C's left edge) used to funnel all of them onto that side's exact midpoint
  regardless, which read as arrows fusing at the box border even when the obstacle router kept their
  paths apart further out. `displacePorts` fixes that at the source: every arrow touching a given
  box+side gets its own point **stepped symmetrically out from the side's midpoint** by `portGap`
  each — an odd count leaves one arrow dead on the centre with the rest paired out either side, an
  even count sits entirely off-centre as symmetric pairs — hugging the middle and only pushing toward
  the corners on a genuinely crowded side (anchors clamp back onto the edge via `anchorOf`'s `sidePad`,
  so ports never run off the box). Port groups are keyed by the box's **stable id**
  when the caller supplies one (`routeEdges`'s `fromId`/`toId`, which `CanvasEdges` and the
  `ConnectionsOverlay` pipeline both pass) rather than by `rectKeyOf`'s rounded geometry — otherwise
  two overlays measuring the same box a frame apart (subpixel drift in `getBoundingClientRect` +
  transform) could round it to different sizes and split one box+side into two groups, each falling
  back to its own centre point and fusing the arrows at the border. The pool also mixes **both
  directions** of every arrow, not just like-sided ones: an arrow exiting a box's side and an arrow
  entering that same side were previously spread in separate from/to pools, so each saw itself as the
  only port there and both landed on the side's midpoint — one stroke out and one in, fused into one
  point on the edge. Grouping every port on a box+side together spreads exit and entry together too.
  Anchors clamp back onto the side
  (`sidePad`), so a short block's outer ports still land on it. Sides whose stubs face away from each
  other route **around** the nearer outer edge rather than doubling back through both boxes. `simplify` prunes duplicate and collinear corners, so a route that
  happens to be straight is one `L` segment (and every jsdom geometry assertion stays readable).
  `ConnectionsOverlay` (main canvas) uses the same router; the two panel overlays
  (`ChangeConnectionsOverlay`, `TraceFlowOverlay`) deliberately do not — a panel connector is a short
  leader line, not a diagram edge, and still anchors on the other endpoint's centre via
  `canvasOverlay.ts`'s simpler `borderSegment`, with no port spreading.
- 🔴 **`orthogonalRoute` is only a two-body solver — it sees the two rects it joins and nothing
  else.** `canvas/connectors/obstacleRouter.ts` wraps it with `createRouter({ obstacles })`, an A\*
  search over a local visibility grid that steers an arrow around every *other* box too. All five
  arrow renderers now go through it (`C1View`, `C1InternalConnections`, `ConnectionsOverlay`,
  `patternsGraphLayout`, `epicsLayout`), each passing the rects it already measures. Three rules to
  know before touching it: an arrow whose plain route crosses nothing keeps that exact geometry (so
  every `orthogonalRoute` test still describes what those arrows do); **an obstacle containing an
  endpoint's anchor is skipped for that route**, which is the only reason the nested-DOM hierarchy
  and C1-internal overlays can use it at all; and the returned router is *stateful across calls by
  design* — it charges later arrows for corridors earlier ones claimed, which is what separates
  arrows between *different* pairs whose paths cross further out (their border anchors are already
  separated by `assignPorts` before the search even starts).
  🔴 **Corridor separation needs all three pieces or two arrows from different pairs fuse into one
  stroke.** `finish` must claim a corridor for a *plain direct* arrow too, not only for an A\* path —
  otherwise a later clean arrow never sees the earlier one's lane; something must detect that a
  direct route runs along a *claimed* corridor (which `crossesAnyBox` cannot — it only checks boxes),
  so the arrow is sent into the A\* search at all; and `REUSE_PENALTY` must exceed the cost of
  stepping to a neighbouring free lane (two `TURN_PENALTY`s plus two short runs — more than 40,
  which is why 40 left the second arrow drawing on the first's exact stroke; 150 makes the detour
  the cheaper choice). Pinned by the "separates a later clean arrow from the exact lane an earlier
  one claimed" test.
  Build one per layout pass, call it in a stable order, throw it away. It degrades silently to plain
  `routeConnector` above 120 boxes, when no path exists, and when nothing is in the way.
  Tests: `connectors/obstacleRouter.test.ts`.
- Every arrow carries a background-coloured `.c1-relationship-casing` stroke under its own, and the
  edge SVGs sit at `z-index: 2` — above the boxes. A hidden arrow reads as a missing relationship,
  which is worse than one crossing a box; the casing keeps a crossing legible as one line over
  another. The casing dims with its stroke (`.c1-relationship--dimmed`), or it would punch an opaque
  hole through whichever arrow the highlight is trying to isolate.
- Captions go through `connectors/EdgeLabel.tsx`: `getBBox`-measured opaque chip behind the text
  (`.connector-label-chip`), replacing the old `paint-order: stroke` halo, since a label lands on a box
  or across another arrow's caption constantly. It degrades to bare text where `getBBox` is absent
  (jsdom), so a unit test needn't stub it. The label sits at the midpoint of the route's **longest**
  segment, so it clears the elbows.
- The canvas side is `web/src/engine-client/c1DiagramClient.ts`, a delegating `EngineClient` the
  `C1View` injects via a nested provider. Authored `children` win over a block's own `path` at every
  depth (that path is provenance plus the "+N more" source); an unresolved block renders with a ⚠
  note that **outranks** its authored description and a `block-unresolved` class. Note
  `.c1-node-anchor { width: max-content }` in `styles.css` is load-bearing — without it an
  absolutely-positioned box shrink-to-fits against `.canvas-content` and deep nested rows overflow
  onto the neighbouring box, swallowing its clicks. `C1View` only frames the diagram when the box
  set changes; following the block the user then opens is already handled by `RootCanvas`'s
  expand/collapse auto-fit effect, which is not gated on the C1 recipe layer being present.
- **Only the system/actor boxes are boxes**, and a box's interior is **architecture blocks only** —
  authored sub-blocks, `+N more` and ghosts, as one continuous indented tree.
  🔴 STALE (found during 034 dead-code cleanup, not fixed there -- needs its own investigation): the
  rest of this bullet describes a `C1DiagramClient.codeBoundaryTarget`/`bridgeIds`/`unmappedIds`/
  `C1InspectorContext` redirect mechanism that no longer exists anywhere in the code
  (`useNodeChrome.ts`'s `toggleExpand` no longer references any of these names) -- a leftover from
  before `C1DiagramClient`/`C1View` were removed. What currently handles the code boundary, if
  anything does, hasn't been re-derived here yet.

  The real `dir::`/`component::`/`class::`/`function::` hierarchy is **not** in there any more: at
  the **code boundary** a block hands off to `canvas/InspectorPanel.tsx`, a full-height right dock
  (30vw, draggable to 50%). A box that grew a folder tree inside it re-ranked dagre around its new
  measured size, which moved every other box and dragged the relationship arrows with it. ⚠
  `childRefs` is checked **first**, mirroring
  `getChildren`'s own precedence: the review attaches a ghost to a block that may already be a bridged
  leaf, and a ghost is the only place a removed block is ever named, so it must keep expanding in
  place. Consequence: inline code vanished from the C1 tree with no code deleted — the `c1-*` refs
  carry no `source`, so `chrome.hasCode` was already false for them. `InspectorChangeReview`
  stays inline (it annotates the block, not a file — `C1PlanPanel` did too, before the Plan overlay's
  retirement); `CodeView`/`DiffView` render in the panel, and a
  level with both source and children shows its child list behind a Show File/Class toggle so neither
  shadows the other. Panel rows carry `data-inspector-node-id`, not `data-node-id`, because the canvas
  overlays resolve arrow endpoints with a document-wide `[data-node-id]` query and a match outside
  `.canvas-content` would be measured in the wrong coordinate space. State is `canvas/inspectorStore.ts`
  (drill stack + the C1 client, which `C1View` binds and drops on unmount).
  `C1View` passes `ChildRenderer={TreeNode}` to its two `Block`s;
  `Block` renders its children with that component instead of itself and swaps the 5-column grid for
  `.block-children-tree`. The prop is deliberately **not** propagated — the switch happens once and
  `TreeNode` recurses into itself from there, so the main canvas is untouched. This is why a C1
  decomposition grows downward as an outline instead of sideways as a grid of 240px-min boxes.
  🔴 Two `TreeNode` details exist only for this: its root `onClick` **swallows without toggling**
  (a row expands from its label alone, but a click that escaped would reach the enclosing `Block`'s
  root and collapse the whole box — that's how a drag-end click on an inline code panel used to shut
  the box), and it renders `description` + the `block-unresolved` class, since an authored block's
  entire meaning lives in those two fields. It reuses the boxes' `block-unresolved` class name, as
  `changeClass` and `block-code-view--inline` already do; `styles.css` scopes the box treatment onto
  the label via `.tree-node.block-unresolved`.
- Generation: bootstrap is deliberately a **shallow skeleton** — since 043, a deterministic,
  always-on `generate_c1_template(digest)` call (`context/c1_template.py`), not a Claude call gated
  on `ANTHROPIC_API_KEY`. It reads `context-digest`'s already-computed `declared_dependencies` /
  `external_import_roots`, matches each candidate by exact string against the curated
  `KNOWN_EXTERNAL_SYSTEMS` table, and emits a `system` node plus one `external_system` actor (with a
  `system → actor` relation) per match — an unmatched dependency is simply omitted, never guessed.
  `declared_dependencies` (`context/digest.py`) reads `pyproject.toml`, `package.json`, and (046)
  `go.mod`'s `require` directives — a Go module's major-version path suffix (`/v9`) is stripped so
  versioned and unversioned import paths of the same library match the same table key;
  `KNOWN_EXTERNAL_SYSTEMS` carries Go module-path equivalents (`github.com/lib/pq`, etc.) alongside
  the Python/Node package names. `Cargo.toml`/`pom.xml`/other manifests are still not read.
  The output carries a top-level `"draft": true` marker (043 follow-up) so nothing downstream
  mistakes the unreviewed skeleton for a real diagram: `content_generators.py`'s
  `_has_valid_flat_diagram` (the shared `only_if_missing`/post-run validity check every skill-run
  kind uses) now also requires `not data.get("draft")`, so a draft-only `c1.json` doesn't block the
  interactive skill's own regenerate and a run that still leaves the marker set gets rolled back like
  any other invalid result. The marker disappears on its own: `type-c1.md`'s schema has no `draft`
  key, so the moment the interactive `codechroma-draw-diagram` skill (unchanged otherwise — still the
  richer, human-in-the-loop path for wiki-general/digest reconciliation, human actors, and quality
  descriptions) rewrites the file for real, the flag is gone. The depth used to come from a headless
  `claude -p`
  skill run (🔴 `c1_agent.py` deleted, 037 — `content_generators.py`'s
  `build_skill_agent_for(definition)` now builds it generically from `diagrams/registry.py`'s
  `BUILTIN_TYPES["c1"]`) on **haiku** (the shared
  `skill_agent_timeouts.model`) with a 600s timeout (`codechroma_C1_TIMEOUT_SECONDS`); it snapshots
  `c1.json` first and restores it on timeout, non-zero exit, or an unparseable result, and
  `agent.cancel()` in the lifespan kills in-flight runs so a restart can't orphan a `claude` still
  rewriting the file. This headless run is still the mechanism the Retry button drives — only its
  instructions changed (042): it now runs `type-c1.md`'s flat procedure, so the second write refines
  and spot-checks the bootstrap's actor list (wiki-general/digest reconciliation, the external-system
  test) rather than decomposing it into a deep tree. The skill still writes twice
  (bootstrap skeleton, then the reconciled result) so the `FileWatcher` shows the diagram updating, and
  self-checks via `.claude/skills/codechroma-draw-diagram/scripts/check_diagram.py --kind c1` (shipped into the analyzed repo by
  `skill_sync`'s `copytree`). 023-unified-recipe-converter closed the one gap C1 had against
  patterns/impact/custom: `--kind c1` now also reports `ORPHAN` for a leaf block or actor with no
  relationship to anything else (a grouping block with `children` is exempt even with none of its
  own) — same shape/severity tier as the other three kinds' own `ORPHAN` line, just previously never
  run for C1 at all. The run mechanics live in `bridge/skill_agent.py` (`SkillAgent`:
  snapshot/restore, per-repo-id job state, timeout, process registry). 🔴 `c1_agent.py`,
  `patterns_agent.py`, `impact_agent.py`, `custom_diagram_agent.py` and `c1_review_agent.py` are all
  deleted (037-total-diagram-unification, US1/US3) — `content_generators.py`'s
  `build_skill_agent_for(definition)` now builds every generate-side `SkillAgent` generically from a
  `DiagramTypeDefinition`, and `bridge/review.py`'s `build_review_agent(...)` does the same for the
  review side. One `cancel_skill_agents()` pass (each `agent.cancel()`) still kills them all, since
  every one is still a plain `SkillAgent`.
  🔴 A finished run drops its own task (`SkillAgent._forget_task`); without that, `cancel()` awaits a
  task from an already-closed loop and shutdown raises.
- 🔴 **Generation never starts on its own — only the user's explicit Retry click may start it.**
  `C1View` used to auto-start the skill the moment `GET /c1` answered empty (via a
  `useAutoGenerate` effect it shared with `PatternsView`); that meant opening the C1 view over a
  repo with no diagram file kicked off a multi-minute `claude -p` run with no human approval, which
  was a bug. The effect (and the shared `useAutoGenerate` hook) is gone: `retry` is a plain
  `() => generation.trigger()` wired only to the empty-state Retry button's `onClick`, mirroring
  `PatternsView`'s Generate button. Consequence to know: the bootstrap skeleton is no longer
  deepened by itself — ask the skill, click Retry, or delete `c1.json`. `_has_valid_diagram` is
  loose enough (`{"system": {}}` passes) that a file the bridge calls valid can still render empty,
  so Retry is deliberately unguarded rather than checking `has_diagram` client-side — a guarded
  button would be dead exactly where it's needed. The bridge-side `only_if_missing` backstop
  (`POST /c1/generate?only_if_missing=true`, via `SkillAgent.has_artifact`) still exists in the route for
  any future automatic caller, but nothing in the canvas passes it today.
- **The run is streamed**, so a 600s job isn't a static label. `SkillAgent` asks for
  `--output-format stream-json --verbose` and reads stdout **line by line** (no `communicate()`),
  rendering each event to one progress line via `bridge/skill_output.py` `render_event` — a
  **whitelist** (`assistant` text/`tool_use`/`thinking`, failed `tool_result`s, the final `result`),
  because the
  stream is mostly noise: hook lifecycle events, an init manifest, a `thinking_tokens` event every
  few tokens. Reasoning blocks render collapsed to one line so the feed shows what the agent is
  chewing on, not just the tools it calls. Lines go into a 300-line `deque` per repo id, cleared per run and readable afterwards
  (`GET /repos/{id}/c1/output`, `…/c1-changes/output`), and are pushed as **batches on a 150ms tick**
  (`{"type":"c1-output"|"c1-changes-output","lines":[…]}`) — never per line, since
  `ConnectionManager.broadcast` fans out to every connected canvas with no backpressure. 🔴 Three
  consequences of streaming rather than buffering: `create_subprocess_exec` needs an explicit
  `limit=` (asyncio's default 64 KiB line cap is smaller than a real `tool_result`, and an over-limit
  line is dropped, not fatal); the timeout is now
  `wait_for(gather(readers, proc.wait()))`; and `_failure_message` can no longer quote stdout (it's
  JSON now), so it prefers stderr and falls back to the **last rendered lines**. Canvas side:
  `state/useSkillOutput.ts` (catch-up read + subscribe, cleared on the `→ generating` transition) and
  `canvas/SkillOutputFeed.tsx`, a read-only log rendered **in the same spot as the old
  "Generating C1 diagram…" text** — deliberately not an xterm (no ANSI to interpret, and
  `useXtermSession` unconditionally wires `term.onData` and resizes its session, both wrong for a
  passive viewer). ⚠ Boxes stay hidden for the whole run now, even after the skill's early skeleton
  write lands — showing that partial content read as a stale/incomplete diagram (same call for
  Patterns, whose old `patterns-draft-banner` badge is gone for the same reason), so `isGenerating`
  gates both C1View's and PatternsView's box rendering and `fitKey` targets only the status panel
  (`"c1-status"`) until the run's `state` leaves `"generating"`. Its `wheel` listener is
  **native and non-passive** so scrolling the log doesn't reach `CanvasViewport`'s zoom handler. The
  review run gets the same feed inside `C1ChangeSummary`. Both generating panels (the diagram's and
  the review's) carry a **Stop** button — `generation.stop()` / `review.stop()` hit the shared
  `POST /repos/{id}/c1/cancel` or `…/c1-changes/cancel` route, which kills the `claude` process,
  rolls the artifact back, resets the job to idle and pings `c1-status`/`c1-changes-status` so every
  canvas drops the panel (see `graph-bridge-core.md`). Tests:
  `tests/unit/test_skill_output.py`, `tests/unit/test_skill_agent_stream.py`,
  `tests/unit/test_bridge_c1_output_route.py` (all sharing `tests/unit/fake_claude.py`, whose fake
  process exposes real `StreamReader`s because `communicate()` is gone),
  `web/src/state/useSkillOutput.test.ts`, `web/src/canvas/SkillOutputFeed.test.tsx`.
  ⚠ Every `c1-changes`/`c1-status`/`C1ChangeSummary` mention above is pre-038: the review's own
  generate/status/output/cancel routes and feed are `impact-changes`/`impact-status` now, rendered
  inside `ImpactChangeSummary` — see [`diagram-skills.md`](diagram-skills.md)'s "The one review flow".
  The diagram's own (non-review) `c1`/`c1-status` generate routes are unaffected.
- **C1 change review — moved to Impact, 038 follow-up.** This diagram no longer has a review axis
  at all: `c1`'s `review` is `None`, `GET /repos/{id}/c1/review` 404s, and the deterministic
  "changes" overlay (badges from git) now targets `impact`'s boxes instead of C1's. The reason: impact
  boxes already carry a real `node_id`, so attribution is a direct lookup plus an ancestor walk
  through the actual graph, not C1's old longest-path-prefix match against hand-authored blocks — see
  [`diagram-skills.md`](diagram-skills.md)'s "The one review flow" section for the current
  mechanism, schema, routes and tests. Everything below this file previously described about
  `useC1ChangeReview`/`c1ChangesStore`/`C1ChangeSummary` is gone; the deterministic per-block
  badge/status accent (`hierarchyChangesStore`, independent of any diagram) is the only change-review
  chrome C1 still carries — see [`change-cards.md`](change-cards.md).
- 🔴 **The client is keyed by diagram kind, not one method family per kind.** `EngineClient` exposes
  `getDiagram(kind)` / `getDiagramLayout` / `saveDiagramLayout` / `generateDiagram` /
  `getDiagramStatus` / `getDiagramOutput` and the three `subscribeDiagram*`, where `DiagramKind` is
  `"c1" | "patterns"` and `SkillRunKind` adds `"impact-changes"` for the generate/status/output trio the
  bridge registers through the same route factory. It used to be 26 per-kind methods (`getC1`,
  `getPatterns`, `saveC1Layout`, `subscribePatternsOutput`, …) on a 40-method interface, each
  re-typed in `DelegatingEngineClient`, `mockBridge` and two stub objects — so a third view cost ~40
  lines across four files before any feature code. `useDiagram(client, kind, …)` and
  `useDiagramGeneration(client, kind)` take the kind too; `useSkillOutput` used to fan its `kind`
  argument back out through a ternary chain into hardcoded method names, and no longer does.
  `getC1Changes` and `getC1Plan` are both gone now — the former because C1's review axis moved to
  Impact (its payload comes through the generic sidecar route instead), the latter because the Plan
  overlay was retired.
- Tests that hand-build an `EngineClient` stub spread `IMPACT_CHANGES_STUB` / `DIAGRAM_STUB`
  (`web/src/engine-client/stubEngineClient.ts`) for the review slice and the agent event channel, so
  adding a method to either doesn't mean editing nine test files. `diagramStub({c1|patterns})` is the
  `getDiagram` stub helper — a test answers concrete kinds where the interface is generic.
