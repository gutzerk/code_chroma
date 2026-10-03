# CodeChroma — Architecture Canvas

The frontend half of CodeChroma's architecture canvas: the codebase renders as a zoomable map of
nested blocks on one continuous DOM/CSS canvas. The code hierarchy (System → … → Code) is shown as
an indented **Project tree** side panel, while the canvas renders that hierarchy plus every diagram
(C1, Design Patterns, Epics, Sequence, trace, custom) as a layer on the same surface — expand
blocks in place at any depth, pan and zoom, and toggle diagram layers from the **Diagrams** tab.

## Dev setup

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. By default the app talks to a fixture-backed **mock bridge**
(`src/engine-client/mockBridge.ts`) — no separate backend process is required to explore the UI.

To point at the real bridge instead, set:

```bash
VITE_ENGINE_BRIDGE_URL=http://localhost:8000 npm run dev
```

## Architecture overview

- **`src/canvas/`** — `Block` is the recursive nested-block component: a block expands in place and
  lazily fetches its children via `EngineClient` on first expand.
- **`src/breadcrumb/`** — `Breadcrumb` renders the deepest currently-expanded path, derived from
  `ExpansionStore`; clicking a crumb scrolls that already-expanded ancestor into view.
- **`src/engine-client/`** — `EngineClient` is a **Facade** over the bridge's HTTP API.
  `mockBridge.ts` is a fixture-backed stand-in used when no real bridge is configured.
  `fixtures.ts` is generated, not hand-written — the real `GraphEngine.analyze()` output over
  `../examples/shadow-app`, reshaped by `scripts/export_shadow_app_fixture.py` (repo root).
  Regenerate it after editing that example.
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
