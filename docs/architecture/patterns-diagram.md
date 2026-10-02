# Patterns diagram (`src/codechroma/bridge/patterns_*.py`) — the third top-level view, mirroring C1


> ⚠ **The skill that writes this diagram is no longer its own.** `codechroma-patterns` was merged
> into the one `codechroma-draw-diagram` router skill; its authoring rules now live in
> `references/type-patterns.md` and its self-check is `check_diagram.py --kind patterns`. See
> [`diagram-skills.md`](diagram-skills.md) for the router, the shared rules, the retire/prune
> pass, and the soft-diagnostics path this diagram's resolver now feeds.

⚠ **016-single-canvas-dashboard Stage 4 deleted `canvas/patterns/` (`PatternsView.tsx` and its box/
overlay chrome) along with the `CanvasView` union this file references below.** A pattern box now
renders through the one canvas's `CanvasNodeBox`, reached via the rail's `DrawDiagramButton`
("Design patterns"; `RecipeMenu` was its own dropdown before the diagram-management unification
shrank it to a single "Draw…" button — see [`diagram-skills.md`](diagram-skills.md)). The detector
and `patterns_resolver.py` are current; everything below about
`PatternsView.tsx` itself is historical.

⚠ **036-shared-diagram-style-catalog then replaced `canvas/recipes.py`'s `patterns_reshape`** (the
bridge onto the one canvas this note used to point at) **with one shared `reshape()`** every diagram
kind now goes through, and flattened `patterns_resolver.py`'s own output: there is no more top-level
`instances[]` key (see below), no `patterns[]`/`unconfirmed[]` split in the authored file, and no
nested `participants[]` — a pattern instance and its participants are flat `nodes[]` entries linked
by `parent`, same shared shape every other type now authors. See
[`diagram-skills.md`](diagram-skills.md)'s "036: one shared shape, one resolver, one render path".

The `"patterns"` member of the `CanvasView` union (see
[`web-canvas-shell.md`](web-canvas-shell.md)): a canvas showing
which GoF/architectural design patterns (Strategy, Facade, Adapter, Registry, Repository, plus
Singleton/Observer when present) are actually used in the analyzed repo, laid out as one connected,
dagre `compound: true`-clustered graph — the app's first use of dagre clustering — rather than
isolated per-instance cards, so a class playing a role in two patterns at once renders as one box
with edges into both clusters.

⚠ **v1 shipped, then was rebuilt.** The original confirmation step, `patterns/confirmer.py` + a
single synchronous `POST /patterns/confirm` batched call, could only rename the heuristic's own
fixed-rule candidates — it had no way to add an instance the rules missed, or author the plain
infra/external context (entry point, router layer, database) that makes the view read as one system.
Both are gone, replaced by the same skill-agent generation model as C1:

