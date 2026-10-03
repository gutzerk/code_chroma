# Change cards (`src/codechroma/bridge/change_cards.py`) — the deterministic half of the Diff toggle

`GET /repos/{id}/change-cards` turns the same git diff into one card per changed symbol, each pinned
to the **nearest existing block** by `plan_resolver.resolve_target` — the same ladder `impact_context.py`
uses to resolve feature-spec seeds, so the two can never disagree about which block a `(file, symbol)`
belongs to. (An older, now-retired "Plan overlay" also shared this ladder — see below.) Several cards
on one block is the normal case and the point: two deleted methods both
resolve to their class node, and `by_node` is the count a collapsed parent badges with. Two passes:
`compute_function_diffs` for code, then `working_tree_status` for every changed path the analyzers
couldn't see (without it a Markdown-only PR renders an empty layer). The code pass also yields a
single whole-file `modified` card per changed present file (the file's own `component::` diff entry,
see `graph-bridge-core.md`), so a changed file's block reads `modified` rather than leaning on the
deleted-function aggregation. Paths under `engine.IGNORED_DIRS`
are dropped rather than reported — our own `graph.db` and `node_modules` are out of scope by design,
not changes we failed to place. 🔴 `base_resolved` exists because `working_tree_status` reports
*nothing* for an unreachable base, which would otherwise render as an honest-looking empty change set;
`unassigned` names a change whose resolved node isn't in the graph at all.

Canvas side: `changeCardStore` is an instance of the generic `state/cardStore.ts`'s `CardStore<T>`
class — built to be shared across card layers so none of them can silently lose a stable-`EMPTY` or a
geometry channel; a since-retired "Plan overlay" was the other instance this was proven against.
`ChangeCardsPanel` is a thin wrapper over `canvas/CardPanel.tsx` with a `CardLayer` descriptor; the
*inner* card classes (`plan-step`, `plan-step--<kind>`) keep their old names — CardPanel is shared
infrastructure that predates this feature being the only card layer left. 🔴 Both fetches (diff and
change-cards) live in `refreshDiffs`, which is also where the **dedupe** lives: a
card whose node already shows a full diff panel is dropped, so what survives is what a diff panel
can't carry (a changed class, a deleted symbol whose node is gone, a non-code file).

