# Implementation Plan: Canvas customization

**Branch**: `001-canvas-customization` | **Date**: 2026-09-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-canvas-customization/spec.md`

## Summary

EP-4 makes the canvas's appearance and render density user-configurable from Settings:
background color, block style (default / minimal / high-contrast), arrow color, and an
element-count limit. Today these are hardcoded CSS custom properties in
`web/src/styles.css` (`:root`), and the element cap is a fixed render budget. The feature
adds a style engine that resolves user preferences into theme variables the canvas
consumes live (no reload), a Settings UI section, and bridge-backed persistence matching
the existing LLM-settings pattern. Design decisions are in [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript ~5.6 (React 18.3) for `web/`; Python 3.14 (FastAPI bridge) in `src/codechroma/bridge/` for persistence.

**Primary Dependencies**: React 18.3, Vite 5, vitest 2 (feat. `@vitejs/plugin-react`); FastAPI (bridge); existing `createStore`/`useSyncExternalStore` state pattern.

**Storage**: Bridge-backend preferences store (FastAPI), following the `llm-settings` precedent — no `localStorage` in the codebase.

**Testing**: vitest (unit/component, jsdom) + `@testing-library/react`; `tsc -b` typecheck; eslint; Python side via `poetry run pytest` if a backend endpoint is added.

**Target Platform**: Browser SPA (`web/`), also packaged in the desktop build.

**Project Type**: Web application (React SPA `web/` + Python FastAPI bridge `src/codechroma/`).

**Performance Goals**: Appearance and element-limit changes apply live without a reload; re-render on a settings change should not visibly jank the canvas (Style engine updates CSS custom properties and re-runs the render budget only when the element limit changes).

**Constraints**: No reload on settings change (FR-005); sane defaults always apply (FR-008, FR-010); per-diagram `meta.style` overrides stay unchanged (out of scope); no change to the semantic map model.

**Scale/Scope**: Single-user desktop-style SPA; one canvas preferences object per installation; element limit is a single numeric cap.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The repository has no `.specify/memory/constitution.md`, so no project constitution gates
apply. Standard engineering quality gates still stand (tests pass, no regressions,
boundaries kept — no per-diagram override changes). **Pass.**

## Project Structure

### Documentation (this feature)

```text
specs/001-canvas-customization/
├── spec.md                # Feature spec (specify output)
├── plan.md                # This file
├── research.md            # Phase 0 output — decisions R1..R7
├── data-model.md          # Phase 1 output — UserPreferences / ThemeVariables / RenderBudget
├── quickstart.md          # Phase 1 output — validation scenarios
├── contracts/
│   └── preferences-api.md # Phase 1 output — GET/PUT /preferences/canvas
└── tasks.md               # Phase 2 output (tasks command — not created here)
```

### Source Code (repository root)

```text
web/src/
├── canvas/
│   ├── styleEngine.ts      # NEW — resolves UserPreferences → ThemeVariables (CSS custom props + element cap)
│   ├── styleEngine.test.ts # NEW
│   ├── canvasPreferencesStore.ts # NEW — in-memory store + persistence client (createStore/useSyncExternalStore)
│   └── RootCanvas.tsx       # apply style engine output (background/edge) + read element limit
├── assistant/
│   ├── SettingsDialog.tsx   # add "Canvas appearance" section (3 pickers + element limit)
│   └── SettingsDialog.test.tsx # extend coverage
└── styles.css               # keep :root tokens as defaults; style engine overrides on canvas root

src/codechroma/bridge/
└── preferences.py           # NEW — GET/PUT /preferences/canvas endpoint + store
```

**Structure Decision**: Single SPA project (`web/`) with the existing `canvas/` and
`assistant/` modules; new style-engine and preferences-store modules colocate in
`web/src/canvas/`, the persistence endpoint in the existing bridge package. No new
top-level projects.

## Complexity Tracking

> No constitution file exists, so no violation justification table is required. The
> feature adds one new module (`styleEngine`), one store, and one bridge endpoint — all
> within existing boundaries.
