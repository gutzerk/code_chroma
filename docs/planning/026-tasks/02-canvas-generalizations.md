# 026 task 02: generalize the route features' hooks into shared canvas mechanisms

Status: 2a-2e done (2e was done before its trigger, as `displayPipeline.ts`; 2d was done before its trigger, as a registry that includes the always-on route probe). Parent plan: `docs/planning/026-diagram-expand-and-route.md`. Branch base: PR #317 (`feat/diagram-board-styles`).

This is a redesign, not cleanup. Each sub-task below can ship alone; none changes what the user sees. Do them only when the trigger named in each section appears (a second consumer), otherwise they are premature. Keep every change behaviour-preserving and covered by the existing tests listed.

## 2a. Failures lane as data, not a reserved name

Now: the lane name "Failures" is hard-coded.

- `web/src/canvas/connectors/elkLayout.ts`: `isFailuresLane` and `orderedLanes` (the Failures lane is always the last band).
- `web/src/canvas/doc/LaneArea.tsx`: imports `isFailuresLane` from the layout engine only to add the class `canvas-lane-area-failures` (a UI component depends on the layout module).
- `web/src/styles.css`: `.canvas-lane-area-failures` tint.
- Authors write `lane: "Failures"` by convention (`skills/codechroma-draw-diagram/references/type-custom.md`, "Optional `route`").

Cost: any diagram using a lane called "Failures" is silently reordered and tinted; a step with `kind: failure` and no lane is not placed in it.

Change:
1. Add an optional `lane_kind` (`"normal" | "failure"`, default normal) per lane. Source it from the diagram: a top-level `lanes: [{ name, kind }]` list in the diagram JSON, or, for routes, derive it from the step `kind` (all steps of a lane are `failure`). The resolver (both bridges) stamps `meta.lane_kind` on each node; document in `diagram-skills.md`.
2. `LayoutBoxSpec` (`web/src/canvas/connectors/diagramLayout.ts`) gains `laneKind`; `orderedLanes` sorts by it. `LaneArea` takes the class from `meta.lane_kind`, not from a name check. Delete `isFailuresLane`.
3. Keep case-insensitive "Failures" as a fallback only for diagrams without `lane_kind`, with a deprecation note.
4. Tests: `elkLayout.test.ts` (failure lane last when first seen, and for a non-"Failures" name), `LaneArea.test.tsx`, the bridge contract case for `lane_kind`.

Trigger: a second reserved lane (e.g. "Manual steps") or the first request to place `kind: failure` steps without a lane.

## 2b. Extract `RouteStepExtras` from `CanvasNodeBox`

Now: `web/src/canvas/doc/CanvasNodeBox.tsx` inlines the `▸ N calls` chip, the children list and the inspector call; every box (not only route steps) runs `routeStepOf` and `useIsRouteExpanded`.

Change: a small `RouteStepExtras` component (`web/src/canvas/doc/RouteStepExtras.tsx`) that receives `element` and the parsed step, owns `useIsRouteExpanded`, the chip and the list, and is mounted only when `routeStepOf(element)` exists. In `CanvasNodeBox` keep only `const routeStep = routeStepOf(element)` (cached) for the class name and `<RouteStepExtras .../>` in the header slot. Prefer reusing an existing footer/extras slot if the box has one (check `NodeMetaRow`/`canvas-node-box-foot` in `nodeAccent.tsx`); if the same chip is later needed for a "N members" chip, make the component generic (`ExpandableDetail`: label, items, onOpen).

Tests: move the cases from `RouteStepBox.test.tsx` to a `RouteStepExtras.test.tsx`; `CanvasNodeBox.test.tsx` must stay green.

Trigger: a second expandable box feature (members chip from 022) or any further growth of `CanvasNodeBox`.

## 2c. Header actions slot on `DiagramFrame`

Now: `web/src/canvas/doc/DiagramFrame.tsx` renders the sequence mode switch, the copy button, the route legend and the "Show route" button inside one `labelAction`, each with its own pointer-event guard (the label has `pointer-events: none`; wrappers such as `.canvas-diagram-frame-modes`, `.canvas-diagram-frame-copy`, `.canvas-diagram-frame-route` re-enable it).

Change: give the frame one `headerActions` slot that renders a list of `{ id, applies(members), render(layer, members) }` contributions inside a single pointer-enabled, drag-guarded wrapper. Move `SequenceModeSwitch` and a new `RouteFrameActions` (legend + Show route) into contributions; the copy button stays built in. Delete the three per-feature wrappers and their CSS.

Tests: `DiagramFrame.test.tsx`, `SequenceModes.test.tsx`, `e2e/route-steps.spec.ts` (Show route must stay clickable with a real pointer).

Trigger: the next diagram-specific control on the frame.

## 2d. Registry of canvas modes in `RootCanvas`

Now: `web/src/canvas/RootCanvas.tsx` wires trace, diff and route each as `isXActive` flag + overlay component + controls/card component (`TraceFlowOverlay`/`TraceControls`, `ChangeConnectionsOverlay`, `RouteOverlay`/`RouteCard`).

Change: a `CANVAS_MODES` array of `{ id, useActive(), Overlay?, Controls? }` and a single `.map` in the two mount points (inside `CanvasViewport` for overlays, inside `.canvas-stage` for controls). Keep render order as it is today (ConnectionsOverlay, change, trace, route probe, route, label clearance). Hooks must be called in a fixed order: call every mode's `useActive` unconditionally in a `useActiveModes()` hook.

Tests: `RootCanvas.test.tsx`; add one asserting that activating a mode mounts its overlay and controls.

Trigger: the fourth mode. At three, this is more indirection than it saves.

## 2e. Element-transform pipeline in `CanvasDocView`

Now: `web/src/canvas/doc/CanvasDocView.tsx` derives display elements in an ad-hoc chain: collapsed layers filter (`shownElements`), route expansion (`expandRouteElements`), live drag offsets (`visibleDoc`), sequence view geometry (`viewElements`). Ordering matters and is documented only by position in the file.

Change: a list of named stages `(elements, ctx) => elements` in `web/src/canvas/doc/displayPipeline.ts`, with the ordering rule written once (filter, then growth/pushing, then drag offsets, then per-layer view geometry) and unit tests that run the pipeline on a fixture and assert the order dependencies (e.g. an expanded step pushes a neighbour that is also being dragged). `CanvasDocView` calls the pipeline in one `useMemo` per stage group so unrelated store changes do not re-run everything.

Tests: new `displayPipeline.test.ts`; `CanvasDocView.test.tsx`, `routeExpansion.test.ts`, `canvasDocStoreLayout.test.ts` unchanged and green.

Trigger: a fifth transform, or a bug caused by stage ordering.

## Common acceptance for any of 2a-2e

- No visible change; `npx vitest run`, `npx tsc -b`, `npx eslint src --ext .ts,.tsx` (0 errors) and `npm run e2e -- e2e/route-steps.spec.ts` pass; 2a also needs both bridges and a shared contract case (`AGENTS.md`).
- Update `docs/architecture/web-canvas-shell.md` (and `diagram-skills.md` for 2a) in the same change.
- One-line comments only; Arrange-Act-Assert tests.
