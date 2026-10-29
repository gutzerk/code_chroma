# 027 — Diagram profiles and a size guard for copied CSS metrics

Status: Done

Follow-up to PR #331 (walkthrough B2, sequence A4). Web only: no bridge, skill or JSON change.

## Goal

1. Shared canvas code stops naming diagram types (`walkthrough`, `sequence`). Each type describes its own behaviour in one registry entry (a **diagram profile**).
2. A change to box CSS can no longer silently break auto-layout: a test fails when the sizes TypeScript computes drift from what the browser draws.

Done means: adding a new board-style diagram type touches its own files plus one registry entry, and no `if (layer === ...)` is added to shared files.

## Out of scope

- Epics special cases (`isEpicsLayerName` in `CanvasNodeBox.tsx`, `measureBoxSize.ts`). Note them; move them only if it is trivial after Stage 2.
- Per-layer CSS in `styles.css` (`[data-layer="walkthrough"]` rules). Attribute selectors on the layer are fine; leave them.
- Any visual change. Every stage must be pixel-identical to today.
- The Avalonia canvas (`dotnet/CodeChroma.Canvas*`).

## Current special cases (the work list)

All paths are under `web/src/canvas/doc/`.

| File:line | Today | Profile field that replaces it |
|---|---|---|
| `CanvasEdges.tsx:30` | walkthrough `call`/`spawn` arrows use the `-route` marker | `edgeMarker(visual)` |
| `CanvasEdges.tsx:89` | walkthrough edges hide the kind word as a label | `edgeLabel(edge)` |
| `DiagramFrame.tsx:156-168` | sequence frame bounds come from `sequenceBoardBounds`; walkthrough bounds grow with `boundsWithWalkthroughPanel` | `frameBounds(base, ctx)` |
| `DiagramFrame.tsx:218` | `canvas-diagram-frame-sequence-board` class | `frameClassName` |
| `DiagramFrame.tsx:103-113` | `HEADER_ACTIONS` already a small registry (`applies`/`render`) | fold into `headerActions` on the profile, or keep and have profiles contribute to it |
| `CanvasDocView.tsx:221` | walkthrough layer gets no lane bands | `laneBands: false` |
| `CanvasDocView.tsx:276` | sequence elements skipped for concurrency islands | `concurrencyIslands: false` |
| `CanvasDocView.tsx:326-332` | `WalkthroughPanel` mounted for the walkthrough layer | `Overlay` component |
| `autoLayout.ts:45-46` | sequence ids laid out by `layoutSequence`, others by ELK | `layout(doc, ids)` |
| `CanvasNodeBox.tsx:114` | sequence (and epics) boxes skip the common box internals | `plainBox: true` |
| `RouteFrameActions.tsx:11` | walkthrough has no header legend | profile-owned, or leave inside the walkthrough's own component |

Re-run this to confirm the list before starting (it may have moved):

```bash
cd web/src && grep -rn -E 'WALKTHROUGH_LAYER|render === "sequence"|render !== "sequence"|isSequence' . \
  | grep -v -E '\.test\.|walkthroughLayout\.ts|sequenceBoard\.ts|SequenceDiagram\.tsx|SequenceStep\.tsx|WalkthroughPanel\.tsx|sequenceProfile\.ts|walkthroughProfile\.ts'
```

(The two `*Profile.ts` files were added to the exclusion list in Stage 2: they are type-owned, see "Outcome".)

## Stage 1 — Size guard (do first, smallest)

**Problem.** `measureBoxSize.ts` (`ROLE_PAD`, `ROLE_HEADER_ROW`, `ROLE_NAME_LINE`, `ROLE_DESC_ROW`, `ROLE_PATH_ROW`, `ROLE_MEMBERS_ROW`, ...) and `sequenceBoard.ts` (`SEQUENCE_BOARD`) copy pixel values from `styles.css`. jsdom does no CSS layout, so vitest cannot catch drift.

**Do.**
1. Add `web/e2e/box-size-guard.spec.ts` (Playwright, mock bridge, like the other specs; reuse `e2e/helpers.ts`).
2. Open a fixture with role boxes in these variants: name only; long name (2-3 lines); + description; + path; + `node_id` (members chip + SRC); + `order` (top band).
3. For each box compare `getBoundingClientRect().height` at 100% zoom with `layoutBoxSize(element)` for the same element. Tolerance: 2 px. Expose the computed value to the test the simplest way (e.g. a `data-layout-h` attribute in dev/test builds only, or import the function in the spec through Vite).
4. Do the same for one sequence board: step box size, lane height and an expanded step against `SEQUENCE_BOARD`.
5. Prove the guard works: temporarily change one CSS padding by 6 px, see the spec fail, revert. State this in the PR.

**Acceptance.** `npm run e2e -- box-size-guard` passes. It fails if any copied metric drifts by more than 2 px.

## Stage 2 — Diagram profile registry

**Design.**

