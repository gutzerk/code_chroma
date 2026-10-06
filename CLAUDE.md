# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

CodeChroma builds a semantic, zoomable architecture hierarchy (System → Pillar → Component →
Service → Function → Logic Block → Code) from a repository's actual code structure — not its
directory layout — so AI agents and humans can navigate a codebase like a map instead of scrolling
files. The repo has two independent halves:

- **`src/codechroma/`** (Python, epic 001) — parses a repo, builds the hierarchy graph, generates
  AI/offline summaries, and persists to SQLite. This is `GraphEngine`, the public API.
- **`web/`** (TypeScript/React, epic 002) — the nested expand-in-place canvas UI.

For **graph data** (the hierarchy itself) a real bridge now exists and is live-wired end-to-end:
`src/codechroma/bridge/app.py`'s `create_app()` builds a FastAPI app serving real
`GraphEngine.analyze()` output over HTTP, plus `WS /repos/{id}/events` that pushes a "changed" ping
whenever the repo changes on disk. A
`RepoWatcher` (`bridge/live.py`, watchfiles) detects edits, `GitSync` (`bridge/git_sync.py`)
reanalyzes just the changed files, and the socket tells connected canvases to re-fetch — so editing
code updates the canvas (and the diff overlay) without reload. The canvas still defaults to the
fixture-backed mock (`web/src/engine-client/mockBridge.ts`) when `VITE_ENGINE_BRIDGE_URL` is unset;
set it (or use the one-command launcher below) to hit the real bridge. The live bridge runs the
offline summarizer only — it never calls Claude, so a reanalyze on every save stays instant.

A second, unrelated bridge — an embedded terminal — is also real: `src/codechroma/terminal/server.py`
exposes `WS /ws/terminal`, and `web/src/terminal/TerminalClient.ts` connects over a real WebSocket
(see [`docs/architecture/terminal-bridge.md`](docs/architecture/terminal-bridge.md)). Don't conflate
the two graph vs terminal sockets.

## Commands

### Python engine (`src/codechroma/`, repo root)

```bash
poetry install                      # install deps (Python >=3.14)
poetry run pytest                   # run all tests
poetry run pytest -n auto           # same, parallelized across CPU cores (pytest-xdist) -- prefer
                                     # this for a full run; the suite is single-process/sequential
                                     # by default and includes real PTY/subprocess/timer tests that
                                     # make a full serial run take ~15-20 minutes
poetry run pytest tests/unit/test_analyzers.py::test_name   # single test
poetry run pytest tests/unit tests/contract tests/integration  # by suite (see tests/ layout below)
poetry run ruff check .             # lint (rules: E, F, I, UP, B; line-length 100)
poetry run python scripts/bench_analyze.py [path]   # SC-001 perf check: analyze() on ~50k-line repo, must finish <5min
```

Without `ANTHROPIC_API_KEY` set (env or `.env`), `AISummarizer` transparently falls back to
deterministic offline summaries — the engine works end-to-end with no credentials either way.

```bash
poetry run uvicorn codechroma.terminal.server:app --port 8000   # terminal bridge, for web's embedded shell panel
poetry run uvicorn codechroma.bridge.server:app --port 8000      # graph bridge (set codechroma_BRIDGE_REPO_PATH to target a repo)
python -m codechroma.bridge.launch --repo-path /path/to/repo     # one command: analyze that repo, then boot the live canvas
```

The launcher analyzes `--repo-path` with the live bridge, waits for the initial analyze, then starts
Vite pointed at it (any `VITE_*` env vars are forwarded). Ctrl-C
tears down both. The bridge watches the repo and pushes changes to the canvas in real time.

### Web canvas (`web/`)

```bash
npm install
npm run dev                         # http://localhost:5173, uses mockBridge by default
npm run build                       # tsc -b && vite build
npm run lint                        # eslint . --ext .ts,.tsx
npm test                            # vitest run (single file: npm test -- Block.test.tsx)
npm run test:watch                  # vitest watch mode
npm run e2e                         # playwright (auto-boots dev server)
```

To point the canvas at the real graph bridge: `VITE_ENGINE_BRIDGE_URL=http://localhost:8000 npm run dev`
(or just use the `codechroma.bridge.launch` one-command launcher above, which wires this for you). The
canvas then live-updates as the repo changes — new/edited/deleted functions appear without reload,
and the diff overlay refreshes in place. The terminal panel targets `ws://localhost:8000` by default
(`VITE_TERMINAL_BRIDGE_URL` to override). The hierarchy always renders as nested boxes — there is no
boxes-vs-tree selector (the old `?strategy=` / `VITE_CANVAS_STRATEGY` switch was removed).

### Desktop app (`desktop/`)

