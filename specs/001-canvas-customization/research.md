# Research: Canvas customization (EP-4)

**Feature**: [spec.md](spec.md) | **Date**: 2026-09-28

Each unknown from the plan's Technical Context is resolved below with a decision,
rationale, and the alternatives considered.

## R1. Where canvas appearance values live today

**Decision**: Hardcoded CSS custom properties in `:root` in `web/src/styles.css`.

**Rationale**: The canvas background is `--surface-0` (`#1b1d23`), block fills use the
`--surface-*` scale, and edge/arrow color is `--edge-color` defaulting to `--text-3`
(defined at `styles.css:1202`). These are the semantic theme tokens the feature must
resolve from user settings into at runtime.

**Alternatives considered**:
- Hardcoded hex inline in components — rejected: contradicts the existing
  "Design tokens — the single vocabulary" convention (`styles.css:1-5`) and re-themes
  poorly.
- A separate canvas-specific CSS file — rejected: tokens already live in `styles.css`.

## R2. Persistence mechanism for user choices

**Decision**: Application-persisted settings on the existing bridge backend (FastAPI),
matching the `llm-settings` precedent, with the SPA reading them on load and applying
before first canvas paint.

**Rationale**: The spec requires choices to "still hold across a reload" (SC-002). The
project already persists LLM settings via bridge endpoints (`web/src/llm-settings/llmSettingsClient.ts`
→ `bridgeRequest`), and there is no front-end `localStorage` usage in the codebase — so
following the established bridge-backed pattern keeps persistence consistent with the
app's existing contract. The user's preferences are per-installation, not per-branch or
per-repo, matching the LLM-settings model.

**Alternatives considered**:
- Browser `localStorage` — rejected: no precedent in the codebase, and the LLM-settings
  precedent already routes preference persistence through the bridge; localStorage would
  create a second, inconsistent persistence path and wouldn't surface in the desktop app
  identically across environments.
- Repo-level config file — rejected: the epic scopes per-diagram overrides (`meta.style`)
  as out of scope; a repo file would collide with that boundary.

## R3. How settings reach the CSS theme values (style engine)

**Decision**: A front-end style engine module that owns the mapping from user settings
(background color, block style, arrow color, element limit) to concrete CSS custom
properties, applied to the canvas root element (or `document.documentElement`) as inline
custom properties that override `:root` defaults, updating live without a reload.

**Rationale**: CSS custom properties override naturally — setting e.g. `--surface-0` and
`--edge-color` on the canvas root re-themes every descendant immediately, satisfying the
"live, no reload" requirement (FR-005). Each block style (default / minimal / high-contrast)
maps to a preset set of property overrides (e.g. high-contrast raises
`--border`, `--text-1`, `--edge-color` contrast against the chosen background). The element
limit is NOT a CSS property — it is a numeric cap the render budget reads.

**Alternatives considered**:
- Server-side theme rendering / separate CSS per style — rejected: heavier, and live
  application without reload is harder.
- React context propagating colors to each component — rejected: bloats components;
  CSS variables already centralize the tokens.

## R4. Render-budget element-count limit

**Decision**: A numeric maximum that the canvas's render budget reads and enforces when
deciding which elements to draw. Default sensible value applies until changed. A zero or
negative configured value is clamped to a minimum of 1 (never renders nothing by mistake).

**Rationale**: This matches the epic's "configurable maximum number of elements the canvas
renders" and the existing render-budget concept. The unit is simply a count of rendered
elements.

**Alternatives considered**:
- Time/density-based budget — rejected: the epic names an *element-count* limit
  specifically.
- Hard lower bound of 0 slowing to nothing — rejected: renders a blank canvas, contrary to
  the sane-default edge cases in the spec.

## R5. Where the Settings UI lives

**Decision**: Extend the existing modal `SettingsDialog` (`web/src/assistant/SettingsDialog.tsx`)
with a canvas appearance section exposing the three pickers and the element-count control.

**Rationale**: The epic says "configurable from Settings" and the app already has a
`SettingsDialog` modal (opened from `SettingsRailButton`). Adding a section there is the
lowest-friction, most discoverable placement.

**Alternatives considered**:
- A new standalone canvas-preferences dialog — rejected: duplicates an existing modal
  surface.
- Inline controls on the canvas — rejected: clutters the map; epic specifically names
  Settings.

## R6. Live application without a reload

**Decision**: Apply resolved values to CSS custom properties on the canvas root on every
settings change and on app load; the style engine exposes a `subscribe`-able store so the
canvas root updates immediately.

**Rationale**: Matches FR-005/SC-001. The in-memory store precedent (`createStore` +
`useSyncExternalStore`, e.g. `inspectorStore.ts`) gives live updates consistent with the
codebase.

**Alternatives considered**: reload-on-save — rejected: violates the explicit no-reload
requirement.

## R7. Dependencies

**Decision**: This feature depends on EP-1 (zoomable semantic map) as the base canvas that
already renders a map.

**Rationale**: Stated in the epic's Dependencies & Sequencing. The appearance/render-budget
work layers on top of an existing, rendering canvas.

**Alternatives considered**: none — the dependency is fixed by the project's epic
sequencing.
