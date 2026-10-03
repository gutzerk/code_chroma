# Quickstart: Canvas customization (EP-4)

**Feature**: [spec.md](spec.md) | **Prerequisite**: EP-1 (a zoomable semantic map canvas
already rendering).

This is a validation/run guide — see [data-model.md](data-model.md) and
[contracts/preferences-api.md](contracts/preferences-api.md) for the underlying shape.

## Prerequisites

- The web app runs (`web/`, Vite dev server per `web/package.json` `dev` script).
- The bridge (FastAPI) is reachable so preferences persist (`VITE_ENGINE_BRIDGE_URL` set,
  matching the LLM-settings setup).

## Run the app

```bash
cd web
npm install        # once
npm run dev        # start the canvas app
```

## Validation scenarios

Each scenario proves a spec acceptance criterion end-to-end.

### 1. Change background, block style, and arrow color (P1 / FR-001..005, SC-001)

1. Open Settings (`SettingsDialog` via the rail button).
2. Choose a new background color, the high-contrast block style, and a new arrow color.
3. **Expected**: the canvas updates immediately, without a reload — background, block
   fills, and relations reflect the new values.

### 2. Choices persist across reload (P2 / FR-009, SC-002)

1. Change any appearance value in Settings.
2. Reload the app and reopen the canvas.
3. **Expected**: the same values are applied (not the defaults).

### 3. Element-count limit is enforced (P2 / FR-007, SC-003)

1. In Settings set an element limit lower than the current map's total.
2. Load a large map.
3. **Expected**: the rendered element count never exceeds the configured limit.

### 4. Sane defaults on first run / missing data (FR-008, FR-010, SC-004, SC-006)

1. With no saved preferences (fresh install, or bridge preferences cleared), open the
   canvas.
2. **Expected**: the canvas renders with the default look and default element limit — no
   blank or broken canvas.

### 5. High-contrast stand presentation (P3 / SC-005)

1. Set the high-contrast block style.
2. Display the canvas on a projection/stand.
3. **Expected**: blocks and relations are legible against the chosen background with no
   reload or manual styling.

## Verification commands

```bash
cd web
npm test        # unit/component tests (vitest)
npm run lint    # eslint
npm run build   # typecheck (tsc -b) + vite build
```

Expected: typecheck, lint, and unit tests pass, and the manual scenarios above behave as
described.