Build/run commands and architecture notes both live in
[`docs/architecture/desktop-app.md`](docs/architecture/desktop-app.md). End-user install is
`curl -fsSL https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh | sh`
(macOS arm64/x64 / Linux x64) or `distribution/install.cmd` (Windows): the shell installer reads
the published `distribution/latest.json` manifest and installs per-user without administrator
privileges by default (macOS and Linux AppImage in `~/Applications`); pass `--system` to opt into
`/Applications` or the Linux `.deb` package. The Windows installer resolves the latest release's
setup and checksum directly from GitHub.

**Releases ship via GitHub, not local builds.** `.github/workflows/release-please.yml` runs
`release-please` (using the `code_pat_release` repository secret so merging its Release PR triggers
the release build) on every push to `main`: it bumps the version, writes CHANGELOG, tags `vX.Y.Z`
and opens a Release PR. Merging it triggers builds for macOS arm64/x64, Windows x64, and Linux x64.
Author version is
`desktop/package.json`; `release-please-config.json` syncs it with `web/package.json` and
`pyproject.toml`. Files are versioned with Conventional Commits (`feat:`/`fix:`/`BREAKING CHANGE:`),
since that's what release-please parses.

## Documentation map

This file is a front door only. Every subsystem's detailed architecture notes — the 🔴/⚠ load-bearing
gotchas, exact file paths, and test references — live in `docs/architecture/`, one file per part.
Open the relevant file before making a non-trivial change in that area.

