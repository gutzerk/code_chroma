# CodeChroma — Nested Expand-in-Place Code Canvas

The frontend half of CodeChroma's architecture canvas: the codebase renders as a recursive tree of
nested blocks (Folder → File → Class → Function → Code) on one continuous DOM/CSS canvas. Clicking
a block expands it in place — any number of siblings and arbitrary simultaneous depths can be
expanded at once, each with its own backdrop blur. A breadcrumb across the top tracks the deepest
currently-expanded path. There is no camera, no zoom transitions, and no per-node URL — everything
is in-memory, reset on reload.

This is a minimal base: canvas rendering and breadcrumb navigation only. Features like
auto-grouping large child sets, search, function source drill-down, call/raise connection lines,
and live-sync highlighting have been stripped out and will be rebuilt on top of this base.

## Dev setup

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. By default the app talks to a fixture-backed **mock bridge**
(`src/engine-client/mockBridge.ts`) — no separate backend process is required to explore the UI.

To point at a real bridge instead (once one exists, per `contracts/canvas-bridge-api.md`), set:

```bash
VITE_ENGINE_BRIDGE_URL=http://localhost:8000 npm run dev
```

## Architecture overview

- **`src/canvas/`** — `Block` is the recursive nested-block component: a block expands in place and
  lazily fetches its children via `EngineClient` on first expand.
- **`src/breadcrumb/`** — `Breadcrumb` renders the deepest currently-expanded path, derived from
  `ExpansionStore`; clicking a crumb scrolls that already-expanded ancestor into view.
- **`src/engine-client/`** — `EngineClient` is a **Facade** over the bridge's HTTP API
  (`contracts/canvas-bridge-api.md`); `mockBridge.ts` is a fixture-backed stand-in used until the
  real bridge exists. `fixtures.ts` is generated, not hand-written — it's the real
  `GraphEngine.analyze()` output over `../examples/shadow-app`, reshaped by
  `scripts/export_shadow_app_fixture.py` (repo root). Regenerate it after editing that example.
- **`src/state/`** — `ExpansionStore` (`expansionState.ts`) is the single in-memory store for every
  block's expand/collapse state and the derived breadcrumb path. Nothing here is persisted or
  URL-encoded.

## Testing

```bash
npm test           # Vitest + React Testing Library (component/unit)
npm run e2e         # Playwright (end-to-end expand/collapse flows)
npm run verify:ui   # Manual, approval-gated canvas click-through (docs/planning/014)
```

`verify:ui` (`scripts/verify-ui.mjs`) is a human-in-the-loop pass, not CI: it prompts for consent,
opens Chromium in a visible window, and clicks every rail toggle + diff flow against the mock
bridge on `:5173`, classifying backend-absence errors (terminal xterm/ws) as expected. It is never
part of `npm test`, `npm run e2e`, or CI — only run it deliberately when a person wants to watch
the whole surface work.
