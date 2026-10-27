# Assistant settings — which assistant, its credentials, and its instructions

The store and route below pick **which assistant** the app runs and its **credentials**; the config
is machine-scoped and persists, so it survives restarts and a re-open on the same laptop without
re-entering it. The web surface for this is no longer its own dialog: since
[`llm-settings.md`](llm-settings.md) shipped, the gear on the canvas chrome opens a small settings
home first, and agent windows are chosen by the "Agent windows" row on that dialog's Models tab
(there is no separate agent-provider form any more, and the CLI+token form that used to edit this
store was removed from the UI earlier), though the Python store/route below are unchanged and are
still what unassigned windows and skills read on disk. A CLI-provider + model choice there routes every `agent`-kind window (every
window the UI now launches, per [`parallel-agents.md`](parallel-agents.md)) through
`llm.resolve_cli`'s `parallel_agents` group: it writes the `agents` group assignment via
`PUT /llm/features/agents` (which writes the `agents` group assignment, the **same** store 061's
launch path reads; see [`llm-settings.md`](llm-settings.md)). Empty
selection = the platform's default `claude` CLI, so FR-012's default is preserved.

## What it controls

| Surface | File | Effective setting |
|---|---|---|
| Skill-agent (diagram generation, epic briefs) | `bridge/skill_agent.py` `_run_claude` | the saved `cli` binary + `model` flag |
| Parallel agents (interactive PTY) | `terminal/agents.py` `agent_cli` | the saved `cli` binary; 061's `agent` kind routes through the LLM provider store instead |
| One-shot C1/patterns generators | `context/llm_provider.py` `provider_from_env` | the saved API key (or key file) |

Before this feature each surface hardcoded `claude` and read only `ANTHROPIC_API_KEY`; now they read
the saved assistant settings first and fall back to those defaults when unset.

## The store (`src/codechroma/assistant.py`)

- Lives in the user's home directory, like the diagram-type library
  (`diagrams/library.py`): the assistant choice is a machine-level preference, not repo-bound.
- Path: `$codechroma_ASSISTANT_SETTINGS_FILE` when set, else `~/.codechroma/assistant-settings.json`
  (same env-var escape hatch as `library_dir()`/`worktrees_root()`).
- Shape (`schema_version: 1`): `cli`, `model`, `api_key`, `api_key_path`, `instruction`.
  - `model` is optional; `null` means "use each generator's built-in default".
  - Credentials are either a raw `api_key` **or** an `api_key_path` (first non-comment line of the
    file is the key) — never both.
- `validate()` rejects a slash in `cli` (it becomes an executable name, never a path), both-key-and-
  path, and an empty model.
- Every reader calls `load_assistant_settings()`, which re-reads the tiny file each time — so a PUT
  applies to the running bridge on the next use, no restart.

🔴 This file holds a raw API key in plaintext, exactly like `ANTHROPIC_API_KEY` in `.env` already
does. The web UI only ever serves over localhost, and the GET route returns a **masked** payload
(`api_key_set: bool`, never the key).

## The route (`bridge/routes/assistant.py`)

Not repo-scoped — no `Services` dependency.

- `GET /assistant/settings` → masked effective settings.
- `PUT /assistant/settings` → validate + persist; a masked GET payload round-trips (it re-sends
  `model: null` / `api_key_path: null`, which `validate()` treats as "unset").
- A `PUT` whose body is only `{instruction}` merges into the stored settings (cli/model/key kept) -- the Advanced tab's textarea uses it. Claude agent windows launch with `--append-system-prompt <instruction>` when it is non-empty (`terminal/agents.py` `_instruction_args`, C# `TerminalAgents.InstructionArgs`); a running window keeps the instruction it started with.
- `POST /assistant/settings/test` → connectivity probe: whether the chosen CLI is on PATH, where
  the API key resolves from (`key_source()` in `context/llm_provider.py`: settings / file / env /
  none), and one real, tiny (`max_tokens=1`) model call. Returns `{ok, cli, cli_found,
  auth_source, error|message}`; never fails with a non-2xx (problems come back as `ok: false`).
- Registered in `bridge/routes/__init__.py` `ROUTERS`.

## Web

- `web/src/assistant/SettingsRailButton.tsx` — the gear button on the canvas chrome,
  self-contained open state (mirrors `PrRailButton`). Opens `SettingsDialog.tsx`, a category-list
  home ("LLM", "Canvas style" and "Updates"; "Report an issue" is its own top-bar button — see
  [`report-issue.md`](report-issue.md)) rather than this form directly.
- `web/src/canvas-style/` — the "Canvas style" category: `CanvasStylePanel.tsx` (theme presets,
  background colour, None/Dots/Lines texture with colour/opacity/spacing, light-background warning,
  reset; edits go to a local draft and only the Apply button commits them to the store) over `canvasStyleStore.ts`, a global `Store` whose machine-wide copy is the bridge's
  `~/.codechroma/canvas-style.json` (`codechroma_CANVAS_STYLE_FILE` overrides; `GET/PUT/DELETE /canvas-style`,
  `Routes/CanvasStyleRoutes.cs`, C# bridge only): every project has its own bridge port and so its own browser storage,
  so the style set in one project reaches the others through that file. The store reads `localStorage` key
  `codechroma.canvasStyle` first (instant paint), then `hydrate()` adopts the bridge copy, or uploads the browser's own
  style when the bridge has none; every committed style (Apply) writes both. Without a bridge (mock) only `localStorage` is used. `null` = never customised = the built-in canvas
  look; `CanvasViewport.tsx` sets a saved style as the `--canvas-bg`/`--canvas-texture-image` vars
  that `.canvas-viewport` paints (falling back to the built-in look) and feeds its spacing to `gridStepFor` (`canvasGrid.ts`). Only the canvas
  background changes -- block and edge colours stay as the diagram sets them.
- `web/src/llm-settings/AgentInstructionSection.tsx` — the Advanced tab's instruction textarea (`GET`/instruction-only `PUT /assistant/settings`).
- `web/src/icons/RailIcon.tsx` — the `settings` (gear) icon, still on the rail button; the
  `llm-providers` icon (also added by `llm-settings.md`) now lives inside the settings home's LLM
  row instead of a second rail button.

## Tests

- `tests/unit/test_assistant_config.py` — store load/save/validate/mask.
- `tests/unit/test_bridge_assistant_route.py` — GET masks the key, PUT validates, round-trips.
- `web/src/assistant/assistantClient.test.ts`. `SettingsDialog.test.tsx` tests the category-list
  home (see [`llm-settings.md`](llm-settings.md#tests)).

## Out of scope (v1)

- Applying a changed assistant to **already-running** interactive agents mid-session.
- A live model list from the bridge (the probe hard-codes one cheap model).
- Committing the settings into the repo (`AGENTS.md` / `CLAUDE.md`) — those stay the separately
  committed per-project instructions; this feature covers the machine-level selection.