| File | Covers |
|---|---|
| [`docs/architecture/engine.md`](docs/architecture/engine.md) | `GraphEngine` pipeline: Analyzers, GraphBuilder, AISummarizer, GraphStore, Dependency digest, `reanalyze()`, contract tests |
| [`docs/architecture/config-and-prompts.md`](docs/architecture/config-and-prompts.md) | `config.py`'s pydantic `Settings` (every tunable limit/timeout/model name) and `prompts/*.yaml` (every Claude system/user prompt) |
| [`docs/architecture/terminal-bridge.md`](docs/architecture/terminal-bridge.md) | Embedded terminal (PTY sizing, env, frame protocol) — unrelated to the graph bridge |
| [`docs/architecture/graph-bridge-core.md`](docs/architecture/graph-bridge-core.md) | Bridge app factory, `Workspace`/registry, live-reanalyze plumbing (`live.py`/`git_sync.py`/`git_diff.py`/`plan_resolver.py`), `launch.py` + skill-sync |
| [`docs/architecture/single-canvas.md`](docs/architecture/single-canvas.md) | The one canvas document (016-single-canvas-dashboard, Stages 1–6, done): `CanvasDoc`/`Element`/`Edge`, the `apply_batch` write point, recipes (`canvas/recipes.py`, `RecipeMenu`), `RootCanvas` rendering `web/src/canvas/doc/` unconditionally, and the Stage 6 backend route/doc cleanup (the earlier `codechroma-canvas` chat skill was removed at that stage) |
| [`docs/architecture/diagram-skills.md`](docs/architecture/diagram-skills.md) | The one drawing skill (`codechroma-draw-diagram`): its router + per-type references, the unified `check_diagram.py` and its exit tiers/density budgets, retiring a merged-away skill, the two-layer soft-diagnostics path (`diagram_diagnostics.py` → `DiagramHealthNote`), and how a drawn diagram reaches the canvas |
| [`docs/architecture/c1-diagram.md`](docs/architecture/c1-diagram.md) | C1 system-context view: generation, resolver, relationships, arrow rendering, change review |
| [`docs/architecture/patterns-diagram.md`](docs/architecture/patterns-diagram.md) | Design Patterns diagram: heuristic detection, skill-agent generation, dagre clustering |
| [`docs/architecture/epics-view.md`](docs/architecture/epics-view.md) | Epics & requirements view: `RequirementsSource`/`DeliverySource` ports, the markdown adapters, the four routes, the `epic-*` node-id namespace, and the opt-in AI-brief path (`epic_brief_agent.py`, the `codechroma-epic-brief` skill, `EpicBriefView`) |
| [`docs/architecture/trace.md`](docs/architecture/trace.md) | Execution trace playback: `src/codechroma/trace/` (`Tracer`'s `sys.monitoring`/`settrace` capture, `FrameMapper`, the `codechroma-trace` CLI), `.codechroma/traces/*.json` storage, the `trace-ingest`/`trace-stream` live-relay sockets, `traceStore.ts`/`TraceFlowOverlay.tsx`/`TraceControls.tsx` |
| [`docs/architecture/custom-diagrams.md`](docs/architecture/custom-diagrams.md) | User-defined custom diagrams: the cross-project `~/.codechroma/diagram-types` library, the style registry, the definition-driven generator (`codechroma-draw-diagram`, custom type), `routes/custom_diagrams.py` — the in-app authoring interview (`codechroma-diagram-type`, `DiagramTypeWizardPanel.tsx`) is retired; see the doc's own retirement note |
| [`docs/architecture/change-cards.md`](docs/architecture/change-cards.md) | Change cards — the deterministic half of the Diff toggle |
| [`docs/architecture/pr-workspaces.md`](docs/architecture/pr-workspaces.md) | PR review workspaces — a pull request as a read-only `Workspace` |
| [`docs/architecture/parallel-agents.md`](docs/architecture/parallel-agents.md) | Parallel agents: one `claude` per git worktree, backend + canvas window layer |
| [`docs/architecture/assistant-settings.md`](docs/architecture/assistant-settings.md) | Assistant settings: `~/.codechroma/assistant-settings.json` store (CLI/model/creds/instruction), `GET/PUT /assistant/settings`, `src/codechroma/assistant.py`, gear dialog on the chrome |
| [`docs/architecture/report-issue.md`](docs/architecture/report-issue.md) | The "Report an issue" dialog: `CreateIssueDialog.tsx`'s prefilled `github.com/.../issues/new` link (no API/token), its top-bar `ReportIssueRailButton` entry point, the app-version/OS line, and its design tokens |
| [`docs/architecture/llm-settings.md`](docs/architecture/llm-settings.md) | LLM provider settings: `src/codechroma/llm/` (providers/call-sites/adapters stores+registries), `context/llm_provider.py`'s `build_provider`, `skill_agent.py`'s `_run_cli`, `bridge/routes/llm_settings.py`, `web/src/llm-settings/` — separate from, and untouched by, assistant-settings/canvas parallel-agents |
| [`docs/architecture/web-canvas-shell.md`](docs/architecture/web-canvas-shell.md) | Canvas shell: `RootCanvas`, rail, `strategies/` (boxes/tree + `TopLevelChildren`), `highlighting/`, `CodePopup`, `ConnectionsOverlay` |
| [`docs/architecture/web-collision-drag.md`](docs/architecture/web-collision-drag.md) | `collision/`: solo collision-avoidance + Miro-style multi-select/group-drag |
| [`docs/architecture/web-panels.md`](docs/architecture/web-panels.md) | `src/terminal/` (xterm), `src/breadcrumb/`, `src/games/` (rail games menu + Snake) — the small IDE-chrome panels |
| [`docs/architecture/web-engine-client.md`](docs/architecture/web-engine-client.md) | `src/engine-client/`, `src/state/`, and the `src/agents/` cross-reference |
| [`docs/architecture/desktop-app.md`](docs/architecture/desktop-app.md) | Desktop app: build/run commands and packaging architecture |
| [`docs/architecture/architecture-assessment.md`](docs/architecture/architecture-assessment.md) | Whole-repo architecture assessment: what's done well, what needs fixing, top risks to future features — a point-in-time review, not a living reference |
| [`docs/architecture/skill-artifact-merge.md`](docs/architecture/skill-artifact-merge.md) | The "fresh source + authored overlay + id-splice + fingerprint staleness" idiom shared by `resolve_patterns._merge`, `resolve_c1`/`c1_changes`, and `resolve_brief` |
| [`docs/architecture/wiki-generator.md`](docs/architecture/wiki-generator.md) | On-demand, docstring-only repo wiki: `GraphEngine.generate_wiki()`, `wiki/generator.py` + `wiki/writer.py`, Python-only docstring/module-variable extraction, the gap report, `.codechroma/wiki/` output |
| [`docs/architecture/wiki-general.md`](docs/architecture/wiki-general.md) | The AI-generated semantic architecture map (C1→C2→C3→C4), a sibling of the plain wiki: `codechroma-wiki-general` skill + `check_wiki_general.py`, the `wiki_general_agent.py` `SkillAgent` (not a diagram type), `routes/wiki_general.py`, the canvas's first real Generate button (`WikiGeneralNotice.tsx`) |

`docs/planning/` (format doc: `docs/planning/README.md`) and `specs/<NNN>-<slug>/` (Spec Kit output)
are a different kind of doc — pre-build feature specs, not current-state reference. See "Repo-wide
conventions" below.

## Investigation policy

Route non-trivial tasks through the Documentation map above before searching broadly:

1. Find the affected subsystem in the table and read that `docs/architecture/*.md` file.
2. Search for the exact symbol/route/component name inside the file(s) it points to.
3. Check callers and the test file(s) it references.
4. Fall back to a repo-wide search only if the targeted search above doesn't answer the question.

Stop once you can name the entry point, the file(s) that own the behavior, and the test(s) that
verify it — don't read unrelated subsystems just to build general context. Skip `node_modules/`,
`dist/`, `build/`, `.venv/`, `playwright-report/`, `test-results/`, and other `.gitignore`d paths
during initial investigation; open them only if the task explicitly concerns generated output.

If a `.codechroma/dependency-digest.json` exists for the repo you're investigating (written by every
`GraphEngine.analyze()`/`reanalyze()` — see `docs/architecture/engine.md`), it's already a capped
file → class → function map with resolved callers/callees. Prefer reading it over re-deriving an
import graph by grep when it's present.

