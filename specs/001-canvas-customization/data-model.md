# Data Model: Canvas customization (EP-4)

**Feature**: [spec.md](spec.md) | **Source of truth**: resolved via the style engine
(see [research.md](research.md)); persisted through the bridge preferences store
(see [contracts/preferences-api.md](contracts/preferences-api.md)).

## Entities

### UserPreferences (canvas appearance)

The user-configurable values for the canvas. Persisted across reloads.

| Field | Type | Default | Notes / Validation |
|-------|------|---------|--------------------|
| `id` | string | `"canvas"` | Singleton per installation. |
| `background_color` | color string (`#RGB`/`#RRGGBB`) | current `--surface-0` (`#1b1d23`) | Applied to the canvas background. Must be a valid hex color or `null` (= use default). |
| `block_style` | enum `"default" \| "minimal" \| "high-contrast"` | `"default"` | Drives the block-stroke/fill preset. |
| `arrow_color` | color string (`#RGB`/`#RRGGBB`) | current `--edge-color` default (`--text-3`) | Color of drawn relations. `null` = use default. |
| `element_limit` | integer | sensible default (map's current budget cap) | Max elements rendered. Clamp: `>= 1`; `null` = default. |

**State transitions**: Values are set by the user in Settings and read-only for the
canvas at render time. No state machine — a flat set of persisted preferences updated
atomically on save, read on load.

**Validation rules** (from spec requirements):
- FR-001/FR-003: color values must be a valid hex color or null.
- FR-002: `block_style` must be one of the three allowed values; anything else rejected
  or ignored (falls back to `default`).
- FR-007: `element_limit` clamped to `>= 1`; a value larger than the full map renders the
  whole map (never blocks a full render).
- FR-008: `null`/absent field = apply the sane default.

### ThemeVariables (style-engine output)

The resolved render values the canvas consumes. Derived, not persisted — produced by the
style engine from `UserPreferences`.

| Field | Source |
|-------|--------|
| `canvas-background` → `--surface-0` | `background_color` (or default) |
| `block-surface / block-border / block-text` → `--surface-2`, `--border*`, `--text-*` | `block_style` preset (default / minimal / high-contrast) |
| `edge-color` → `--edge-color` | `arrow_color` (or default) |
| `element-cap` | `element_limit` (numeric, consumed by render budget, not a CSS property) |

The high-contrast preset raises contrast of block borders and text against the chosen
background; the minimal preset reduces borders/fills.

### RenderBudget

The component that enforces `element_limit`. Consumes the resolved `element-cap` and the
map's total available elements; decides how many to draw.

## Relationships

- **UserPreferences → ThemeVariables**: one-to-one resolution (style engine maps one
  preferences row to one set of theme variables).
- **ThemeVariables → canvas render**: the canvas consumes background, block, and edge
  theme values directly; the render budget consumes `element-cap` for the element count.
- **UserPreferences → RenderBudget**: `element_limit` flows into the budget's cap.

## Persistence

- Read at app/canvas load to apply before first paint.
- Written on Settings save; rest of the app observes the in-memory store for live updates.
- Missing/unreadable persisted data → defaults (spec FR-010 / SC-006).
