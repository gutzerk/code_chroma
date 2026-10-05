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
one yet (see [Section 4a](#4a-diagrams-c1-patterns-impact-epics-sequence-custom) below), and **custom diagrams** — both
creating a new diagram type and generating a diagram from one — run on Claude calls you trigger by
clicking (see [Section 4b](#4b-custom-diagrams) below). Without a key these views stay empty until you
either provide one or skip generation.

## 2. Install once

**Prefer a desktop app over running from source?** One command downloads the pre-built installer
for your platform from the latest GitHub Release and installs it — no local toolchain or checkout
needed:

| Platform | Command |
|---|---|
| macOS (Apple Silicon or Intel) | `bash scripts/install_desktop.sh` |
| Windows (x64) | `powershell -ExecutionPolicy Bypass -File scripts/install_desktop.ps1` |
| Linux (x64) | `bash scripts/install_linux.sh` |

macOS and Linux install per-user into `~/Applications` without administrator privileges; use
`--system` only to opt into the system-wide macOS app or Linux `.deb` package. After a macOS install,
run `open ~/Applications/CodeChroma.app` and pick a repo in the launcher. Otherwise, to run the
canvas from source, install the dependencies once from this repo's root:

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
| `--repo-path` | *(one of the two)* | Local repository to visualize |
| `--github` | *(one of the two)* | GitHub URL or `owner/repo[@ref]`; cloned to `~/.codechroma/github-repos/<owner>/<repo>` (`$CODECHROMA_GITHUB_CACHE_DIR` moves it), or fetched if already there |
| `--ref` | remote default branch | Branch, tag or commit to open with `--github` |
| `--clone-dir` | managed cache | Where `--github` clones to |
| `--host` | `127.0.0.1` | Bridge host |
| `--port` | `8000` | Bridge port |
| `--ready-timeout` | `600` | Max seconds to wait for the initial analysis |

The canvas always renders as nested expandable blocks — there is no boxes-vs-tree strategy switch
anymore. (The old `?strategy=` URL param and `VITE_CANVAS_STRATEGY` env var were removed.) The
indented tree now lives in its own **Project tree** side panel; see the rail table in [Section 4](#4-explore).

## 4. Explore

- **Click a block** to expand its children in place — System → Pillar → Component → Service →
  Function. Expand several at once, at any depth; click a block's own header to collapse it.
- **Show Code / Show Full File** buttons in a block header open the real source in an inline code
  panel.
- **Pan/zoom**: drag to pan, scroll to zoom, per-block **Center**, and **Fit All**.

Edit a file in your repo and save — the canvas re-fetches and reconciles in place (new nodes appear
collapsed, deleted ones collapse out, open code/diff windows refresh) without resetting your view
or camera.

### One canvas, layers

The canvas is a single document, not a set of mutually exclusive full-screen views. The seeded
**hierarchy** (System → … → Code) is one layer, and each **diagram** — C1, Design Patterns, Change
Impact, Epics, Sequence, trace playback, or a custom type — is another layer on top of it. Layers
are shown together (diagrams over the hierarchy) and toggled independently, all from the **Diagrams**
tab of the agent panel (below). The old "switch the whole canvas to C1 / Patterns / Epics" toolbar
buttons are gone.

### Left rail (icon strip, top to bottom)

The app draws its own small SVG icons (not emoji); the symbols below are the closest plain-text
stand-ins, next to what each icon literally depicts and what the button does.

| Icon | Depicts | Control | What it does |
|---|---|---|---|
| `−` `⊙` `+` | — | Zoom out / reset & re-center / zoom in | Camera zoom controls |
| `>_` | a window with a `>` prompt | Terminal | Opens/closes the docked embedded terminal panel |
| ▤ | lines nested in a block | Project tree | Opens/closes the indented project-tree side panel (a navigational index over the same hierarchy the canvas shows) |
| ★ / e.g. `C1` | icon or text label | Draw… | Opens an agent that asks what diagram to draw, then draws it onto the canvas via the `codechroma-draw-diagram` skill |

**Diff**: the Diff toggle button is hidden from the rail for now (its logic is kept in the code but
not surfaced), so diff framing isn't currently reachable from the UI.

### Agent panel (beside the canvas: **Agents** / **Diagrams** tabs)

- **Diagrams tab** — the one place every diagram layer is listed and managed. Each row toggles that
  layer's visibility (collapse or expand) on the canvas; a chevron plus a delete button (with a
  confirm dialog) remove the diagram outright. The "On canvas" set stays in sync with what's drawn,
  including diagrams an agent wrote directly via the skill.
- **Agents tab** — one card per agent session, mirroring its canvas window (see "Run agent" below).

### Top bar

| Control | What it does |
|---|---|
| Breadcrumb trail | Shows the deepest expanded path; click a segment to center the camera on that ancestor |
| Branch: `<name>` | Opens a dropdown of local branches; picking one runs a real `git checkout` (blocked if you have uncommitted changes) |
| Pull-request | Opens a dialog to paste a GitHub PR URL/number and browse it as a read-only workspace |
| Run agent | Launches a new autonomous Claude Code session in its own git worktree, shown as its own window on the canvas |

### Per-block buttons (in every block's header)

| Icon | Depicts | Button | What it does |
|---|---|---|---|
| — | text label, no icon | Show Code / Show Class / Show File (wording depends on the block's level) | Opens that block's real source in the inline code panel |
| ⧉ → ✓ / ✕ | overlapping squares; flashes a check or cross after clicking | Copy | Copies the block's file path (or name, for a function/class) to the clipboard |
| ⊙ | a bullseye/target | Center | Pans the camera to frame this specific block |

Expand/collapse itself isn't a separate button — click anywhere on the block's own row/header.

### Floating "Fit All" button

Sits over the canvas; fits the camera to every currently expanded block, in whichever view is
active.

## 4a. Diagrams (C1, Patterns, Impact, Epics, Sequence, custom)

There is no dedicated per-diagram button anymore — every diagram is a **layer** of the one canvas,
created with the rail's **Draw…** button and managed from the agent panel's **Diagrams** tab (see
[Section 4](#4-explore)). That tab lists each on-canvas diagram as a row with a visibility toggle and
a delete button.

The built-in types the Draw… agent can produce:

- **C1** — a C4-model "system context" layer: your whole project as one box, surrounded by the
  people and external systems it talks to, connected by labeled relationship arrows.
- **Design patterns** — the real GoF/architectural patterns (Strategy, Facade, Adapter, etc.)
  actually in use, laid out as one connected graph.
- **Change impact** — what a change touches, derived from the diff.
- **Epics** — the requirements portfolio traced onto the map.
- **Sequence** — a UML-style message-order (sequence) diagram.
- **Custom** — any user-defined diagram type you describe once and reuse (see below).

**Getting a diagram to show up:**

- **With `ANTHROPIC_API_KEY` set** (env var or `.env` at this repo's root — see
  [`.env.example`](./.env.example)): the bridge writes `.codechroma/c1.json` automatically the first
  time it finishes analyzing a repo that doesn't already have one. This is a single Claude call (a
  shallow "bootstrap skeleton") triggered during the workspace's startup bring-up, seeded by a small,
  pre-computed project digest (per-directory summaries, cross-directory dependency counts, declared
  package dependencies, README) — not a per-node call, and it only ever runs once per repo
  (missing-file bootstrap, not a background job). Clicking **Draw…** and picking a type is the normal
  way to generate a diagram; opening the canvas never starts a run on its own. If a repo already has
  a diagram artifact, the canvas just fetches it.
- **Without a key**, use the rail's **Draw…** button (it opens an agent run; the empty-state Retry
  path starts a multi-minute `claude -p` run), or open the target repo's terminal panel (or any
  Claude Code session in that repo — launching installs a `codechroma-draw-diagram` skill into
  `.claude/skills/` there automatically) and ask your assistant to "generate/update the C1 diagram".
  The skill fetches the same project digest and writes `.codechroma/c1.json` directly; the canvas
  picks up the change live, no reload needed.
- To start over, ask the assistant to clear the diagram, or delete `.codechroma/c1.json` yourself.

## 4b. Custom diagrams

Click the rail's **Draw…** button and pick a type when the agent asks — or use the agent panel's
Diagrams tab to manage what's already on canvas. **Custom diagrams generate only when you trigger a
draw** — never automatically.

Two things you can do:

- **Use a saved type.** Pick one when the Draw… agent asks what to draw; if the repo has no generated
  diagram for it yet, the agent generates it. The bridge runs a Claude agent against your repo and
  draws the result (boxes, optional named groups, labeled arrows). Layout — including dragging
  boxes — is saved per repo and comes back the next time you open the same type.
- **Define a reusable diagram type.** Describe the type in plain language ("show me data flow,
  grouped by layer") and the agent saves the definition to your home directory at
  `~/.codechroma/diagram-types/` — so a type you define once is available in every repo you open,
  without re-describing it. Creating a type and generating a diagram both need `ANTHROPIC_API_KEY`
  set.

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
