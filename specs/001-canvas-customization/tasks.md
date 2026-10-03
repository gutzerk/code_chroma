# Tasks: Canvas customization

**Input**: Design documents from `specs/001-canvas-customization/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/preferences-api.md

**Tests**: The codebase has a strong unit-test culture (vitest, `*.test.ts(x)` next to
sources, e.g. `RootCanvas.test.tsx`, `inspectorStore.test.ts`). Test tasks are included
per story following that convention.

**Organization**: Tasks are grouped by user story to enable independent implementation
and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single project; SPA lives in `web/`, bridge backend in `src/codechroma/bridge/` (see
plan.md). Paths in tasks are repo-root-relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm baseline and scaffold config shared by all stories.

- [ ] T001 Confirm the web app runs (`cd web && npm install && npm run dev`) and the bridge is reachable per QUICKSTART.md
- [ ] T002 [P] Create shared `CanvasPreferences` type + defaults in `web/src/canvas/canvasPreferences.ts` (mirrors contracts/preferences-api.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T003 Implement `styleEngine.ts` in `web/src/canvas/styleEngine.ts` — maps `CanvasPreferences` → CSS custom-property overrides + resolved `element-cap` (default / minimal / high-contrast presets per data-model.md)
- [ ] T004 [P] Implement the in-memory preferences store in `web/src/canvas/canvasPreferencesStore.ts` using `createStore` + `useSyncExternalStore` (pattern from `inspectorStore.ts`) — holds current prefs, emits on change
- [ ] T005 [P] Implement the persistence client in `web/src/canvas/canvasPreferencesStore.ts` (or `web/src/canvas/canvasPreferencesClient.ts`) using `bridgeRequest`/`jsonInit` (pattern from `web/src/llm-settings/llmSettingsClient.ts`) with `getCanvasPreferences()` / `putCanvasPreferences()`
- [ ] T006 Implement bridge endpoint `GET`/`PUT /preferences/canvas` in `src/codechroma/bridge/preferences.py` per contracts/preferences-api.md (hex validate, enum validate, `element_limit >= 1`), registered in `create_app()`
- [ ] T007 [P] Write styleEngine unit tests in `web/src/canvas/styleEngine.test.ts` (presets resolve; null → default; element-limit clamping)

**Checkpoint**: Foundation ready — user story implementation can now begin in parallel.

---

## Phase 3: User Story 1 - Choose canvas appearance (Priority: P1) 🎯 MVP

**Goal**: A developer opens Settings and picks background color, block style, and arrow
color; the canvas applies them live (no reload) and they persist across reloads.

**Independent Test**: Open Settings → change each of the three appearance controls →
canvas updates immediately; reload → choices still applied (spec SC-001, SC-002).

### Tests for User Story 1

- [ ] T008 [P] [US1] Unit test for preferences store (get/set/emit/persist) in `web/src/canvas/canvasPreferencesStore.test.ts`
- [ ] T009 [P] [US1] Component test for the new Settings appearance section (pickers render, values round-trip) in `web/src/assistant/SettingsDialog.test.tsx`
- [ ] T010 [P] [US1] Test that the style engine output is applied to the canvas root on change in `web/src/canvas/styleEngine.test.ts` (or `RootCanvas.test.tsx`)

### Implementation for User Story 1

- [ ] T011 [P] [US1] Add "Canvas appearance" section (background color picker, block-style selector default/minimal/high-contrast, arrow color picker) to `web/src/assistant/SettingsDialog.tsx`
- [ ] T012 [US1] Wire the section to the preferences store (`useCanvasPreferences`), calling `putCanvasPreferences()` on save
- [ ] T013 [US1] Apply resolved theme variables live to the canvas root in `web/src/canvas/RootCanvas.tsx` (subscribe to store; set `--surface-0`, block tokens, `--edge-color`; re-apply on load before first paint)
- [ ] T014 [US1] Load saved preferences on app/canvas startup and apply defaults when read fails or returns null (spec FR-008, FR-010)

**Checkpoint**: User Story 1 fully functional — canvas reflects the three chosen values
live and persists them across a reload.

---

## Phase 4: User Story 2 - Set maximum element count (Priority: P2)

**Goal**: A developer sets the maximum number of elements the canvas renders; the render
budget enforces it, trading density for legibility, with a sensible default until changed.

**Independent Test**: Set an element limit lower than the map total → rendered element
count never exceeds it; no value set → default applies (spec SC-003, SC-004).

### Tests for User Story 2

- [ ] T015 [P] [US2] Unit test for element-limit clamping and default in `web/src/canvas/styleEngine.test.ts`
- [ ] T016 [US2] Integration test that the render budget honors the configured cap in the relevant canvas render-budget test (e.g. `web/src/canvas/*.test.tsx` for the budget module)

### Implementation for User Story 2

- [ ] T017 [P] [US2] Add the element-count control (numeric stepper, clamped `>= 1`) to the Canvas appearance section in `web/src/assistant/SettingsDialog.tsx`
- [ ] T018 [US2] Expose the resolved `element-cap` from the preferences store to the render budget
- [ ] T019 [US2] Make the render budget read and enforce the configured cap when deciding what to draw (no change to the semantic map model)
- [ ] T020 [US2] Persist the element limit with the rest of preferences (reuses `putCanvasPreferences`) and load it on startup

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - High-contrast stand presentation (Priority: P3)

**Goal**: A demo lead switches the map to high-contrast so live canvases read well on a
stand; the choice applies and persists for the session.

**Independent Test**: Select high-contrast → map blocks and relations are legible against
the chosen background on a projection, no reload needed; choice persists (spec SC-005).

### Implementation for User Story 3

- [ ] T021 [US3] Verify/refine the high-contrast block-style preset so blocks and relations keep contrast against arbitrary chosen backgrounds in `web/src/canvas/styleEngine.ts`
- [ ] T022 [US3] End-to-end validation of the stand scenario via `quickstart.md` scenario 5 (high-contrast + no-reload persistence)

**Checkpoint**: All user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories.

- [ ] T023 [P] Update docs — note the new canvas appearance settings in `docs/` and finalize `quickstart.md`/`contracts/preferences-api.md` if behavior differs
- [ ] T024 [P] Run `quickstart.md` validation scenarios end-to-end (5 scenarios, spec SC-001..SC-006)
- [ ] T025 Run `cd web && npm test && npm run lint && npm run build` to confirm typecheck, lint, and tests pass
- [ ] T026 (backend) Run `poetry run pytest` to confirm the bridge endpoint tests pass if a backend endpoint was added

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3+)**:
  - US1 (P1) → US2 (P2): US2 reuses the style engine, store, and persistence from US1, so US2 builds on US1.
  - US1 → US3 (P3): US3 reuses the high-contrast preset and persistence from US1/2.
  - Within the shared settings UI, US2's control lands in the same `SettingsDialog.tsx` section as US1 — implement US1 first, then US2's control.
- **Polish (Final Phase)**: Depends on all desired user stories.

### User Story Dependencies

- **US1 (P1)**: After Foundational. No dependency on other stories.
- **US2 (P2)**: After US1 (share style engine/store/Settings section); independently testable.
- **US3 (P3)**: After US1/2 (reuses high-contrast preset); independently testable.

### Within Each User Story

- Tests written and failing before implementation where applicable.
- Core implementation before integration.

### Parallel Opportunities

- T002 (Setup, [P]) can run while confirming the baseline (T001).
- T003, T004, T005, T007 (Foundational, [P]) can run in parallel (different files), though T006 (bridge endpoint) is the persistence anchor.
- Story test tasks marked [P] can run in parallel.
- T011 and T015/T017 touch `SettingsDialog.tsx` — keep them sequential within their story to avoid same-file conflicts.

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "T008 Unit test for preferences store in web/src/canvas/canvasPreferencesStore.test.ts"
Task: "T009 Component test for Settings appearance section in web/src/assistant/SettingsDialog.test.tsx"
Task: "T010 Test style-engine application to canvas root in web/src/canvas/styleEngine.test.ts"

# Implementation (T011 [P] before T012..T014 which share SettingsDialog/RootCanvas):
Task: "T011 Add Canvas appearance section to web/src/assistant/SettingsDialog.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: test US1 independently (quickstart scenario 1 + 2)
5. Deploy/demo if ready — this delivers appearance customization as a usable slice.

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → test independently → demo (MVP)
3. US2 → test independently → demo (element limit)
4. US3 → test independently → demo (stand presentation)

### Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to a user story for traceability.
- Each story is independently completable and testable.
- Commit after each task or logical group.
- Avoid same-file conflicts: US2's Settings control waits for US1's section (T011), and
  store/RootCanvas edits (T012–T014, T018–T020) are sequential, not parallel.
