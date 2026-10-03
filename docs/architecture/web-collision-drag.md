# Collision avoidance & multi-select drag (`web/src/canvas/collision/`)

Part of [`web-canvas-shell.md`](web-canvas-shell.md)'s `src/canvas/` tree; split into its own file
given its size.

- **`collision/`** — draggable blocks don't overlap each other (feature 002). A block follows the
  cursor honestly, even straight over a neighbour; on release it settles into the nearest free spot,
  which a ghost outline has been previewing during the whole drag. `resolveDrop.ts` is the pure
  solver (inflate → early exit → MTV + edge-alignment candidates → deterministic sort → spiral
  fallback → honest `blocked: true`), `collisionStore.ts` the rectangle registry, and
  `useCollisionAvoidance.ts` wires both into `useDragOffset`'s two new **optional** hooks,
  `onPreview` (rAF-throttled) and `resolveFinal`. 🔴 Opting in is a call-site decision:
  `CodeView`/`CodePopup`/`DiffView` still call `useDragOffset()` bare and are meant to overlap — a
  code panel is a window over the map (`CodeView`/`DiffView` do this through the shared
  `usePanelDragResize.tsx` combinator now, which also carries the `PanelDragGrip`/
  `PanelResizeHandle` markup both used to duplicate; `CodePopup` still calls the bare hook
  directly). Participants today are the C1 box anchors, the Patterns view's nodes, the Epics view's
  work-item boxes, the hierarchy view's top-level System boxes (`TopLevelChildren.tsx`), `PlanPanel`
  and `C1ChangePanel`, and the one-canvas recipe boxes (`CanvasNodeBox`, solo drag only — its 2+
  multi-select group drag stays a free `useGroupDrag` move; see [`single-canvas.md`](single-canvas.md)),
  each a mover *and* an obstacle; boxes below the top level still use flow
  layout and are out of scope, and there is deliberately **no** bulk "Arrange" (it would move blocks the user never touched,
  with no undo) — existing overlaps in a saved `c1-layout.json` resolve as blocks get dragged.
  ⚠ Box placement staying manual is *why* edge routing is not: since nothing may reposition a box to
  make room for a line, the line has to go around the box instead. That is
  `connectors/obstacleRouter.ts` (see [`c1-diagram.md`](c1-diagram.md)), which reads box rects purely
  as obstacles and never writes a position — it is not a second, competing layout pass, and boxes are
  not participants in it the way they are in `collisionStore`.
  ⚠ `collision/constants.ts` is the single source for dagre's `nodesep`/`ranksep` too
  (`layoutDiagram` imports them), so the gap is anisotropic — `NODE_SEP` 60 on X, `RANK_SEP` 90 on
  Y — and a hand-dropped block lands in the auto layout's rhythm. The store divides
  `getBoundingClientRect` by the same `measureScale` the drag delta uses, freezes its rectangles for
  the gesture, and drops participants nested inside the dragged element (a panel lives inside a C1
  box, and a block must never be shoved out of its own ancestor). `DropGhost` is portalled into
  `.canvas-content` rather than rendered in place: the panels clip their overflow. On release the
  element gets a `SETTLE_MS` transition and `onEnd` fires on `transitionend` (with a timeout
  fallback, since it can fail to fire) so what reaches `c1-layout.json` is the corrected landing,
  then one `canvasLayoutStore` bump recomputes the arrows. ⚠ `useCollisionAvoidance` owns `onPreview`
  itself (it drives the ghost), so a caller that also needs the raw live offset — e.g.
  `CanvasNodeBox`, which pushes it into `dragOffsetStore` so the canvas arrows (and the group/diagram
  frames, `CanvasEdges`) keep following the block — reaches it through the hook's separate, synchronous
  `onLiveOffset` option instead, which fires on the same render clock the block's own `offset` moves on
  (unlike the rAF-throttled `onPreview` ghost solve, which would trail the box a frame behind).

  A second, independent drag mode sits alongside solo collision-avoidance: Miro-style multi-select
  + group drag. `state/selectionStore.ts` tracks the current selection (shift/ctrl-click toggle,
  Escape-clearable marquee-drag over empty canvas). ⚠ The marquee (`CanvasViewport.tsx`'s own
  `endMarquee`) matches candidates by a dedicated `data-select-id` attribute, NOT `data-node-id` —
  the latter is a different, focus/fit-only key (the engine node id, absent entirely on a synthetic
  C1 System/Actor box) that never matches what `selectionStore` actually keys a box by
  (`CanvasNodeBox` uses its own canvas-doc element id; a `selectable` `Block` uses the engine node
  id). Only an actual selectable participant renders `data-select-id` at all — `CanvasNodeBox.tsx`
  unconditionally, `Block.tsx` only when its own `selectable` prop is set — so a rubber-band drag
  can never sweep in a non-participant. Getting this wrong (matching on `data-node-id` instead) is
  what silently broke marquee-select for every C1/Patterns/Impact/Epic box: the query either found
  nothing (no node_id) or added an id `selectionStore`/`useIsSelected` never checked against, so
  nothing ever visibly selected despite `selectionStore` genuinely receiving a shift/ctrl-click
  toggle. `collision/useSelectionAwareDrag.ts` is the
  switch every draggable box above now goes through — if the dragged box is part of a multi-item
  selection it runs `collision/useGroupDrag.ts` instead of `useCollisionAvoidance`: a **free** group
  move (every other selected box gets the same pointer delta, zero collision solving), batched into
  one `onGroupCommit` at gesture end — deliberately the opposite of solo drag's
  settle-beside-a-neighbour behavior. C1's `DraggableAnchor` keeps
  its own copy since its dagre box id and canvas node id are separate namespaces, needing
  `useSelectionAwareDrag`'s `dragId`/`dragIdForSelectionId` remapping that the plain case doesn't.
  ⚠ The hierarchy's `useNodeChrome` (shared by `strategies/boxes/Block.tsx` and `TreeNode.tsx`,
  the latter used as a Block interior for e.g. the C1 view) used to wire shift/ctrl-click selection
  onto every node at every depth, using the same global `selectionStore` — even though only the
  top-level boxes `TopLevelChildren.tsx` renders are ever a real group-drag participant. That let a
  click anywhere in the tree/code view join `selectionStore`, visibly highlighting a non-participant
  row and polluting a real group drag with ids no drag ever moves. `useNodeChrome` now takes a
  `selectable` flag (default `false`); only
  `TopLevelChildren.tsx`'s `Block` instance passes `selectable` — every other node, at any depth in
  either strategy, ignores shift/ctrl-click's selection semantics entirely (falls through to its
  normal click action instead) and can never carry `block-selected`.

  Drags are undoable. `canvas/UndoManager.tsx` owns Ctrl/Cmd+Z (capture-phase keydown, no UI, mounted
  once in RootCanvas with `kinds={["hierarchy", "canvas"]}` — every `LayoutKind` with boxes actually
  draggable on the one canvas today), popping whichever of those kinds recorded the most recent
  commit (`state/undoStore.ts`'s `undoLatest`, comparing a monotonic sequence number across their
  stacks — hierarchy and canvas-doc boxes are both on screen at once, so one shortcut must undo
  whichever was genuinely touched last) and dispatching it as the `codechroma:undo` window event.
  `useSavedLayout`'s `commitMap` records the PRE-commit layout into `undoStore` for `"hierarchy"`;
  `canvas/doc/CanvasNodeBox.tsx`'s `commitPositions` does the same for `"canvas"` (see
  [`single-canvas.md`](single-canvas.md)'s "Group-drag jump / click-to-deselect / undo fixes" section)
  — both a module-global store, NOT `registerWorkspaceStore`, so switching views/diagrams/workspaces
  does not clear it; one 10-entry stack per `LayoutKind`, `Reset`-able only in tests. Undoing restores
  that prior map via `applyMap`/`applyCanvasPositions` (the persist+writes path minus the history
  write, so a restore never re-records itself). A group drag undoes as one action; a mount-time
  resync that leaves the map unchanged records nothing.

  Tests: `collision/resolveDrop.test.ts`, `collision/collisionStore.test.ts`,
  `collision/useGroupDrag.test.tsx`, `state/selectionStore.test.ts`, the collision/ghost/landing
  blocks in `C1View.test.tsx`, `PlanPanel.test.tsx`, `web/e2e/block-collision.spec.ts` and
  `web/e2e/multi-select.spec.ts`; the undo wiring in `canvas/UndoManager.test.tsx`, `state/undoStore.test.ts`
  and the record/restore tests in `canvas/useSavedLayoutAndFitLoop.test.ts`. `CanvasNodeBox`'s own
  simpler drag path (it doesn't go through `useSelectionAwareDrag`, just `collision/useGroupDrag.ts`
  directly — see [`single-canvas.md`](single-canvas.md)) has its own coverage in
  `canvas/doc/CanvasNodeBox.test.tsx`'s "group drag" describe block, plus click-to-deselect coverage
  in `CanvasViewport.test.tsx` and `canvas/doc/NoteElement.test.tsx`.
