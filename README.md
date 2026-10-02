# CodeChroma

**Navigate any codebase like a map, not a maze.**

CodeChroma turns a repository into a zoomable, semantic architecture map — built from what the
code actually does, not from its folder layout. Point it at a repo and get a live, clickable
hierarchy: **System → Pillar → Component → Service → Function → Logic Block → Code**. Both AI
coding agents and humans can jump straight to the part that matters, instead of scrolling files.

## Who it's for

Built for software engineers and product/project managers working with LLM-era code — code that is
written fast and changes faster. When you can no longer keep up by reading files line by line, you
need a picture from above: a canvas view of how the app works, at your chosen level of abstraction,
before you ever open a single file.

- **Understand faster.** See how the app works and how it changes from a high-level canvas, not by
  scrolling a repo. Read long documents (docs, requirements, specs) faster too — Epics view splits
  them into blocks you can trace and separate.
- **PM-friendly.** See how the app works and track delivery without diving into code. None of the
  value is locked behind engineering knowledge — and when detail is needed, anyone can zoom in.
- **Full control, no code required.** Read, review, and drive the app — explore with diagrams, edit
  or create your own diagram types, review changes as visual diffs — without looking at source.
- **Working in new-IDEs.** Run AI agents inside the same canvas, as its own window, and work with it
  the way you would inside a modern IDE.
- **Real-time teamwork (roadmap).** A future shared canvas lets several people work on the same
  project at once, discuss, and keep the whole picture in sync.

## What it does

- 🗺️ **Zoomable architecture canvas** — nested blocks you expand in place, any number at once, at
  any depth. No folder-first browsing; grouping follows real code relationships.
- 🔴 **Live sync** — a background watcher re-analyzes on every save. Edit a file and the canvas
  updates in place: new blocks appear, deleted ones fade out, no reload.
- **Diff overlay** — every changed function shown before/after against `git HEAD`, right inside its
  block.
- **C1 system-context diagram** — a C4-model view of your whole project as one box, plus the
  people and external systems it talks to. Auto-generated on first launch (with an API key set), or
  written and refined by an AI coding agent.
- **Design patterns diagram** — the real GoF/architectural patterns (Strategy, Facade, Adapter,
  Registry, Repository, and more) actually in use, laid out as one connected graph.
- **Custom diagrams** — describe a diagram type once in plain language ("show me data flow, grouped
  by layer"), and reuse it across every repo. Each generated diagram is drawn as boxes and labeled
  arrows, with saved positions.
- **Natural-language research** — ask a question about the codebase ("where is JWT validated?")
  and get a synthesized, cited answer that jumps straight to the block.
- **Architecture map (C1→C2→C3→C4)** — an AI-generated semantic map that groups your code by
  meaning (system, container, component, element), not by folder. Generate it once, then click
  Update after a commit to patch only the affected pages instead of rebuilding the whole tree.
- **Epics & requirements view** — your requirements portfolio (work items, acceptance criteria,
  delivery artifacts) traced onto the same map, entirely offline and deterministic.
- **PR review workspaces** — paste a GitHub PR URL and browse its head as a read-only workspace,
  with every other view (diff, C1, patterns, research) working on it unchanged.
- **Parallel AI agents** — run several Claude Code sessions at once, each in its own git worktree,
  each visible as its own window on the canvas.
- **Desktop app** — a double-click `.app`/installer with no Python or Node required on the user's
  machine.
- **Works with or without an API key.** Analysis, the canvas, live sync, and diffs use a
  deterministic offline summarizer — no `ANTHROPIC_API_KEY` needed. Setting one unlocks AI features:
  C1/patterns/custom-diagram generation, the architecture map, AI summaries, and
  natural-language research.
- **Configurable LLM providers.** The gear icon's LLM settings panel lets you connect any provider
  (a CLI tool, a direct-API endpoint, or a local model) and route each feature — diagrams, research,
  epic briefs — to a different one. No panel touched means every feature keeps its old default
  behavior.

## Try it on your own repo

```bash
poetry install                      # Python engine + bridge
cd web && npm install && cd ..      # web canvas

poetry run python -m codechroma.bridge.launch --repo-path /path/to/your/repo
```

Open the URL it prints (usually `http://localhost:5173`) and start clicking. To use AI features,
either set `ANTHROPIC_API_KEY` before launch, or open the gear icon's LLM settings panel in the
canvas and connect a provider there — no restart needed. See
[`QUICKSTART.md`](./QUICKSTART.md) for the full walkthrough (prerequisites, options, manual
two-terminal setup) and [`web/QUICKSTART.md`](./web/QUICKSTART.md) to explore the UI offline against
a built-in demo repo, no backend required.

## Build it / develop it

**Python engine + bridge** (`src/codechroma/`, requires Python 3.14+ and [Poetry](https://python-poetry.org/)):

```bash
poetry install
poetry run pytest             # run all tests
poetry run ruff check .       # lint
```

**Web canvas** (`web/`, requires Node.js 20+ LTS):

```bash
cd web
npm install
npm test                      # Vitest
npm run e2e                   # Playwright end-to-end
npm run lint                  # ESLint
```

Full command reference, environment variables, and how the two halves connect (or run
independently against fixtures) are in [`CLAUDE.md`](./CLAUDE.md).

## How it's built

- **`src/codechroma/`** (Python) — parses the repo, builds the hierarchy graph, generates
  summaries, and serves it all over a FastAPI bridge with live file-watching.
- **`web/`** (TypeScript/React) — the nested expand-in-place canvas UI.
- **`desktop/`** — an Electron shell that packages both into one double-click app.

For a deeper dive into any subsystem — the analysis pipeline, the C1/patterns diagrams, the
research endpoint, PR workspaces, parallel agents, the desktop app — see the documentation map in
[`CLAUDE.md`](./CLAUDE.md#documentation-map), which points to one focused doc per subsystem in
[`docs/architecture/`](./docs/architecture/).