## Repo-wide conventions

- **One-line comments/docstrings only.** A `PostToolUse` hook
  (`.claude/hooks/check-test-and-doc-style.py`) blocks edits that introduce multi-line `#` comment
  runs or multi-line docstrings on classes/functions — fails open (never blocks on its own errors).
- **Arrange-Act-Assert in tests**, enforced by the same hook: no setup statements (`Assign`/
  `AnnAssign`/`AugAssign`) after a test function's final `assert`.
- The same hook also runs an advisory-only check (`_check_duplicate_shape`): if two `test_*`
  functions in a file are structurally identical once literals are stripped, it prints a
  non-blocking suggestion to use `@pytest.mark.parametrize` instead. Never blocks the edit.
- Referenced but not present in this checkout: `goal.md` (product vision), `CODE-QUALITY.md`. Several
  source files and READMEs point at these paths; don't assume their content, and don't recreate them
  speculatively.
- **`specs/` vs `docs/planning/` — two stages of the same feature, not duplicates.** `docs/planning/`
  is where a feature is *decided* (hand-written design doc, decision table, staged plan);
  `specs/<NNN>-<slug>/` is where the `/speckit-*` commands *formalize* that decision into
  `spec.md` → `plan.md` → `tasks.md` plus `research.md`/`data-model.md`/`contracts/`. The planning doc
  stays the human source of truth for *why*; the spec directory is the generated, checklist-validated
  *what/how* that `/speckit-implement` executes against. Keep the `NNN` prefix identical in both
  (`docs/planning/007-…` ↔ `specs/007-…`) — the number is the join key. `.specify/feature.json` holds
  the active feature directory the `/speckit-*` commands resolve against, and
  `.specify/memory/constitution.md` holds the project rules every `/speckit-plan` checks its design
  against. `.specify/templates/` holds the five `/speckit-*` templates (`spec-`, `plan-`, `tasks-`,
  `checklist-`, `constitution-template.md`); there is no `.specify/scripts/` in this checkout, so
  commands that would use one fall back to their built-in defaults. Older references to
  `specs/002-zoomable-architecture-canvas/` predate this and point at nothing.
- **`.specify/memory/constitution.md`** — six principles (deterministic core, lazy-by-default,
  extend-through-ports, per-level testing, one-line comments, docs-move-with-code) plus the quality
  gates and the feature ladder. It restates the rules the conventions in this section already imply,
  in the form `/speckit-plan` gates against; it is not a second, competing set. Where the two
  disagree, the constitution wins and this file gets corrected.
- **`docs/planning/`** — the feature-planning convention (format doc: `docs/planning/README.md`): one
  markdown file per feature, status ladder `Idea → Specification → In progress → Done → Cancelled`,
  explicit hand-off rule that the file "stops being the source of truth" once the feature "is
  described in `CLAUDE.md`" — i.e. upstream of this file, not a duplicate of it. Its own index has
  already drifted from the per-feature READMEs it lists (a status shown in one place doesn't always
  match the other) — treat the index as a pointer, not as ground truth.
- **Keep ALL documentation in sync with every change — always update docs after edits when needed.**
  This is the default, not an opt-in: before you finish any change, check whether it alters what
  any user-facing or maintainer-facing doc describes — `README.md`, `QUICKSTART.md`,
  `web/QUICKSTART.md`, the `docs/architecture/*.md` files covered by the Documentation map above,
  `CONTEXT.md`, or `CLAUDE.md` itself — and update the affected files **in the same change**, not in
  a follow-up. Update with the new behavior, new file paths, corrected gotchas, whatever changed.
  Concretely:
  - Rewrite a feature's UI, an env var, a command, or a file's role → update the README/QUICKSTART
    section that documents it.
  - Modify a subsystem covered by one of the `docs/architecture/*.md` files → update that file.
  - Introduce a genuinely new subsystem that doesn't fit an existing file → create
    `docs/architecture/<name>.md` and add its row to this file's Documentation map.
  - The repository is actively evolving, so drift is real: when a task touches code whose docs you
    suspect are stale, check and correct the surrounding docs — do not assume they are current.
  This is a written policy, not hook-enforced — same trust model this repo already uses for
  `docs/planning/`'s own hand-off rule. Do not let detail pile back up into this file — `CLAUDE.md`
  stays a short front door.

## Agent skills

### Issue tracker

Local markdown under `docs/planning/` (feature specs) and `docs/planning/wayfinder/<effort>/`
(wayfinder maps/tickets) — no external tracker. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`).
See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