- New file `web/src/canvas/doc/diagramProfiles.ts`:
  ```ts
  export interface DiagramProfile {
    id: string;
    matches: (layer: string, members: readonly CanvasElement[]) => boolean;
    frameBounds?: (base: Bounds, ctx: FrameCtx) => Bounds;   // must stay pure; callers memo on a signature
    frameClassName?: string;
    edgeMarker?: (visual: EdgeVisual) => string | undefined; // undefined = default marker
    edgeLabel?: (edge: CanvasEdge) => string;
    laneBands?: boolean;            // default true
    concurrencyIslands?: boolean;   // default true
    plainBox?: boolean;             // default false
    Overlay?: React.ComponentType<{ layer: string; members: CanvasElement[]; sizes: SizeMap }>;
    layout?: (doc: CanvasDoc, ids: string[]) => { positions: PositionMap; sizes: SizeMap };
  }
  export const DIAGRAM_PROFILES: readonly DiagramProfile[];
  export function profileFor(layer: string, members: readonly CanvasElement[]): DiagramProfile; // falls back to DEFAULT_PROFILE
  ```
- The walkthrough entry lives next to its code (`walkthroughLayout.ts` exports `WALKTHROUGH_PROFILE`), the sequence entry next to `sequenceBoard.ts` (`SEQUENCE_PROFILE`). `diagramProfiles.ts` only lists them, so the registry never imports sequence or walkthrough internals into shared files.
- Shared files (`CanvasEdges`, `DiagramFrame`, `CanvasDocView`, `autoLayout`, `CanvasNodeBox`) call `profileFor(...)` and read fields. After this stage none of them imports `WALKTHROUGH_LAYER` or checks `render === "sequence"`.
- Keep the existing memo behaviour: `DiagramFrame` memoises board bounds on `sequenceBoardSignature` + expanded key. A profile's `frameBounds` must keep that (e.g. the profile also exposes a `boundsKey(members, layer)`), or a drag tick will recompute the board.
- `matches` for sequence must stay "any member has `render: "sequence"`", not the layer name: sequence layers are named per diagram.

**Order of work (one commit each, tests green after each).**
1. Add `diagramProfiles.ts` with `DEFAULT_PROFILE` and unit tests for `profileFor`.
2. Move edges (`edgeMarker`, `edgeLabel`).
3. Move frame (`frameBounds`, `frameClassName`, header actions).
4. Move `CanvasDocView` (lane bands, concurrency, overlay).
5. Move `autoLayout` (`layout`) and `CanvasNodeBox` (`plainBox`).
6. Run the grep above: it must print nothing.

**Acceptance.**
- The grep prints nothing.
- `npm test`, `npm run lint` (0 errors), `npm run build` pass.
- Playwright `sequence-expand`, `route-steps`, `diagram-colors`, `diagram-arrange` and the Stage 1 guard pass unchanged.
- New `diagramProfiles.test.ts`: `profileFor` picks walkthrough by layer, sequence by member render, default otherwise.

## Stage 3 — Decide whether to remove the copies (optional, report only)

With the Stage 1 guard in place, the copies are safe. Evaluate and write the result into this file; implement only if clearly cheap:

| Option | How | Cost |
|---|---|---|
| Keep copies + guard | Nothing more | None; drift is caught, not prevented |
| TS as the single source | TS sets the metrics as CSS custom properties (`--seq-box-w`, ...) and CSS reads them | Fine for `SEQUENCE_BOARD` (pure geometry); hard for role boxes (font metrics) |
| Measure in the browser | Render a hidden probe box, cache `getBoundingClientRect` per variant | Layout must wait for the probe; affects first paint |

Recommendation to test first: TS-as-source for `SEQUENCE_BOARD` only, keep role boxes on the guard.

## Rules for this work

- Read first: `docs/architecture/web-canvas-shell.md` (walkthrough and route section, display pipeline), `docs/architecture/diagram-skills.md` (sequence board section), `docs/architecture/web-collision-drag.md`.
- Branch from `main` after PR #331 is merged (it introduces most of these special cases).
- One-line comments only; tests are Arrange-Act-Assert (a hook enforces both).
- Conventional Commits: `refactor(web): ...` for Stage 2, `test(web): ...` for Stage 1.
- No visual change. If a screenshot differs, the stage is wrong.
- Update in the same PR: `docs/architecture/web-canvas-shell.md` (describe `diagramProfiles.ts` and how to add a type) and the sequence paragraph in `docs/architecture/diagram-skills.md`. Set this file's status to Done.

## Commands

```bash
cd web
npm test                      # vitest
npm run lint                  # 0 errors required (warnings exist already)
npm run build
npm run e2e -- sequence-expand route-steps diagram-colors diagram-arrange box-size-guard
```

## Outcome

### Stage 1 — the guard found two real drifts

