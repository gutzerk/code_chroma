# Quickstart: try the canvas on the built-in demo project

This walks through running the nested expand-in-place canvas locally and exploring it, using
**`examples/shadow-app`** — a small but real Python (FastAPI-style) backend and React frontend,
with Protocol/ABC-based clients and repositories. The folder/file layer of the demo tree isn't
hand-written: it's a plain filesystem walk over that example, generated into
`src/engine-client/fixtures.ts` by `scripts/export_examples_fixture.py`. Regenerate it after adding
or removing files under `examples/` with `poetry run python scripts/export_examples_fixture.py`
from the repo root. The class/function layer below each file *is* hand-authored demo data (real
symbol extraction isn't wired up yet — see below), so don't expect it to track the example's actual
source line-for-line.

No backend process, database, or API key is required. The app talks to a fixture-backed **mock
bridge** (`src/engine-client/mockBridge.ts`) instead of a real engine, so this works entirely
offline.

> The mock bridge stands in for the real HTTP+WebSocket bridge described in
> `contracts/canvas-bridge-api.md`, which doesn't exist yet. Pointing the canvas at your own real
> codebase isn't possible until that bridge is built — this quickstart is about exploring the UI
> itself.

## 1. Prerequisites

- Node.js 20+ LTS
- npm (ships with Node)

Check your version:

```bash
node -v
```

## 2. Install and run

From the `web/` directory:

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually **http://localhost:5173**). You'll see one collapsed block:
**examples** (the demo repository root).

## 3. Expand blocks in place

Click through the levels like this:

| Click | You'll see |
|---|---|
| **examples** *(root folder)* | One child: **shadow-app** |
| **shadow-app** | Two children: **backend**, **frontend** |
| **backend** | 8 children: `clients/`, `config.py`, `dependencies.py`, `domain/`, `main.py`, `models/`, `repositories/`, `routers/` — all flattened directly under `backend` (the folder walk only groups one level deep) |
| **clients** | Two files: `email_client.py`, `payment_client.py` |
| **email_client.py** | One class: **EmailClient** |
| **EmailClient** | Two methods: `send`, `_format_subject` |

Nothing here navigates anywhere — every click just grows that block's own box in place. You can
expand several blocks at once, at any depth: expand **backend** and **email_client.py**
simultaneously and each keeps its own backdrop blur, independent of the others. Clicking an
already-expanded block's own header collapses it again. A breadcrumb across the top always
reflects the deepest block you currently have open.

## 4. Show a function's code, or a whole file's code

Any function-level block (and any file-level block with source underneath it) has its own code
button in the header, separate from the block itself — clicking the block body still only
expands/collapses its children; only the button opens or closes code.

- **Function blocks** (e.g. `send` inside **EmailClient**) get a **Show Code** button.
- **File blocks with descendant source** (e.g. `email_client.py`, `order_service.py`) get a
  **Show Full File** button, showing that file's whole text (its function/class sources
  concatenated).

How the button behaves depends on the **"Code: Popup" / "Code: Inline"** toggle in the top
toolbar (default: Inline):

- **Popup mode:** the button opens a syntax-highlighted overlay with the function or
  file's source. You can reposition it by dragging its **title bar** (the strip across the top with
  the ⠿ grip and the node name) — e.g. to see the canvas behind it — while the source text below
  stays selectable. Close it with the ✕, the backdrop, or Escape; reopening it (or opening a
  different node's popup) always starts re-centered.
- **Inline mode (default):** the button expands the code directly into the block on the canvas instead of a
  popup. For a file block, this also hides its sub-blocks while the code is shown (they're
  redundant — already contained in the full-file text) and restores them exactly as they were when
  you click the button again to close it.

## 5. See what changed since your last commit (Diff)

The **Diff** button in the top toolbar reveals every function whose source differs from git HEAD:
it expands each changed function in place, shows a before/after diff in its box, and frames all of
them on screen at once. Click **Diff** again to collapse those boxes back and return to the view
you had before.

By default this runs against the fixture mock, so it always shows two canned changes. To diff a
**real** git working tree, point the canvas at the bridge backend (run from the repo root):

```bash
# terminal 1 — the bridge (analyzes ./examples by default; it lives inside this git repo)
poetry run uvicorn codechroma.bridge.server:app --port 8000
# terminal 2 — the web app, pointed at the bridge (its CORS allows :5173 by default)
VITE_ENGINE_BRIDGE_URL=http://localhost:8000 npm run dev
```

Now **Diff** reports the functions actually changed on disk versus HEAD. Point the bridge at a
different tree with `codechroma_BRIDGE_REPO_PATH=/path/to/repo` (must be inside a git repo).

## 6. System-context diagram (C1)

The **C1** button in the top toolbar switches from the hierarchy canvas to a system-context view:
the project as one box, with the people/external systems it talks to around it and labeled
relationship arrows between them. Against this fixture demo it shows a canned diagram (a developer
actor and a payment-provider external system); against a real bridge it reads
`.codechroma/c1.json`, which the bridge can bootstrap-generate via Claude on first launch (if
`ANTHROPIC_API_KEY` is set) or which an AI assistant writes on request via the `codechroma-c1` skill
— see the root [`QUICKSTART.md`](../QUICKSTART.md#4a-system-context-diagram-c1) for the full flow.

C1 boxes expand in place: click the system box or an actor to reveal its agent-authored sub-blocks
(e.g. the payment provider opens into its payment client), and a sub-block whose path resolved to a
real graph node drills straight into the actual hierarchy — folders, files, classes, down to source
code — exactly like the main canvas. Try it in the fixture demo: expand **Payment Provider** →
**Payment client** → `payment_client.py` → `PaymentClient` → **Show code**. A sub-block whose path
no longer exists shows a "Path not found" note instead. Click **C1** again to return to the
hierarchy canvas.

## 7. What's *not* in this demo

Auto-grouping of large child sets and search aren't built yet. Everything else — expand-in-place,
pan/zoom (drag to pan, scroll to zoom, a **Center** button per block, **Fit All**), a draggable
code popup, call/reference connection lines between visible blocks, an embedded terminal panel, the
function/file code view above, and the C1 system-context view — is live in this build.

Nothing you do here modifies real code — this whole demo is read-only, in-memory fixture data, and
nothing is persisted or reflected in the URL — reloading the page resets everything.

## 8. Try a different rendering strategy

How the hierarchy is drawn (nested boxes, or an indented tree; pie/graph etc. later) is chosen once
at startup via `VITE_CANVAS_STRATEGY` — it can't be switched while the app is running:

```bash
VITE_CANVAS_STRATEGY=boxes npm run dev   # nested boxes
VITE_CANVAS_STRATEGY=tree npm run dev    # indented tree (default)
```

An unset or unrecognized value falls back to `tree`.

## Next steps

- `npm test` — component/unit tests (Vitest + React Testing Library)
- `npm run e2e` — automated walkthroughs of the above (Playwright)
- See [`README.md`](./README.md) for the architecture overview and how to point the app at a real
  bridge once one exists (`VITE_ENGINE_BRIDGE_URL`).
