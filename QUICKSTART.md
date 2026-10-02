# Quickstart: run the canvas on your own repo

Point the zoomable CodeChroma canvas at any repository on your machine and explore its real
architecture — no API key, no database setup. The bridge analyzes your code, and the canvas
live-updates as you edit files.

## 1. Prerequisites

- **Python 3.14+** with [Poetry](https://python-poetry.org/) (the engine + bridge)
- **Node.js 20+ LTS** with npm (the web canvas)
- The target repo should be a **git repository** — the diff overlay and live-reload compare against
  `git HEAD` and `git status`. Analysis still works without git; those two features won't.

No `ANTHROPIC_API_KEY` is needed: the live bridge uses the deterministic offline summarizer and
never calls Claude. Setting the key unlocks the AI-generated diagram features: a **C1
(system-context) diagram** auto-generates the first time you launch against a repo that doesn't have
one yet (see [Section 4a](#4a-system-context-diagram-c1) below), and **custom diagrams** — both
creating a new diagram type and generating a diagram from one — run on Claude calls you trigger by
clicking (see [Section 4b](#4b-custom-diagrams) below). Without a key these views stay empty until you
either provide one or skip generation.

## 2. Install once

From this repo's root:

```bash
poetry install        # Python engine + bridge
cd web && npm install # web canvas, then cd back to root
```

## 3. Start the canvas on your repo (one command)

From this repo's root:

```bash
poetry run python -m codechroma.bridge.launch --repo-path /path/to/your/repo
```

This analyzes your repo, waits for the first analysis to finish, then boots the web app pointed at
it. Open the URL Vite prints (usually **http://localhost:5173**).

**Ctrl-C** stops both the bridge and the web app together.

Options:

| Flag | Default | Purpose |
|---|---|---|
| `--repo-path` | *(required)* | Repository to visualize |
| `--host` | `127.0.0.1` | Bridge host |
| `--port` | `8000` | Bridge port |
| `--ready-timeout` | `600` | Max seconds to wait for the initial analysis |

To switch rendering strategy, set the env var before the command (it's forwarded to the frontend):

```bash
VITE_CANVAS_STRATEGY=tree poetry run python -m codechroma.bridge.launch --repo-path /path/to/your/repo
```

`tree` (indented tree, default) and `boxes` (nested blocks) are the current options.

## 4. Explore

- **Click a block** to expand its children in place — System → Pillar → Component → Service →
  Function. Expand several at once, at any depth; click a block's own header to collapse it.
- **Show Code / Show Full File** buttons in a block header open the real source (popup or inline,
  per the **Code: Popup / Code: Inline** toolbar toggle).
- **Diff** button frames every function whose source differs from `git HEAD`, with a before/after
  view in each box. Deleted functions show as blurred floating panels.
- **Pan/zoom**: drag to pan, scroll to zoom, per-block **Center**, and **Fit All**.

Edit a file in your repo and save — the canvas re-fetches and reconciles in place (new nodes appear
collapsed, deleted ones collapse out, open code/diff windows refresh) without resetting your view
or camera.

### Left rail (icon strip, top to bottom)

The app draws its own small SVG icons (not emoji); the symbols below are the closest plain-text
stand-ins, next to what each icon literally depicts and what the button does.

| Icon | Depicts | Control | What it does |
|---|---|---|---|
| `−` `⊙` `+` | — | Zoom out / reset & re-center / zoom in | Camera zoom controls |
| `>_` | a window with a `>` prompt | Terminal | Opens/closes the docked embedded terminal panel |
| 🔍 | a magnifying glass | Research | Opens/closes the panel for asking natural-language questions about the codebase |
| ▣ / ▤ | a floating window / lines nested in a block | Code: Popup / Code: Inline | Toggles where a block's "Show Code" click renders — floating popup vs. inline panel |
| ± | a split pane with a +/− pair | Diff | Frames every changed function with a before/after view against `git HEAD`; click again to hide |
| ☑ | a checklist | Plan | Fetches the AI-authored change plan and pins its steps onto the blocks it targets |
| ▶ | a play-head on a track | Trace | Turns on execution-trace playback mode (adds a sub-toolbar — see below) |
| `C1` | text label, no icon | C1 | Switches the canvas to the C4-style system-context diagram (whole project as one box + external systems). Click again to return to the code hierarchy |
| 🔱 | one node branching into two | Patterns | Switches to the design-patterns diagram (Strategy, Facade, Adapter, etc. actually used in the repo) |
| 📋 | a bordered checklist board | Epics | Switches to the epics/requirements view (work items, acceptance criteria, delivery links) |
| Custom | text label | Custom | Opens a menu of your saved **custom diagram types** (data-flow grouped by layer, etc.); picking one switches to that user-defined diagram. "New type…" starts a plain-language interview that defines a reusable diagram type (`~/.codechroma/diagram-types/`) |

C1, Patterns, Epics, and Custom are mutually exclusive with the normal hierarchy view — only one is
shown at a time.

### Top bar

| Icon | Depicts | Control | What it does |
|---|---|---|---|
| — | — | Breadcrumb trail | Shows the deepest expanded path; click a segment to center the camera on that ancestor |
| ⑂ | a trunk with one branch curving off | Branch: `<name>` | Opens a dropdown of local branches; picking one runs a real `git checkout` (blocked if you have uncommitted changes) |
| 🔀 | two tracks joined by a curved branch, GitHub's PR mark | Pull-request | Opens a dialog to paste a GitHub PR URL/number and browse it as a read-only workspace |
| 🗗 | two stacked windows | Run agent | Launches a new autonomous Claude Code session in its own git worktree, shown as its own window on the canvas |
| 🗗 | (same icon, different button) | Add agent here | Attaches a new agent session to the workspace/branch you're currently viewing |

### Per-block buttons (in every block's header)

| Icon | Depicts | Button | What it does |
|---|---|---|---|
| — | text label, no icon | Show Code / Show Class / Show File (wording depends on the block's level) | Opens that block's real source, per the Code: Popup/Inline setting above |
| ⧉ → ✓ / ✕ | overlapping squares; flashes a check or cross after clicking | Copy | Copies the block's file path (or name, for a function/class) to the clipboard |
| ⊙ | a bullseye/target | Center | Pans the camera to frame this specific block |

Expand/collapse itself isn't a separate button — click anywhere on the block's own row/header.

### Floating "Fit All" button

Sits over the canvas; fits the camera to every currently expanded block, in whichever view is
active.

### Trace mode sub-toolbar (appears only while Trace is active)

Trace picker dropdown, step-back/play-pause/step-forward, speed selector (0.5×/1×/2×/4×), a scrub
slider with error markers, a "Follow" checkbox (camera follows the active frame), "Breakpoint", and
"Close".

🔵 Switching between the **boxes** (nested blocks) and **tree** (indented) rendering strategies is
not a toolbar button — it's set once at launch via `VITE_CANVAS_STRATEGY=tree` (see the launcher
options in [Section 3](#3-start-the-canvas-on-your-repo-one-command)).

## 4a. System-context diagram (C1)

Click the **C1** button in the top toolbar to switch from the hierarchy canvas to a **C4-model
"system context" view**: your whole project as one box, surrounded by the people and external
systems it talks to (a third-party API, a database, another service, CI, etc.), connected by
labeled relationship arrows. Click **C1** again to switch back.

**Getting a diagram to show up:**

- **With `ANTHROPIC_API_KEY` set** (env var or `.env` at this repo's root — see
  [`.env.example`](./.env.example)): the bridge writes `.codechroma/c1.json` automatically the first
  time it finishes analyzing a repo that doesn't already have one. This is a single Claude call (a
  shallow "bootstrap skeleton") triggered during the workspace's startup bring-up, seeded by a small,
  pre-computed project digest (per-directory summaries, cross-directory dependency counts, declared
  package dependencies, README) — not a per-node call, and it only ever runs once per repo
  (missing-file bootstrap, not a background job). Clicking **C1** alone never generates: opening the
  view or launching the app won't start the run — only a missing file at analyze time does. If the
  repo gains one later, the canvas just fetches it.
- **Without a key**, or to deepen the shallow skeleton into the full multi-level tree, use the
  empty-state **Retry** button (starts a multi-minute `claude -p` run), or open the target repo's
  terminal panel (or any Claude Code session in that repo — launching installs a
  `codechroma-draw-diagram` skill into `.claude/skills/` there automatically) and ask your assistant
  to "generate/update the C1 diagram". The skill fetches the same project digest and writes
  `.codechroma/c1.json` directly; the canvas picks up the change live, no reload needed.
- To start over, ask the assistant to clear the diagram, or delete `.codechroma/c1.json` yourself.

## 4b. Custom diagrams

Click the **Custom** button in the top toolbar to open a menu of your saved **diagram types**
("show me data flow, grouped by layer", and so on). Picking one switches to that user-defined
diagram for the current repo. **Custom diagrams generate only when you click Generate** — never
automatically.

Two things you can do:

- **Use a saved type.** Pick one from the menu; if the repo has no generated diagram for it yet, click
  **Generate**. The bridge runs a Claude agent against your repo and draws the result (boxes, optional
  named groups, labeled arrows). Layout — including dragging boxes — is saved per repo and comes back
  the next time you open the same type.
- **"New type…"** starts a plain-language interview that defines a **reusable diagram type**. It asks
  a few questions about what you want the diagram to show and how it should be drawn, then saves the
  definition to your home directory at `~/.codechroma/diagram-types/` — so a type you define once is
  available in every repo you open, without re-describing it. Creating a type and generating a diagram
  both need `ANTHROPIC_API_KEY` set.

🔵 Your saved types live only on your machine — committing code does not share them with a teammate
(export/import between machines isn't built yet).

## 5. Manual two-terminal alternative

If you'd rather run the two processes yourself (from this repo's root):

```bash
# terminal 1 — the bridge, pointed at your repo
codechroma_BRIDGE_REPO_PATH=/path/to/your/repo poetry run uvicorn codechroma.bridge.server:app --port 8000

# terminal 2 — the web app, pointed at the bridge
cd web
VITE_ENGINE_BRIDGE_URL=http://localhost:8000 npm run dev
```

Extra env vars for the bridge:

- `codechroma_BRIDGE_CORS_ORIGINS` — comma-separated allowed origins (default
  `http://localhost:5173`). Set this if you run the web app on a different host/port.

## Notes and limits

- **Read-only.** The canvas never modifies your code; expand/collapse state lives in memory and
  resets on reload (nothing is persisted or reflected in the URL).
- Only **Python** (`.py`) and **TypeScript** (`.ts`/`.tsx`) files get full symbol analysis; other
  files appear as placeholder nodes so the hierarchy stays complete.
- Not built yet: auto-grouping of large child sets, and search.
- To explore the UI without a backend first, see [`web/QUICKSTART.md`](./web/QUICKSTART.md) — it runs
  the built-in demo against a fixture mock, fully offline.