`web/e2e/box-size-guard.spec.ts` passes. It imports `layoutBoxSize` and `SEQUENCE_BOARD` in the page through Vite, so no test-only attribute was added. It checks seven role-box variants (the six above plus `plan_kind`) and one sequence board with an expanded step. For the board it checks step sizes, step content overflow, lane height (and that the expanded lane holds its open step), lane label left/width (`labelX`/`labelW`), phase pill top/height (`pillY`/`pillH`) and the legend's one-line width (`legendNaturalW`).

Two copies were already wrong; both are fixed in a separate `fix(web):` commit before the guard:

| Copy | Was | Browser | Effect before the fix |
|---|---|---|---|
| `measureBoxSize.ts` top band for an `order`-only box | 22 px | 9.6 px (the order badge is `display: none`) | ordered boxes reserved 12–14 px of blank space |
| `SEQUENCE_BOARD.legendNaturalW` | 1500 | 1802 | some boards reserved one legend line too few; the legend spilled below the frame |

These change the layout of newly drawn diagrams (tighter ordered boxes, a taller frame on some sequence boards). Existing role boxes keep their persisted size.

Proof the guard works: a 6 px change to `.block-role [data-testid="canvas-node-box-description"]` `padding-top` failed five role variants; moving `.seq-lane-label` `left`, `.seq-pill` `top` and the `.seq-legend` column gap by 6 px failed the board test on all three. Reverted.

### Stage 2 — notes

- The grep prints nothing; the walkthrough and sequence boards render byte-identical screenshots before and after Stage 2.
- Profiles live in `sequenceProfile.ts` and `walkthroughProfile.ts`, not in `sequenceBoard.ts`/`walkthroughLayout.ts`: `WALKTHROUGH_PROFILE.Overlay` is `WalkthroughPanel`, which imports `walkthroughLayout.ts`, so the planned place made an import cycle.
- `layoutSequence`/`viewSequenceElements` moved from `autoLayout.ts` to `sequenceBoard.ts` for the same reason.
- `boundsKey` sits beside `frameBounds`; the sequence key is the board signature plus the expanded steps. `DiagramFrame` no longer subscribes to `sequenceViewStore`: `CanvasDocView` already re-renders on its layout version.
- Header actions: the profile's `HeaderAction` (`SequenceModeSwitch.tsx`, moved out of `DiagramFrame.tsx`) renders first; the shared `HEADER_ACTIONS` keeps only the route action, which keys on `meta.route`, not on a type.
- Fewer fields than the spec sketch: `plainBox` and `concurrencyIslands` are implied by `Board` (a board layer gets no boxes, islands or lanes); `laneBands` became `hideLaneBands` (the walkthrough); `RouteFrameActions` reads the route legend's home from `Overlay`. `DIAGRAM_PROFILES` became `diagramProfiles()`, built on first use, because `WalkthroughPanel`'s imports reach back into the registry through `canvasDocStore` → `pileLayout` → `autoLayout`.
- The grep also hit `useReflowSequence.ts`; it became `useReflowOwnLayouts.ts`, which re-spreads any layer whose profile has a `layout`.
- The grep did not catch `CanvasDocView`'s own sequence path (`BLOCK_RULES[...].renderer === "sequence"`, `SequenceDiagram`, the `sequenceViewStore` subscription) or `displayPipeline`'s `viewSequenceLayers`. Review found it; three more fields moved it onto the profile: `Board` (`SequenceDiagram`), `viewElements` (`viewSequenceElements`) and `viewStore` (the layout version, combined across profiles by `subscribeProfileViews`/`profileViewsVersion`). `CanvasDocView` and `displayPipeline` now name no diagram type.
- `autoLayout.ts`'s pinned-box filter dropped the `"sequence"` render in favour of the profile's `layout`.
- Epics special cases are unchanged: moving them is not trivial (`isEpicsLayer` drives the y-offset branch of `layoutNewElements` and the role-box rule in `measureBoxSize.ts`).
- The spec's e2e set passes except `diagram-arrange` (2 of 3 cases, "Arrange preserves user-moved blocks"). The full Playwright run has 7 failures (those 2 plus `agent-windows` 1, `pan-zoom` 1, `workflow-design` 3); all 7 fail the same way on `main` before this work.

### Stage 3 — evaluation (not implemented)

| Option | Finding |
|---|---|
| Keep copies + guard | **Chosen.** Drift is caught in CI, and the guard already paid for itself twice. |
| TS as the single source for `SEQUENCE_BOARD` | Most of the board is already TS-owned: steps, lanes, frames and the board size are inline styles from `buildSequenceBoard`. The only CSS copies are `pillY`/`pillH`, `labelX`/`labelW` and `legendNaturalW`. The first four could move to inline styles cheaply, but `labelX` is 16 in TS and 15 in CSS, so moving it is a 1 px visual change. `legendNaturalW` depends on font metrics and cannot be TS-sourced. Not worth it now. |
| Measure in the browser | Would make `legendNaturalW` exact for every width (today the line count is `ceil(natural / width)`, which can be one line short when the legend wraps item by item). It needs a probe before first layout. Revisit only if a spilled legend is reported. |