- `patterns_context.py` — mirrors `context/digest.py`'s role for C1: builds the `{"classes": [...],
  "heuristic_candidates": [...]}` payload, registered as the `"patterns"` `ContextProvider`
  (`bridge/context_providers.py`, 037) and served as the `generation_data` field of
  `GET /repos/{id}/patterns/context` (the old standalone `/patterns-context` route is 🔴 deleted).
- 🔴 `patterns_agent.py` is deleted (037) — `content_generators.py`'s `build_skill_agent_for`
  builds the same `SkillAgent` generically from `diagrams/registry.py`'s `BUILTIN_TYPES["patterns"]`,
  driving `.claude/skills/codechroma-draw-diagram/references/type-patterns.md`, which reads
  `/patterns/context` and `/structure`, writes to the path from `GET /repos/{id}/patterns-path`, and
  self-checks via `.claude/skills/codechroma-draw-diagram/scripts/check_diagram.py --kind patterns` — the same validation
  vocabulary as c1's own kind (`BROKEN`/`DUPLICATE`/`DANGLING`/`SELF`/`ORPHAN`/`ISLAND`) plus
  patterns-specific `SPARSE` and `UNREVIEWED`.
- **Wiki-first (029-wiki-driven-diagrams, plus 049's wiki-general step ahead of it):**
  `type-patterns.md` follows `docs/architecture/diagram-skills.md`'s "Wiki-first fetch order" before
  `/patterns/context`'s per-class detail — Step 0 (`GET /repos/{id}/wiki-general-context`) for the
  system/container-level narrative, then Step 1 (`GET /repos/{id}/wiki-context?paths=...`, unchanged
  since 029) for a class's file page when the repo already has the older wiki; `/patterns/context`
  remains the source of truth for any path neither step covers, or the whole run with neither wiki.
  `patterns_resolver.py`'s fingerprint/`stale` logic is unchanged — it already derives from the same
  graph state `sync_wiki()` mirrors, so a wiki-driven graph change is already caught with no new code
  (`research.md` Decision 3 of `specs/029-wiki-driven-diagrams/`); wiki-general carries no such
  fingerprint, so it isn't part of this staleness signal at all.
- 🔴 **A heuristic candidate the skill never addresses stays unconfirmed forever, no matter how
  many times the user clicks Confirm.** `patterns/detector.py` re-emits every candidate on every
  call regardless of the file; `PatternDiagramAdapter.to_shared_diagram` turns those candidates into
  the shared flat shape (one `kind: "pattern-instance"` node per instance, one participant node per
  member, `parent` set to its instance's id), and `patterns_resolver.py::_merge_patterns` only
  overlays a status when the instance's id has a matching entry in the persisted `patterns.json`'s
  `nodes[]` (no more separate `patterns[]`/`unconfirmed[]` arrays since 036 — every instance,
  confirmed or not, is just a node with `meta.confirmed`) — an id the skill simply omits (e.g. after
  deciding its sole participant is dead code) looks identical to one never reviewed.
  `_best_instance_match` joins by exact id first, then falls back to the persisted instance whose own
  participants overlap the most (by `node_id`) — so a readably-titled instance
  (`adapter::knowledge_clients`) still resolves against the detector's fully-qualified candidate id
  instead of lingering unconfirmed; a matched entry is never appended twice. `check_diagram.py --kind
  patterns`'s `UNREVIEWED <id>` check exists to catch this: it fails the self-check if any pattern-
  instance node still has `meta.confirmed` absent/null, forcing the skill to write an explicit
  `meta.confirmed: true`/`false` for every id it saw. The canvas side has a matching gap:
  `PatternsView.tsx`'s confirm banner (unlike its empty-state branch) didn't surface
  `generation.error`, so a failed background run looked identical to a no-op Confirm click — fixed by
  rendering the error inside the banner too.
- `patterns_resolver.py::resolve_patterns_diagram` — mirrors `overlays.py`'s `resolve_impact_changes`
  merge logic: combines
  the graph's always-fresh heuristic candidates with authored `.codechroma/patterns.json`, `stale` via
  the same fingerprint-comparison shape, then calls the shared `resolve_diagram()` (forcing
  `allow_self_relations: true` regardless of style — patterns has always allowed a self-relation,
  e.g. a recursive call) and filters any free-standing connective node outside `kind ∈
  {"infra", "external"}` as `unknown_kind`. 🔴 **With no authored file it still returns the heuristic
  candidate layer** — that layer is a live signal for the skill to confirm/reject, never a standalone
  rendering ("only the final version"), so `has_diagram` (not node count) is what gates the empty
  state.
- `context/patterns_generator.py` — the startup bootstrap's one Claude call confirming/rejecting
  each heuristic candidate (mirrors `c1_generator.py`'s role for C1); its model/token-cap and
  system/user prompts live in `config.py`/`prompts/patterns_generator.yaml`, not inline (see
  [`config-and-prompts.md`](config-and-prompts.md)).
- Registered through the same generic per-kind route factory as C1 (`generateDiagram`/
  `getDiagramStatus`/`getDiagramLayout`/`saveDiagramLayout` for `kind="patterns"`), plus its own
  `/patterns-path` route and the shared `/patterns/context` route (037's unified context envelope).

**Python and Go, both language-native.** `extract_class_shapes()` has one implementation per
language -- `python_analyzer.py` and `go_analyzer.py` -- dispatched by `engine.py` on
`analyzer.language`; both feed the same merged `Graph.class_shapes` dict, keyed by `symbol_id` with
no language tag needed (the original design doc, `docs/planning/004-design-patterns-go-support`, is
not present in this checkout). `ClassShape.kind`
(`"class"` | `"struct"` | `"interface"`, default `"class"`) is the one schema addition Go needed --
read only by `patterns/detector.py`'s structural interface-implements matching (`kind == "interface"`
shapes are treated as always-abstract, and their method-name set is matched against every struct's
`methods` by superset, since Go has no `implements` keyword) and by `_detect_singleton_go` (Go's
package-var-plus-`sync.Once` idiom has no class/method at its center, so it reads `GoAnalyzer.parse`'s
package-level `SymbolKind.VARIABLE` symbols -- emitted only for pointer-typed package vars -- plus a
sibling function's `sync.Once`/`.Do(...)` usage, rather than going through `ClassShape`/`MethodShape`
at all). The Once check is scoped to the specific variable, not just the module: a function only
counts as guarding a var if its `references` contain `"Do"` and its `assigned_identifiers` contain
the var's own name -- the latter a separate `Symbol` field (not `references`) populated by
`go_analyzer.py`'s `_collect_assigned_identifiers` walking every assignment target (including inside
a `once.Do(func() {...})` closure); kept out of `references` so a plain local variable assignment
never masquerades as a call-graph edge in `graph/builder.py::_resolve_symbol_edges` or the offline
summary text -- otherwise a second, unguarded package var in the same file would false-positive as a
Singleton too.
No bridge/frontend change was needed -- a struct/interface is just another `node_id`.

⚠ **Canvas-side note below predates 016-single-canvas-dashboard.** `PatternsView.tsx` and
`patternsGraphLayout.ts` no longer exist — 016 deleted the six dedicated views (C1, Patterns,
Epics, Impact, Custom, hierarchy-only) in favor of `RootCanvas` rendering the one `CanvasDocView`
unconditionally (see [`single-canvas.md`](single-canvas.md)). Patterns now reaches the canvas
through the `pattern` recipe (`DrawDiagramButton` → `runRecipeAndLayout` → `autoLayout.ts`'s
`layoutNewElements()` → `diagramLayout.ts`'s `layoutBoxes()` → `layeredLayout.ts`'s
`computeLayeredLayout()`, the shared direction-aware layered layout every diagram type now uses
(051-directed-layered-diagram-layout) — see [`web-canvas-shell.md`](web-canvas-shell.md)'s
`connectors/` section). The component names below
(`PatternNodeBox`, `PatternsLegend.tsx`, the dagre-specific drag-position note) describe that
removed architecture; treat this section as historical until it's rewritten against the current
`canvas/doc/` rendering path.

Canvas side (historical, pre-016): `PatternsView.tsx`, `patternsGraphLayout.ts` (the compound-cluster dagre layout,
resize-driven via the shared `canvas/useMeasuredSizes.ts` hook — same one C1View and
`TopLevelChildren` use, minus the `onResize`/`canvasLayoutStore` bump since Patterns has no
DOM-measured overlay to notify). Each `PatternNodeBox` also renders the Diff layer's inline code
diff exactly as the hierarchy does: it reads `useDiff(nodeId)` (a pattern node id already IS a real
hierarchy node id) and mounts `DiffView` beside `ChangeCardsPanel` when a diff entry exists —
so a class whose card `withoutDiffedNodes` drops as a duplicate still shows the added/removed lines
(see [`change-cards.md`](change-cards.md)). No
`ANTHROPIC_API_KEY` → heuristic-only candidates still render, dashed/unconfirmed, never an error.
Reuses C1's shared machinery rather than reinventing it: `useSelectionAwareDrag` for node dragging,
`useSavedLayoutAndFitLoop`'s `useSavedLayout`/`useFrameFit` for persisted layout + fit-on-activation,
`obstacleRouter.ts`/`orthogonalRoute.ts`/`EdgeLabel.tsx` for arrows. `isGenerating` gates box
rendering the same way it does for C1 (see [`c1-diagram.md`](c1-diagram.md)'s "The run is streamed"
note). While `isGenerating` the panel carries a **Stop** button — `generation.stop()` hits the shared
`POST /repos/{id}/patterns/cancel` route (see `graph-bridge-core.md`), killing the run and resetting
the job to idle so the view returns to its pre-run affordance.

🔴 **Only the final version renders** — this view never shows a heuristic-only diagram. Without an
authored `patterns.json` (no Generate click yet, or no `ANTHROPIC_API_KEY`), `resolve_patterns_diagram`
still surfaces the heuristic candidates as ordinary `nodes[]` entries (that layer is the live signal
the skill confirms/rejects — see above; there is no separate top-level `instances[]` key since 036),
but `has_diagram` is `false`, so `PatternsView` gates on it and shows the empty state + Generate
button. A file that still carries an unconfirmed candidate (`meta.confirmed` absent/null — e.g. the
startup bootstrap couldn't finish) isn't final either: `PatternsView` gates box rendering on
`fullyResolved = hasDiagram && every(confirmed !== null)`, so it shows the Confirm banner instead
of dashed half-reviewed boxes until the skill resolves every candidate (`check_diagram.py --kind
patterns`'s `UNREVIEWED` gate). The heuristic candidate layer stays as the live signal the run
confirms/rejects, but it is never rendered standalone. Tests: `tests/unit/test_patterns_resolver.py`,
`tests/unit/test_patterns_check_script.py`, `web/e2e/patterns-view.spec.ts`.

**Readability of a dense diagram.** Once a repo has more than a handful of instances, the limiting
factor stops being what the diagram *says* and becomes whether you can follow one line across it.
Four things address that, three of them shared with every other arrow-drawing view (see
[`web-canvas-shell.md`](web-canvas-shell.md)'s `connectors/` section for the router itself):

- **Arrows route around boxes.** `patternsGraphLayout.ts` builds one
  `createRouter({ obstacles: [...rectByKey.values()] })` per layout pass and calls it in deduped
  relation order. Every box is an obstacle for every arrow it isn't attached to, so a relationship
  no longer disappears behind an unrelated participant, and the router's corridor bookkeeping keeps
  two arrows sharing a lane from drawing as one. Regression tests live in that file's
  "obstacle-aware edge routing" describe block — 🔴 both assert on *segments*, not on the path's own
  vertices: a straight line through a box has no vertex inside it, so a vertex-based check passes
  for exactly the case it exists to catch. Verified end-to-end by `patterns-view.spec.ts`'s "no
  relationship arrow runs through a box it is not attached to", which measures the real browser
  layout rather than a hand-made one.
- **Arrows paint above the boxes** (`.patterns-relationships` was `z-index: 2`, over
  `.pattern-node-box`'s 1 and `.cluster-halo`'s 0 — those rules are gone with the view) and each carried a background-coloured
  `.c1-relationship-casing` stroke under its own. An arrow hidden under a box reads as a missing
  relationship, which is worse than one crossing a box; the casing is what makes a crossing read as
  one line passing over another instead of an ambiguous X.
- **Colour per relation kind**, not just the hollow-vs-filled arrowhead: `PatternConnections.tsx`
  emits one `<marker>` per `PatternRelationKind` and stacks a `--kind-*` class onto the stroke.
  ⚠ A `<marker>`'s contents render outside the referencing path's cascade, so the arrowhead colour
  is set with `color` on the marker's own path, not inherited. `PatternsLegend.tsx` names the
  colours actually drawn — 🔴 it portals into `.canvas-stage`, because `.canvas-content` carries the
  pan/zoom `transform` and a transform is a containing block for `position: fixed` too, so nothing
  rendered inside it can stay pinned to the viewport.
- **Focus.** `hoveredEdgeStore` gained two focus sources beyond the hovered arrow: `setFocusedNode`
  (hovering a box lights up its own arrows and dims the rest — `PatternNodeBox`'s pointer
  enter/leave) and `setPinnedNodes` (the same, persisted, synced from `selectionStore` by
  `PatternsView`). ⚠ The caller owns the id space for `setPinnedNodes` — a Patterns node id *is* its
  arrow endpoint id, which is why only this view syncs it; a C1 box id is not. `PatternNodeBox`
  builds its class list by hand rather than through `useNodeChrome`, so it opts into the shared
  `.node-edge-endpoint` accent explicitly.

🔴 **A saved/dragged box position is stored as an ABSOLUTE dagre-space coordinate, never as a delta
on top of dagre's raw output** — this is deliberate, and getting it backwards is the exact bug this
note exists to stop from recurring. dagre re-solves the *whole* graph from scratch on every
`layoutPatterns`/`computePatternNodes` call — it is not incremental — so a node's raw `(x, y)` can
shift for a reason that has nothing to do with that node: `sizes` starts empty, so the very first
layout pass after mount uses `DEFAULT_NODE_SIZE` for every box, then reflows once
`useMeasuredSizes`' `ResizeObserver` reports real sizes a frame later; a live reanalyze adding a
class, or a Confirm run adding an instance, reflows it again. Before the fix, `.codechroma/patterns-
layout.json` stored a pixel delta added to whatever the raw position happened to be *that render* —
so a placed box visibly drifted (and its arrows, correctly attached to that same drifted spot, read
as pointing into empty space relative to where the box belonged) every time something unrelated
caused a relayout; dragging it again only bought a fix until the next reflow. The fix:
`PatternsView.tsx` computes this render's raw positions via `computePatternNodes` (the same dagre
solve `layoutPatterns` runs internally, exposed separately for this reason), converts the absolute
positions it reads from/writes to the layout API into the delta `PatternNodeBox`'s drag hooks and
`layoutPatterns`' own offset-rect helper actually consume — `delta = absolute - currentRaw`, recomputed
fresh every render — so `raw + delta` always equals the fixed absolute target no matter how `raw`
moves around underneath it. One trap to keep in mind if this area changes again:
`useSelectionAwareDrag` resyncs its own local offset into `onOffsetChange` unconditionally on every
box's mount (harmless under the old delta model — a `{0, 0}` delta was a no-op) — under absolute
semantics this would silently anchor every *untouched* box to whatever raw position it had at that
first, possibly-still-`DEFAULT_NODE_SIZE`-based render, forever; `PatternsView.tsx`'s
`isUnmovedMountSync` guard exists specifically to filter that mount-time `{0, 0}`-with-no-prior-entry
call out, so only an actual user drag (or a restored prior-session position) ever creates an anchor.
Regression test: `PatternsView.test.tsx`'s "PatternsView position stability across a relayout"
describe block.

**A context box can bind to several real nodes, opened as Inspector tabs.** An authored infra box
that collapses several classes (the skill's "Merging" rule) carries `node_ids[]` on the
`PatternsContextNode` in addition to the primary `node_id`; the resolver passes both through
verbatim, and `patternsGraphLayout.ts` exposes them as `PatternNodeLayout.nodeIds`
(`node.node_ids ?? [node.node_id]`, non-null entries only — an external/no-code box ends with an
empty list). `PatternNodeBox`'s click dispatches on that list: multiple nodes → `inspectorStore.openMany`
(one inspector level with a tab per node — `InspectorPanel`'s `InspectorGroupTabs` swaps the shown
`InspectorLevel`), a single node → flat `inspectorStore.open`, none → nothing. `openMany` is additive;
the drill stack treats the group as one `InspectorEntry` (synthetic `group::<firstId>` id), so back/
close work exactly as for a single node and C1's single-id path is untouched. `check_diagram.py
--kind patterns`'s BROKEN check accepts `node_ids` as satisfying a `path`-without-`node_id` node, so
a merged box is no longer falsely flagged.
