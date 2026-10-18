# Assistant settings — which assistant, its credentials, and its instructions

The store and route below pick **which assistant** the app runs and its **credentials**; the config
is machine-scoped and persists, so it survives restarts and a re-open on the same laptop without
re-entering it. The web surface for this is no longer its own dialog: since
[`llm-settings.md`](llm-settings.md) shipped, the gear on the canvas chrome opens a small settings
home first, and that dialog's "Agent windows" tab (`AssistantSection.tsx`) is now **solely** the
agent **provider** picker — the CLI+token form that used to edit this store was removed from the
UI, though the Python store/route below are unchanged and are still what unassigned windows and
skills read on disk. A CLI-provider + model choice there routes every `agent`-kind window (every
window the UI now launches, per [`parallel-agents.md`](parallel-agents.md)) through
`llm.resolve_cli`'s `parallel_agents` group: it writes the `agents` group assignment via
`PUT /llm/call-site-groups/agents` (the **same** store 061's launch path reads; that group is
tab-hidden from the Model routing table — see [`llm-settings.md`](llm-settings.md)). Empty
selection = the platform's default `claude` CLI, so FR-012's default is preserved.

## What it controls

| Surface | File | Effective setting |
|---|---|---|
| Skill-agent (diagram generation, epic briefs) | `bridge/skill_agent.py` `_run_claude` | the saved `cli` binary + `model` flag |
| Parallel-agent windows (interactive PTY) | `terminal/agents.py` `agent_cli` | the saved `cli` binary; 061's `agent` kind routes through the LLM provider store instead |
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
- `POST /assistant/settings/test` → connectivity probe: whether the chosen CLI is on PATH, where
  the API key resolves from (`key_source()` in `context/llm_provider.py`: settings / file / env /
  none), and one real, tiny (`max_tokens=1`) model call. Returns `{ok, cli, cli_found,
  auth_source, error|message}`; never fails with a non-2xx (problems come back as `ok: false`).
- Registered in `bridge/routes/__init__.py` `ROUTERS`.

## Web

- `web/src/assistant/SettingsRailButton.tsx` — the gear button on the canvas chrome,
  self-contained open state (mirrors `PrRailButton`). Opens `SettingsDialog.tsx`, a category-list
  home ("LLM" and "Updates"; "Report an issue" is its own top-bar button — see
  [`report-issue.md`](report-issue.md)) rather than this form directly.
- `web/src/assistant/AssistantSection.tsx` — the actual form, unchanged behavior from the old
  `SettingsDialog.tsx`: a provider dropdown (claude/codex → `cli`) and a token field (→ `api_key`),
  with Save. There is no instruction field (per-project instructions live in the separately
  committed `AGENTS.md`/`CLAUDE.md`), and no file-based-key option in the UI. "Copy setup prompt"
  copies a how-to the user can follow to set credentials by hand or via env, and "Test connection"
  calls the probe above and shows a pass/fail line. No-bridge (`VITE_ENGINE_BRIDGE_URL` unset) shows
  a hint instead. Reached via the "LLM" row → the "Agent windows" tab — see
  [`llm-settings.md`](llm-settings.md#web).
- `web/src/assistant/assistantClient.ts` — `GET`/`PUT /assistant/settings` and
  `POST /assistant/settings/test` over the bridge; unchanged.
- `web/src/icons/RailIcon.tsx` — the `settings` (gear) icon, still on the rail button; the
  `llm-providers` icon (also added by `llm-settings.md`) now lives inside the settings home's LLM
  row instead of a second rail button.

## Tests

- `tests/unit/test_assistant_config.py` — store load/save/validate/mask.
- `tests/unit/test_bridge_assistant_route.py` — GET masks the key, PUT validates, round-trips.
- `web/src/assistant/AssistantSection.test.tsx` — the form (was `SettingsDialog.test.tsx`);
  `assistantClient.test.ts`. `SettingsDialog.test.tsx` now tests the category-list home instead
  (see [`llm-settings.md`](llm-settings.md#tests)).

## Out of scope (v1)

- Applying a changed assistant to **already-running** interactive agents mid-session.
- A live model list from the bridge (the probe hard-codes one cheap model).
- Committing the settings into the repo (`AGENTS.md` / `CLAUDE.md`) — those stay the separately
  committed per-project instructions; this feature covers the machine-level selection.
