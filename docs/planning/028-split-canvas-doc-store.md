# 028 — Split canvasDocStore from auto-layout (remove the diagram profile import cycle)

Status: Done

Follow-up to 027 (PR #332, "Known limitations"). Web only: no bridge, skill or JSON change. No visual or behaviour change.

## Goal

Remove the import cycle through the diagram profile registry. Then drop the two workarounds 027 added for it:

- the lazy registry in `diagramProfiles.ts` (`registry ??=` in `diagramProfiles()`);
- the `get Overlay()` getter in `walkthroughProfile.ts`.

Done means: no runtime import cycle passes through `diagramProfiles.ts`, both workarounds are gone, and every test passes unchanged.

## The cycle today

Runtime imports only (`import type` lines do not count):

```
diagramProfiles.ts
  -> walkthroughProfile.ts
  -> walkthroughLayout.ts      (useLayerRoute needs useRouteCarriers)
  -> canvasDocStore.ts         (fetchAndApplyCanvasDoc auto-lays out unplaced boxes)
  -> pileLayout.ts
  -> autoLayout.ts             (reads each profile's `layout`)
  -> diagramProfiles.ts
```

## Root cause

`canvasDocStore.ts` does two jobs:

| Job | Exports | Needs layout? |
|---|---|---|
| State | `CanvasDocStore` class, `canvasDocStore`, `useCanvasDoc`, `useRouteCarriers`, `useCanvasDocLoaded`, `collectActiveLayers`, `useHasCanvasLayer` | No |
| Sync with the bridge | `fetchAndApplyCanvasDoc` (private), `useLoadCanvasDoc`, `patchCanvasDoc`, `applyCanvasPositions`, `commitCanvasPositions` | Yes: `findUnplaced`/`layoutUnplaced` from `pileLayout.ts` |

Anything that only reads state (like `walkthroughLayout.ts`) still pulls in the whole layout stack.

## Fix

Move the sync job into a new file, `web/src/canvas/doc/canvasDocSync.ts`. `canvasDocStore.ts` keeps only state and stops importing `pileLayout.ts`.

Verified: with the `canvasDocStore.ts -> pileLayout.ts` import removed, no cycle passes through `diagramProfiles.ts`. The check was a scan of the runtime import graph over `web/src`, ignoring tests.

## Steps (one commit each)

### 1. Create `canvasDocSync.ts` and move the sync code

- Move `fetchAndApplyCanvasDoc`, `useLoadCanvasDoc`, `patchCanvasDoc`, `applyCanvasPositions` and `commitCanvasPositions` (today `canvasDocStore.ts` ~line 155 to the end) into `canvasDocSync.ts`, unchanged.
- `canvasDocSync.ts` imports `canvasDocStore` from `./canvasDocStore` and `findUnplaced`/`layoutUnplaced` from `./pileLayout`.
- Remove the `pileLayout` import from `canvasDocStore.ts`.
- ⚠ Keep the store fields the sync code uses (`nextFetchSeq`, `isLatestFetchSeq`, `deferLayout`, `releaseLayout`, `layersMidLayout`, `unlayoutableLayers`, `autoPlacedIds`) on the store class. Only the functions move.
- Do not re-export the moved functions from `canvasDocStore.ts`. A re-export would bring the cycle back.

### 2. Update callers

Change imports from `./canvasDocStore` to `./canvasDocSync` for the moved names:

| Name | Files (incl. tests) |
|---|---|
| `patchCanvasDoc` | 12 (4 tests) |
| `useLoadCanvasDoc` | 5 (4 tests) |
| `commitCanvasPositions` | 3 |
| `applyCanvasPositions` | 1 |

Find them with `grep -rlwE "patchCanvasDoc|useLoadCanvasDoc|commitCanvasPositions|applyCanvasPositions" web/src`.

⚠ Fix the test mocks too:

- `useReflowOwnLayouts.test.ts` and `useReflowEpics.test.ts` mock `./canvasDocStore` to stub `patchCanvasDoc`. Point them at `./canvasDocSync`.
- `canvasDocStoreLayout.test.ts` mocks `./pileLayout` and tests the fetch-and-layout path. It now tests `canvasDocSync.ts`. Rename it to `canvasDocSync.test.ts`, or keep the name and update its imports.

### 3. Remove the 027 workarounds

- `diagramProfiles.ts`: replace the lazy `registry ??=` with a plain constant, e.g. `const PROFILES = [SEQUENCE_PROFILE, WALKTHROUGH_PROFILE]`. Keep `diagramProfiles()` as the accessor so callers don't change. Update its comment.
- `walkthroughProfile.ts`: replace the `get Overlay()` getter with `Overlay: WalkthroughPanel`. Delete its comment.

### 4. Guard against the cycle coming back

Add a new test file, `diagramProfilesLoad.test.ts`, whose first import is `./walkthroughProfile` (Vitest loads each file in a fresh module graph, so the import order matters). Assert `WALKTHROUGH_PROFILE.Overlay` is defined and `diagramProfiles()` returns both profiles. With the old cycle and no workarounds, this file fails at load time: a TDZ `ReferenceError` or an `undefined` `Overlay`. Check this once by temporarily restoring the `pileLayout` import in `canvasDocStore.ts`, then revert.

Optional: run `npx madge --circular --extensions ts,tsx web/src` once and paste the result into this file. Do not add madge as a dependency for this.

### 5. Docs

- `docs/architecture/web-canvas-shell.md`, section "Diagram profiles": remove the 🔴 note about the import cycle, the lazy registry and the `Overlay` getter. Add one line: `canvasDocStore.ts` is state only, and `canvasDocSync.ts` owns fetch, patch and auto-layout.
- Update every doc that names `patchCanvasDoc`/`useLoadCanvasDoc` as living in `canvasDocStore.ts`: `grep -rn "canvasDocStore" docs/architecture CLAUDE.md`. Likely `single-canvas.md` and `web-engine-client.md`.
- Set this file's status to Done and add a short "Result" section.

## Result

- `canvasDocSync.ts` holds the five sync functions, moved unchanged. `canvasDocStore.ts` imports no layout module.
- Steps 1 and 2 landed as one commit: the move alone does not compile.
- The lazy registry and the `Overlay` getter are gone.
- `diagramProfilesLoad.test.ts` guards the load order. With the old `pileLayout` import restored, it fails: `diagramProfiles()` returns `[SEQUENCE_PROFILE, undefined]`.
- The same file also scans the runtime imports under `web/src` from `diagramProfiles.ts`. It fails with the import chain if any profile, not only the walkthrough one, closes a cycle (from `/simplify`).
- madge was not run. A local scan of runtime imports over `web/src` (tests ignored) finds the spec's cycle before the move and none after.

## Acceptance

- `cd web && npm test && npm run lint && npm run build` pass.
- `npx playwright test box-size-guard sequence-expand route-steps diagram-colors` pass.
- `canvasDocStore.ts` has no import of `pileLayout`, `autoLayout` or `diagramProfiles`.
- `diagramProfiles.ts` has no lazy registry. `walkthroughProfile.ts` has no getter.
- The step 4 test passes.

## Out of scope

- Behaviour of the fetch race guard, the transient-pile check or the deferred-layer logic. Move the code, don't change it.
- Splitting profiles into data and view parts. With the cycle gone, this is no longer needed.
- Epics special cases (`isEpicsLayerName`).

## Risks

| Risk | Mitigation |
|---|---|
| A test mocks `./canvasDocStore` and silently stops stubbing `patchCanvasDoc` | Step 2 lists the known mocks. A real `patchCanvasDoc` call in jsdom fails loudly on the engine client, so a missed mock shows up as a failing test. |
| A new import of `canvasDocSync` from a state-only module brings a cycle back | The step 4 test fails. |
| Merge conflicts with work touching `canvasDocStore.ts` | Do the move in one commit with no edits to the moved code, so a rebase is mechanical. |
