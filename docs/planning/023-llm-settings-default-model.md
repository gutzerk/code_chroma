# 023 — LLM settings: one default model, optional per-feature overrides

Status: In progress (Stage 1 and Stage 2 routes done on both bridges; web dialog and Stage 4 docs remain)

Source: the "LLM Settings Redesign" design canvas (boards `Main.dc.html` — Models / Connections / Advanced, `AddConnection.dc.html`), https://claude.ai/artifact/ADcHT5eMJMvf1snZ7mpL9U. Builds on `docs/architecture/llm-settings.md` and `docs/architecture/assistant-settings.md`.

## Problem

The LLM dialog has four tabs (Providers, Model routing, Agent windows, CLI tools) and no single "use this for everything" choice. A user must assign the Diagrams group, the Planning group, Agent windows (on a different tab) and two simple call sites one by one, and the rules for which provider kind fits which row (agentic rows accept only `kind="cli"`, simple rows only `mode="api"`) surface only as validation errors.

## Goal

A user picks one connection plus one model and every feature uses it. Per-feature overrides stay possible but are optional. Every mismatch between a connection and a feature is explained in plain words before saving, not after.

## Decisions

| Topic | Decision |
|---|---|
| Vocabulary | "Provider" → **Connection** in the UI. "Call site / group" → **Feature**. Store and route names stay as they are (no data migration). |
| Features shown | Five rows: Diagrams (`diagrams` group), Planning & wiki (`planning` group), Agent windows (`agents` group, no longer hidden), Code summaries (`ai_summarizer`), First patterns draft (`initial_diagram_bootstrap`). |
| Capability | Every connection has two derived flags: `agents` (can drive a CLI agent) and `quick` (can answer a one-shot direct call). Computed server-side, never stored. |
| Default | A new `default` section in `llm-call-site-settings.json`: `{provider_id, model}` plus optional `quick_fallback` and `agent_fallback` (each `{provider_id, model}` or `{"offline": true}` for quick). |
| Resolution order | Explicit override (today's `assignments` / `group_assignments`) → default, if capable → matching fallback → today's pre-feature behavior (FR-009, unchanged). |
| Overrides | Existing assignments *are* the overrides. "Use default again" = today's clear route. Nothing existing is rewritten. |
| One Anthropic key for all | A `kind="api"`, `transport="anthropic"` connection is also `agents`-capable: its agentic runs go through `claude` with the key passed as `ANTHROPIC_AUTH_TOKEN` (the existing `_cli_env_overrides` path). A `kind="cli"`, `adapter="claude"` connection that carries an `api_key`/`api_key_path` is also `quick`-capable through `AnthropicProvider` (with its `base_url` when set). |
| Saving | Each click saves at once (same as today); footer says "Saved automatically". |
| Both bridges | Python (`src/codechroma/bridge`) and C# (`dotnet/CodeChroma.Bridge`) get identical routes and resolution; the desktop app uses the C# one. |

Capability table:

| Connection | `agents` | `quick` |
|---|---|---|
| `kind=cli`, `claude`, signed in (no key) | yes | no |
| `kind=cli`, `claude`, with key / endpoint | yes | yes |
| `kind=cli`, `codex` / `kimi-cli` | yes | no |
| `kind=api`, `anthropic` | yes (via `claude`) | yes |
| `kind=api`, `gemini` / `openai-compatible` / local | no | yes |

## Stage 1 — Backend: capability, default, resolution (Python, about 2 days)

Files: `src/codechroma/llm/call_site_settings.py`, `providers_store.py`, `call_sites.py`, `resolve_cli.py`, `src/codechroma/context/llm_provider.py`, `src/codechroma/bridge/skill_agent.py`.

1. `providers_store.capabilities(provider) -> Capabilities(agents, quick)` from the table above.
2. `call_site_settings.py`: `DefaultAssignment` dataclass, `load_default()` / `save_default()` / `clear_default()` (locked like the other sections), `validate_default()` (provider exists; fallbacks capable of the side they cover).
3. `load_assignment(call_site_id)` applies the resolution order: override → default when capable → fallback → `None` (caller keeps its legacy behavior). Synthesizes `mode="cli"` for agentic and `mode="api"` for simple, so callers stay untouched.
4. `resolve_cli()`: accept an `api`/`anthropic` provider, running the `claude` adapter with `_cli_env_overrides` built from its key and `base_url`.
5. `build_provider()`: accept a `cli`/`claude` provider that has a key, building `AnthropicProvider` from it.
6. `call_sites.py`: a fixed `FEATURES` table (id, label, one-line plain description, `needs: agents|quick`, members). Drop `HIDDEN_GROUPS` from the routing view.
7. `blocking_call_sites()` also counts the default and its fallbacks, so deleting the default connection is blocked with a clear message.

Tests: extend `tests/unit/test_llm_call_site_settings.py` (resolution order, each fallback, offline), `test_llm_providers_store.py` (capability table, parametrized), `test_llm_cli_adapters.py` (api/anthropic → claude env), and the `FEATURES` ↔ `GROUPS`/`CALL_SITES` sync check.

## Stage 2 — Routes (Python + C#, about 1–2 days)

Files: `src/codechroma/bridge/routes/llm_settings.py`, `dotnet/CodeChroma.Bridge/Routes/LlmSettingsRoutes.cs`, `Stores/LlmStores.cs`, `Stores/LlmCatalog.cs`, `Skills/CliResolver.cs`.

1. `GET /llm/default`, `PUT /llm/default`, `DELETE /llm/default`.
2. `GET /llm/features` returns all five rows with `effective {provider_id, provider_name, model}`, `source: default|custom|fallback|offline|legacy`, `needs`, and the list of compatible connections. The web never re-derives resolution.
3. `GET /llm/providers` adds `capabilities` and `used_by` (count of features).
4. Existing `/llm/call-sites/*` and `/llm/call-site-groups/*` stay as the override routes.
5. C# mirrors the Python store/resolution (`CallSiteStore.Default()`, `CliResolver.LoadAssignment` order). The `agents` group now resolves through the same path in `TerminalAgents.cs`.

Tests: `tests/unit/test_bridge_llm_settings_route.py`; a new `dotnet/CodeChroma.Bridge.Tests/Routes/LlmDefaultRoutesTests.cs` with the same cases, so both bridges answer the same payloads.

## Stage 3 — Web dialog (about 3 days)

Files: `web/src/llm-settings/` — `LlmSettingsPanel.tsx`, new `ModelsTab.tsx`, `DefaultCard.tsx`, `FeatureRow.tsx`, `ConnectionsTab.tsx` (from `ProvidersSection.tsx`), `AddConnectionDialog.tsx`, `AdvancedTab.tsx` (wraps `AssistantSection` + `RuntimeSection`), `llmSettingsClient.ts`, `web/src/styles.css`.

1. Tabs: Models, Connections, Advanced.
2. Models tab: default card (connection cards with capability line, model pills from `GET /llm/providers/{id}/models`, the inline fallback box when the default lacks a capability), then the five feature rows that expand in place to override. "Use default again" per row, "Reset all to default".
3. Connections tab: list with capability, "used by N features", Test, Edit; Add opens the two-group type picker (CLI tools / API key or server) showing "Can be used for …" before save, and only the fields that type needs.
4. Advanced tab: CLI tool paths and the agent-window instruction; nothing else.
5. Retire `CallSitesSection.tsx` and `useGroupAvailability.ts` once their behavior lives in `FeatureRow`; keep `HelpHint` for the per-feature technical description.
6. Colors: neutral grays with one blue accent (as on the canvas), using the existing tokens in `styles.css`.

Tests: `ModelsTab.test.tsx` (pick default → all rows show Default; CLI-only default shows the quick fallback; override then reset), `ConnectionsTab.test.tsx`, `llmSettingsClient.test.ts`; update `LlmSettingsPanel.test.tsx`; a Playwright journey for "set one model for everything".

## Stage 4 — Docs and cleanup (half a day)

1. `docs/architecture/llm-settings.md`: the default section, resolution order, capability table, new routes, new tab layout.
2. `docs/architecture/assistant-settings.md`: Agent windows now sit in the Models tab as a feature row; the fallback form moved under Advanced.
3. README/QUICKSTART screenshots or text that mention "Model routing".

## Open questions

- Should a first-run user (no connections) get a one-step "Sign in with Claude Code / paste an Anthropic key" prompt in the Models tab, instead of an empty default card?
- Should the quick-task fallback default to Offline (no cost, today's behavior) or nudge to the cheapest model of the default's family?
- Project-scoped overrides (per repo) are out of scope; settings stay machine-scoped.

## Exit check

On a clean machine: add one Anthropic API connection, pick it as default with one model, then run a diagram, a planning brief, an agent window and a repo analyze. All four use that connection and model, with no other setting touched.