🔴 **`refreshDiffs`'s reveal is the expensive half, and it used to be unbounded.** It calls
`revealNode` once per diff entry *and* once per card, and `revealNode` walks the ancestor chain with
one `GET /nodes/{id}` per level — so N changed symbols at depth D cost N×D uncached requests, nearly
all of them re-fetching ancestors a sibling entry had already fetched, against a route that reads and
slices the source file per call (`routes/graph.py`'s `to_ref`). On a PR that storm never drained, and
Diff never finished. Two caches fix it: `refreshDiffs` builds one `NodeRefCache` per run and passes
it to every `revealNode` call so the batch shares in-flight lookups (a rejection evicts its own entry,
or every later reveal reuses the failure) — the now-retired Plan overlay's own toggle did the same for
its own batch, since cards in one file share ancestors just as diff entries do — and `revealNode` first tries
`expansionStore.getCachedAncestorPath(nodeId)`, which walks the `parentLinks` map every children
fetch already populates and costs **zero** requests on a re-reveal. ⚠ That reader returns the path
only when the chain is *provably* complete (it ends at `"root"` or a `null` parent) and `null` the
moment an id isn't cached — `parentLinks.get()` can't tell absent from root apart, so it uses `.has()`;
treating an absent id as the root would reveal the wrong chain.

🔴 **The live path coalesces, it does not cancel** (`scheduleRefreshDiffs`, same file). `refreshDiffs`
bails before `publish()` when its `signal` is aborted, and the reconciler in `useDiffToggle` used to
abort on every `liveVersion` bump — so under a ping stream (a flapping events
socket resyncing, an agent writing files, a big PR) no run ever reached `publish()` and the diff layer
never landed at all. The scheduler keeps one run in flight and queues at most one trailing rerun, which
bounds a whole storm to two runs and guarantees the last one publishes. `useAcceptDiff` goes through it
too, so its own post-commit refresh and the live `changed` broadcast collapse into one run instead of
racing. 🔴 Its single-flight state lives on a small `RefreshScheduler` object enrolled via
`createStore.ts`'s `registerWorkspaceStore()`, so `resetWorkspaceStores()` clears it on a workspace
switch exactly as it clears every `Store`. Without that, a switch mid-run left the old `EngineClient`
owning the flag and the queued rerun fired against the workspace the user had just left, publishing
its diffs into the shared stores. `RefreshScheduler.claim()` hands each run an
`AbortController`, and `reset()` aborts it: a run that loses the slot stops fetching *and* bails
before `publish()`, instead of writing a departed workspace's diffs into the shared stores. The same
ownership test (`scheduler.runningFor === engineClient`) gates the `.finally` cleanup, so a run
finishing late can't clear a slot a newer run has already taken. `resetRefreshDiffs()` is that same
reset, also called directly for test isolation.

The connector
overlay is `ChangeConnectionsOverlay`, the parameterized component in `ChangeConnectionsOverlay.tsx`
(renamed from `PlanConnectionsOverlay.tsx` once the Plan overlay's own sibling instance,
`PlanConnectionsOverlay`, was retired — a connector's React key is its node id, so a shared single
instance querying both selectors would have emitted two children with the same key and silently
dropped one, hence why the file used to export two parameterized instances rather than one). ⚠ `styles.css`'s
`:has(.change-cards-panel)` header rule keeps the header from stretching so a card frame hugs the
block instead of ballooning.

**Block recoloring, not just a card.** `by_node_status` in the same payload folds all of a node's
cards into one added/modified/removed status (`_by_node_status`, mirroring `c1_changes.py`'s
`_status_for` tie-break: a node whose cards agree keeps that word, a mixed set collapses to
`modified`) — the plain hierarchy view's counterpart to the C1 view's per-block border accent, using
the same `block-change--{added,modified,removed}` CSS. It is computed from every card, including one
`withoutDiffedNodes` later drops for display (so a block still recolors even when its own card was
dropped because a full diff panel already covers it). ⚠ `PatternNodeBox.tsx` — which read
`hierarchyChangesStore` *and* `diffOverlayStore` per box and rendered `DiffView` inline when a diff
entry existed for its node, mirroring the hierarchy's `NodePanels` — was deleted by
016-single-canvas-dashboard Stage 4, and that inline-diff-on-dedupe behavior has **not** been ported
onto the one canvas's `CanvasNodeBox` (`nodeChrome.tsx`'s `NodeChangeBadge`/`DiffView` wiring only
reads `c1ChangesStore`, see `single-canvas.md`'s "C1's own chrome" section). A real,
currently-unfixed gap: a fully-diffed class whose card the dedupe drops (e.g. the mock's
`OrderRepository`) shows *nothing* for Diff — no card and no lines. Canvas side:
`state/hierarchyChangesStore.ts` (a plain `node_id -> status` map, no card list), published by
`refreshDiffs`'s `publish()` — populated from `by_node_status` and cleared when the route returns
none. (`refreshDiffs` used to carry `reveal`/`recolor` flags for the separate C1/Patterns views;
those views are gone, no call site ever passed anything but the defaults, and both parameters have
been deleted.) `strategies/useNodeChrome.ts`'s `changeClass` reads `c1ChangesStore` first and falls
back to this store, so `Block.tsx`/`TreeNode.tsx` need no changes — they already applied
`chrome.changeClass` unconditionally, just never had non-C1 data to render. No new route or workspace
special-casing was needed: `Workspace.diff_base()` already generalizes to a PR (see
[`pr-workspaces.md`](pr-workspaces.md)) or an agent branch exactly as it does for the cards
themselves. Tests: `tests/unit/test_change_cards.py`'s `by_node_status` cases,
`web/src/state/hierarchyChangesStore.test.ts`, `web/src/canvas/strategies/useNodeChrome.test.ts`,
`web/src/state/refreshDiffs.test.ts` (including the ancestor-cache and `scheduleRefreshDiffs`
coalescing cases), `web/src/state/expansionState.test.ts`'s `getCachedAncestorPath` cases,
`web/src/canvas/useDiffToggle.test.ts`'s cancel/snapshot-restore cases, `web/e2e/change-cards.spec.ts`'s
recolor cases.
