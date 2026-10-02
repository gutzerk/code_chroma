# LLM settings — provider connections, per-feature routing, and the agent-window fallback

One settings surface, reached from the single gear (`SettingsRailButton` → `SettingsDialog`'s
category list → the "LLM" row → `LlmSettingsPanel`). There is no separate LLM rail button anymore —
it and the old gear form were merged into one tabbed dialog so a user has exactly one place to touch
credentials and routing, not two. The dialog manages named **provider connections** (a CLI tool or a
direct-API endpoint, including a local model), assigns one plus a model to any of the product's AI
call sites, and holds the agent-window fallback credentials that used to be the gear's whole job.
Machine-scoped throughout. An unassigned call site keeps its exact pre-feature default behavior
(FR-009) — this feature is additive, never a required migration; `assistant-settings.md`'s store and
route still exist unchanged underneath the "Agent windows" tab (FR-012: this feature does not touch
parallel-agent startup — a plain `claude` agent record takes the fallback path unchanged; only an
`agent`-kind window, deliberately opted in, routes through the provider mechanism. See
`parallel-agents.md`).

## What it controls

| Call site | Capability | Group | File | Resolves via |
|---|---|---|---|---|
| `ai_summarizer` | simple | — | `summarize/ai_summarizer.py` | `build_provider(assignment)` |
| `initial_diagram_bootstrap` | simple | — | `context/patterns_generator.py` | `build_provider(assignment)` |
| `c1_agent`, `patterns_agent`, `impact-changes_review_agent`, `impact_agent` | agentic | `diagrams` | `bridge/skill_agent.py` `_run_cli` | its group's assignment (mode is always `cli`) |
| `research_agent` | agentic | `research` | `bridge/skill_agent.py` `_run_cli` | its group's assignment |
| `epic_brief_agent`, `wiki_general_agent`, `wiki_general_update_agent` | agentic | `planning` | `bridge/skill_agent.py` `_run_cli` | its group's assignment |
| `parallel_agents` | agentic | `agents` | `terminal/agents.py` `agent_cli` → `llm/resolve_cli.py` | its group's assignment, else `effective_cli` |

**(2026-09-07)** Agentic call sites are assigned by **group**, not individually — one provider
choice covers a whole task type at once (picking a provider for "Diagrams" routes C1, the
impact-changes review, Patterns and Impact together). `call_sites.py`'s `GROUPS` maps a
group id to its `label` and `members` tuple; `group_of(call_site_id)` returns the owning group id
(`None` for a `simple` call site). `diagram_type_agent` was a member of `diagrams` here until the
diagram-management unification retired it along with the interview it drove. Every agentic id must
appear in exactly one group — a unit test
in `test_llm_call_site_settings.py` asserts the catalog and `GROUPS` stay in sync. `simple` call
sites are unaffected: they keep their own individual assignment, exactly as before this addendum.

**(2026-09-07)** `c1_generator` and `patterns_generator` were two separate `simple` call sites with
identical mechanics (a one-shot direct-API/CLI-mode call that runs at most once per repo, before its
artifact exists) — showing them as two rows next to the agentic `c1_agent`/`patterns_agent` rows
(now labeled "C1 diagram (regenerate)"/"Patterns diagram (regenerate)" to avoid reading as
duplicates) read as unexplained duplication. Merged into one call site, `initial_diagram_bootstrap`:
both `c1_generator.py` and `patterns_generator.py` set `CALL_SITE_ID =
"initial_diagram_bootstrap"` and call `load_assignment()` with it, so one provider/model choice
governs both bootstrap calls. This is a naming/catalog change only — no new resolution mechanism;
each module's own `generate_c1()`/`generate_patterns()` is untouched.

**(2026-09-09, 043)** `c1_generator.py` is deleted. C1's bootstrap is now a deterministic table
lookup (`context/c1_template.py::generate_c1_template`) with no model call and no credential — it
never reads `initial_diagram_bootstrap`'s assignment. That call site is now `patterns_generator.py`
only; the row above and this note both reflect that. `c1_agent` (the interactive skill's regenerate
path) is unaffected — it's a separate, agentic call site.

The 8 agentic ids are exactly each `SkillAgent`'s `name=` — `skill_agent.SkillAgent._resolve_cli()`
still looks up `load_assignment(self.name)`, unchanged; `load_assignment()` itself now delegates to
the call site's group assignment when `group_of()` resolves one, so `_resolve_cli()` needed no
change. Each `CallSite` also carries a `description`: a direct, mechanism-level sentence naming the
actual file/class and what it sends to and does with the model's reply (not marketing copy) — that
string is what the Model routing tab's per-row `HelpHint` shows (for a group, one row's `HelpHint`
lists every member's description), and it is the route's only source for it (`GET /llm/call-sites`
joins it straight through, nothing computed in the web layer).

## The two stores

Both mirror `assistant.py`'s idiom (`@dataclass` + free `validate()`/`load_...()`/`save_...()`
functions), not pydantic — matching the existing convention for a small, hand-validated JSON file.

- **`src/codechroma/llm/providers_store.py`** — `~/.codechroma/llm-providers.json`
  (`$codechroma_LLM_PROVIDERS_FILE` override), written `0o600` since it holds plaintext `api_key`
  values. A named collection (dict of `id -> Provider`), unlike `assistant.py`'s single object, so it
  has full CRUD: `create_provider`/`update_provider`/`delete_provider`/`find_provider`/
  `load_providers`, each holding `io.locked(providers_path())` (an `flock`-based file lock) across
  its load-modify-persist span so two concurrent writes can't silently drop one. `kind="cli"`
  requires an `adapter` already in `CLI_ADAPTERS`; `base_url`/`api_key`/`api_key_path` are optional
  for `kind="cli"`, `adapter="claude"` only (validated if given: `base_url` non-empty, `api_key`/
  `api_key_path` mutually exclusive; rejected outright on any other adapter) — see "A `claude`
  provider's own endpoint" below for what reads them. `kind="api"`
  requires a `transport` (`anthropic` | `openai-compatible`), a `base_url` when openai-compatible,
  and either `api_key`/`api_key_path` unless `is_local=true`. An optional `test_model` names the
  model `POST .../test` probes with for an
  `openai-compatible` transport (an `anthropic` transport always probes `PROBE_MODEL`) — without one,
  the test route returns a clear "set a test model" failure instead of guessing a model name most
  real endpoints would reject. `masked()` replaces `api_key` with `api_key_set: bool`, exactly like
  `AssistantSettings.masked()`. `verify_ssl` (default `true`, `openai-compatible` only) controls TLS
  cert verification on that provider's `httpx` calls; set it `false` for a self-signed or
  private-CA internal host `certifi`'s bundle won't trust (Anthropic-transport calls go through the
  `anthropic` SDK's own client and don't currently expose this — v1 scope is openai-compatible only).
- **`src/codechroma/llm/call_site_settings.py`** — `~/.codechroma/llm-call-site-settings.json`
  (`$codechroma_LLM_CALL_SITE_SETTINGS_FILE` override), now two sections in one file:
  - `assignments`: one `Assignment` (`provider_id`, `model`, `mode`) per **`simple`** call site id;
    absent is "unassigned" — no row, no tombstone. `validate()`/`save_assignment` now reject an
    `agentic` id outright (pointing the caller at the group route instead of the old FR-008
    api-mode check, which no longer applies since agentic ids can't reach `validate()` at all).
  - `group_assignments`: one `GroupAssignment` (`provider_id`, `model`, no `mode` — always `cli`)
    per **group** id (`diagrams`/`research`/`planning`). `validate_group()` requires a `kind="cli"`
    provider. `save_group_assignment`/`clear_group_assignment` mirror the simple-side functions.
  - `load_assignment(call_site_id)` is the one function every caller still uses regardless of
    capability: for a `simple` id it reads `assignments` directly; for an `agentic` id it resolves
    `group_of(call_site_id)` and reads that group's `GroupAssignment` instead, synthesizing an
    `Assignment(mode="cli")` from it. `blocking_call_sites(provider_id)` unions both: a provider
    still backing a whole group blocks its delete the same as backing one simple call site (every
    member of that group is listed as a blocker).
  - Both sections' `save_*`/`clear_*` hold `io.locked(call_site_settings_path())` across their
    load-modify-persist span, same reason as the providers store.
- **`src/codechroma/llm/call_sites.py`** — the fixed, code-defined catalog (`CALL_SITES`) above, plus
  the fixed `GROUPS` table (`CallSiteGroup`: `id`, `label`, `members`) and `group_of()`; none of it
  user-editable, none stored in JSON.

## The two registries (Strategy / Adapter + Registry)

- **`context/llm_provider.py`**: `LLMProvider` Protocol, `AnthropicProvider` (unchanged), and the new
  `OpenAICompatibleProvider` (a raw `httpx` POST to `{base_url}/chat/completions` — no `openai` SDK,
  since the point of "openai-compatible" is arbitrary endpoints). Its constructor takes `verify_ssl`
  (default `true`), passed straight through as httpx's `verify=` kwarg — `provider_to_llm()` wires it
  from the stored `Provider.verify_ssl`. `build_provider(assignment)` picks the implementation
  matching the assignment's provider `transport`, else falls back to today's `provider_from_env()`.
  It only acts on `mode="api"` assignments — a `simple` call site assigned `mode="cli"` has no
  direct-API path in this feature; `build_provider` returns `None` for it and the caller falls back
  to its offline default, same as unassigned.
- **`llm/cli_adapters.py`**: `CliAdapter` Protocol (`build_argv(binary, prompt, model)`,
  `parse_line(raw, repo_root)`) and `CLI_ADAPTERS = {"claude": ClaudeAdapter(), "codex":
  CodexAdapter(), "kimi-cli": KimiAdapter()}` — a plain dict, extensible without touching callers.
  `ClaudeAdapter` is the exact argv shape and `stream-json` parser `skill_agent.py`'s `_run_claude`
  used to build inline (now generalized). `CodexAdapter` runs `codex exec --model <model> --sandbox
  workspace-write --json <prompt>` — `codex exec` has no interactive-approval flag at all (there's
  no TTY to prompt on in non-interactive mode, so `workspace-write` alone is Codex's equivalent of
  Claude's `--permission-mode bypassPermissions`), `--json` is its equivalent of `stream-json`; it
  renders `item.completed` events whose item is `agent_message` as text, an `error`-typed item as an
  in-line `  ↳ error: <message>` (a non-fatal mid-turn warning — observed for real from a bad model
  name, the turn continued afterward), the other tool-shaped item types
  (`command_execution`/`file_change`/`mcp_tool_call`/`web_search`/`plan_update`) as a one-line
  `⏺ <item type>`, and `turn.completed`/`turn.failed`/top-level `error` as the done/failure lines.
  `KimiAdapter` runs `kimi --prompt <prompt> --model <model> --output-format stream-json` —
  `--prompt` alone is Kimi's non-interactive mode and implicitly auto-approves every tool call
  (rejects being combined with `--yolo`/`--auto`/`--plan` outright), same intent as Claude's
  `bypassPermissions`; it renders each `role: "assistant"` message's `content` as text plus one
  `⏺ <name>` line per `tool_calls` entry, and a `role: "tool"` message only when `is_error` is set
  (mirrors `ClaudeAdapter`'s "only surface tool failures" policy). Each adapter's event-to-lines
  mapping lives in `cli_adapters.py` itself — `bridge/skill_output.py`'s `render_event` is still
  Claude-content-block-specific by design, and Codex (item-based) / Kimi (chat-message-based) event
  shapes share no real parsing code with it. What *is* shared, imported from `bridge/skill_output.py`
  rather than re-implemented: `text_lines`/`flatten`, the shape-agnostic line-splitting/truncation
  helpers every adapter's rendering bottoms out on, plus `cli_adapters.py`'s own
  `_parse_json_event()` (one JSON-decode-and-dict-check every `parse_line` shares before dispatching
  on its own event shape).
  🔴 Both adapters' flags were verified against the real installed `codex`/`kimi` binaries
  (2026-09-21) — an earlier draft guessed `--ask-for-approval never` (Codex) and `--print` (Kimi)
  from vendor docs alone; both are rejected outright by the real CLIs (`error: unexpected argument
  '--ask-for-approval' found` / `error: unknown option '--print'`), which would have failed every
  Codex/Kimi-routed run immediately. If either tool's flags drift in a future version, re-diff
  against its real `--help` rather than trusting docs alone.
  🔴 `build_argv` appends `--bare` only when `ANTHROPIC_API_KEY` is set in the bridge process's own
  env: `--bare` skips CLAUDE.md/skill-catalog auto-discovery, hooks, plugin sync, etc. — real token
  and latency savings for a one-skill headless run — but it also makes `claude`'s auth strictly
  `ANTHROPIC_API_KEY`/`apiKeyHelper` (OAuth and keychain are never read under `--bare`), so adding it
  unconditionally would break a `claude login` (OAuth) session's headless runs. Because `build_argv`
  can't tell which call site it's building for, `--bare` applies to **every** agentic run once a key
  is set — which is why all 9 prompt yamls open with `/codechroma-<skill>` instead of prose ("Use the
  codechroma-X skill…"): under `--bare` there's no skill catalog for the model to search, only
  `/skill-name` still resolves (per `claude --help`), so a prose-only prompt left behind would risk
  silently writing nothing the moment a key is configured. `c1_review_agent.yaml` also had its
  skill name corrected in the same pass — it referenced the retired `codechroma-c1-review`
  (`skill_sync.py`'s `RETIRED_SKILL_NAMES`); the real skill is `codechroma-review-diagram`.
  ⚠ `--bare` also means the *analyzed* repo's own hooks (a `PreToolUse`/`PostToolUse` safety hook,
  e.g. this repo's own `check-test-and-doc-style.py`, or a `git-guardrails`-style guard in someone
  else's repo) are skipped too, on top of every run already using `--permission-mode
  bypassPermissions` — accepted here as part of the same trade-off, but worth knowing before pointing
  this at a repo that leans on hooks as its only headless-agent guardrail.

`patterns_generator.py` still re-exports `provider_from_env` (re-imported from `llm_provider.py`)
alongside `build_provider`: `bridge/diagram_registry.py`'s bootstrap gate (`bootstrap_diagrams.py`)
calls `spec.provider_from_env()` as its "is a key configured at all" check before firing the
one-time bootstrap generate — that call is unrelated to a call-site assignment and deliberately
untouched by this feature. `c1`'s `DiagramSpec.provider_from_env` is `None` (043) — its bootstrap
needs no credential check at all.

## `skill_agent.py`'s `_run_cli` (was `_run_claude`)

`SkillAgent.resolve_cli()` returns `(adapter, binary, model, env_overrides)`: if `self.name`'s
assignment exists and is `mode="cli"` with a `kind="cli"` provider whose `adapter` is in
`CLI_ADAPTERS`, that adapter/provider-adapter-name/assignment-model, plus `env_overrides` from
`_cli_env_overrides(provider)`; else today's exact default — `load_assistant_settings()`'s
`effective_cli`/`model`, via `ClaudeAdapter`, with `env_overrides={}`. `start()`'s
`shutil.which(...)` PATH guard and `_read_events()`'s per-line parsing both call through the same
resolved adapter/binary, so an assigned `codex`-style provider (once that adapter ships) would be
checked and parsed correctly too.

### A `claude` provider's own endpoint

A `kind="cli"`, `adapter="claude"` provider can optionally carry a `base_url` and an
`api_key`/`api_key_path` — this points the `claude` binary itself at a third-party proxy instead of
the default Anthropic API, so an agentic group (e.g. Planning, which drives `wiki_general_agent`)
can be routed at a non-Anthropic backend (DeepSeek, an internal proxy, …) *through* `claude`, since
agentic groups otherwise only accept a `kind="cli"` provider and reject `kind="api"` outright
(`call_site_settings.py`'s `validate_group()`). `skill_agent.py`'s `_cli_env_overrides(provider,
model)` builds `{"ANTHROPIC_BASE_URL": provider.base_url, "ANTHROPIC_API_KEY": "",
"ANTHROPIC_MODEL": model}` plus `"ANTHROPIC_AUTH_TOKEN": <resolved key>` when one resolves (via
`context/llm_provider.py`'s `resolve_provider_key()`, the same raw-key-or-file precedence used for
`kind="api"` providers) and `"NODE_TLS_REJECT_UNAUTHORIZED": "0"` when `provider.verify_ssl` is
false, when `base_url` is set; empty otherwise, including for `codex`/`kimi-cli` adapters — this
mechanism is `claude`-only. Three deliberate departures from the naive "just set
ANTHROPIC_BASE_URL/ANTHROPIC_API_KEY/--model" first cut, each found by reproducing a real failure
against a live LiteLLM-fronted proxy (`claude -p ... --output-format json` run directly, outside the
bridge, 2026-09-22):

- **AUTH_TOKEN, not API_KEY.** The CLI's own auth precedence is API_KEY > AUTH_TOKEN > OAuth
  profile, so a real Anthropic key inherited from the bridge process's own environment would
  otherwise silently win over this provider's own token — sending `ANTHROPIC_API_KEY: ""` alongside
  `ANTHROPIC_AUTH_TOKEN` closes that leak. Matches the user's own known-working reference setup for
  a sibling proxy (`openclaude.sh`'s `claude-lmp`/`claude-seek` shell functions, a different
  project), which always uses `ANTHROPIC_AUTH_TOKEN`, never `ANTHROPIC_API_KEY`.
- **ANTHROPIC_MODEL, not `--model`.** An explicit `--model <name>` on argv (`ClaudeAdapter`'s
  `build_argv`/`build_worker_argv`, both in `llm/cli_adapters.py`) is what `resolve_cli()`'s
  `_run_cli()`/`wiki_general_pipeline.py`'s `_run_fanout()` callers used to always pass; both now
  pass `""` instead whenever `env_overrides` carries `ANTHROPIC_MODEL` (each adapter method omits
  `--model` entirely when given an empty string), so the model reaches `claude` only via the env
  var — again matching `claude-lmp`/`claude-seek`, which never pass `--model`. Verified directly:
  the same `claude -p` invocation, run with `--model deepseek-v4-flash` on argv, still printed
  `[claude-code:unrecognized_model]`; run with the model only in `ANTHROPIC_MODEL` and no `--model`
  flag, the warning still printed but the call completed normally either way once TLS (below) was
  fixed — see that note for what actually mattered.
- **`[claude-code:unrecognized_model]` is a red herring, not the failure.** It's a
  best-effort background notification (`Bge()` in the CLI's own bundle) that prints to stderr
  whenever a model name doesn't match the CLI's bundled recognized-name heuristics — independent of
  whether the actual API call that turn succeeds or fails. `wiki_general_worker.py`'s `_run_once()`
  reports failure from `proc.returncode != 0`, surfacing whatever's in stderr as the error message —
  which, when the real failure was something else entirely, is just this cosmetic line, making it
  look like the cause when it isn't. The actual failure in the reproduction was **TLS certificate
  verification**: `claude`'s real JSON result carried `"is_error": true,
  "result": "API Error: ... SSL certificate verification failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE)
  ..."`, invisible in the surfaced stderr text. Setting `NODE_TLS_REJECT_UNAUTHORIZED=0` (`claude`
  is a Node/Bun binary; this is its cert-verification escape hatch) made the identical call succeed
  end to end (`"is_error": false, "result": "ok"`) — hence that env var now keys off
  `provider.verify_ssl`, the same "Skip certificate verification" checkbox `ProvidersSection.tsx`
  already exposes for a self-signed/private-CA endpoint, now wired into the `claude` subprocess's
  own env too, not just `model_catalog.py`'s HTTP calls.

`resolve_cli()`'s `env_overrides` are merged into `_run_cli()`'s subprocess `run_env`, and threaded
through `wiki_general_pipeline.py`'s `_run_fanout()` into every `run_worker_job()`/`_run_once()`
call so the 058 worker-pool subprocesses get them too, not just the `_run_cli()` path.

🔴 **A failed run's surfaced error text used to be misleading, independent of the TLS bug above —
fixed in the same pass.** `skill_output.py`'s `_render_result()` used to render only `event.get(
"subtype")` for a failed `result` event, discarding `event.get("result")` (the actual readable API
error text) entirely — in the TLS reproduction, `subtype` was literally `"success"` on a real
failure, so the rendered line read `"✗ success"`. It now prefers `result` when present, falling back
to `subtype` only when there's no readable message. `skill_agent.py`'s `_failure_message()` used to
always prefer raw `stderr` text over anything rendered from stdout — since `[claude-code:
unrecognized_model]`'s cosmetic banner (a real stderr line, independent of whether the turn actually
succeeded) is exactly the kind of noise that would win that comparison, it now prefers the last
rendered `✗ `/`  ↳ error: ` line (the adapter's own designated error vocabulary, sourced from
stdout's structured events) over stderr, falling back to stderr only when no such line was rendered.
`llm/cli_adapters.py`'s `ClaudeAdapter` gained a matching `parse_error_message()` for the 058
worker-pool's own single-JSON-blob shape (`wiki_general_worker.py`'s `_run_once()` no longer reads
`stdout` only on success — it's now the preferred error source there too, ahead of `stderr`).

🔴 The target endpoint must speak the **Anthropic Messages API** shape — this is not a way to point
`claude` at an arbitrary OpenAI-compatible chat-completions endpoint like a `kind="api"`,
`transport="openai-compatible"` provider's `base_url` (those are a different shape, posted to
`{base_url}/chat/completions` by `OpenAICompatibleProvider`). A proxy that only speaks the
OpenAI-compatible shape needs its own Anthropic-protocol-translating layer in front of it before a
`claude` provider's `base_url` can point at it.

`ClaudeAdapter.build_argv` now takes an optional `env` (the run's actual resolved subprocess env,
built by `_run_cli` as `{**os.environ, **env_overrides, ...}`) and checks `ANTHROPIC_API_KEY` on
*that*, falling back to `os.environ` only when no `env` is given (every non-`_run_cli` caller, e.g.
the adapter unit tests). Before this, the check read the bridge process's own `os.environ` even when
building argv for a provider whose `env_overrides` cleared or never set that key — a `claude`
provider pointed at a proxy that needs no key at all (`model_catalog.py`'s "some proxies need none")
would still get `--bare` appended whenever the bridge process's *own* environment happened to carry
an unrelated `ANTHROPIC_API_KEY`, breaking auth for that run (`--bare` never falls back to
OAuth/keychain). The check still keys off `ANTHROPIC_API_KEY` specifically, never
`ANTHROPIC_AUTH_TOKEN` — per the `--bare` paragraph above, `--bare` only accepts
`ANTHROPIC_API_KEY`/`apiKeyHelper`, so an AUTH_TOKEN-only proxy provider correctly never gets
`--bare` either way (a token-savings miss, not an auth break).

### A provider's own model catalog (`llm/model_catalog.py`)

`fetch_models(provider)` asks a provider what models it actually serves, live — no hardcoded
catalog — so the Model routing tab's "Fetch models" action can offer real options instead of a
blind free-text guess (the motivating case: a `kind="cli"`, `adapter="claude"` provider pointed at
a third-party proxy via `base_url`, where `claude --model` rejects any name it doesn't
recognize before the request ever reaches the proxy). Returns
`{"supported": bool, "models": [{"id", "label"}], "error": str | None}`, never raises — same
"never a non-2xx for a reachability failure" convention as `_run_provider_test`:

- `kind="api"`, `transport="openai-compatible"`: `GET {base_url}/models` (OpenAI models-list
  shape, `{"data": [{"id": ...}, ...]}`) — same `base_url` convention `OpenAICompatibleProvider`
  already posts `/chat/completions` against. Unsupported (no call) when `base_url` is unset.
- `kind="api"`, `transport="anthropic"`: `GET {base_url or "https://api.anthropic.com"}/v1/models`
  with `x-api-key`/`anthropic-version` headers (Anthropic Models API shape,
  `{"data": [{"id", "display_name"}, ...]}` — `display_name` becomes each model's `label`).
  Unsupported (no call) when no key resolves via `resolve_provider_key()`.
- `kind="cli"`, `adapter="claude"`, `base_url` set: the same Anthropic-shape `GET .../v1/models`
  against that `base_url` — the natural counterpart of "A `claude` provider's own endpoint" above.
  Supported even with no key (some proxies need none); only `base_url` being unset makes it
  unsupported.
- Everything else (`kind="cli"` with no `base_url`, or an adapter other than `claude`) — unsupported,
  no network call, no cost, same ethos as `_group_cli_available()`'s PATH-only check.

A network error, timeout, or non-2xx response is caught and reported as `supported: true,
models: [], error: <message>` — the provider *is* a kind that supports listing, the attempt just
failed this time, which the UI renders differently from "this kind can't list models at all."

## The routes (`bridge/routes/llm_settings.py`)

Not repo-scoped — no `Services` dependency, same as `routes/assistant.py`. Full contract:
[`specs/034-llm-provider-settings/contracts/llm-settings-routes.md`](../../specs/034-llm-provider-settings/contracts/llm-settings-routes.md).

🔴 `bridge/app.py`'s `CORSMiddleware` must allow `PUT`, not just `GET`/`POST`/`PATCH`/`DELETE` — every
`PUT /llm/providers/{id}`, `PUT /llm/call-sites/{id}`, and `PUT /llm/call-site-groups/{group_id}` is
a `PUT`, and a missing method in `allow_methods` fails silently as a browser CORS error with no
server-side trace.

- `GET/POST/PUT/DELETE /llm/providers[/{id}]` — masked CRUD; `DELETE` is `409` with
  `{"error": ..., "blocking_call_sites": [...]}` while any assignment (simple or, via a group, any
  member of one) still references the provider (blocked, not cascaded — research.md's decision).
- `POST /llm/providers/{id}/test` — `kind="cli"`: `shutil.which(adapter)`, then always
  `model_catalog.fetch_models(provider)` (a free `GET .../v1/models` call — no completion tokens
  spent), reporting its `error` if any. `fetch_models` itself is what decides whether a given
  cli-provider shape is actually probeable (today: `adapter="claude"` with a `base_url` set) —
  everything else falls through its `_UNSUPPORTED` shape (`error: None`), so the test route stays
  agnostic to that condition and doesn't need editing if `fetch_models` gains another probeable
  shape later. Before this, a present `claude` binary alone reported `ok=true` regardless of
  `base_url`, so a broken proxy address or bad key never surfaced. `kind="api"`: one real, cheap
  (`max_tokens=1`) completion through `build_provider`,
  using `PROBE_MODEL` for `anthropic` or the provider's own `test_model` for `openai-compatible` (a
  clear `ok=false` "set a test model" reply if that field is empty, rather than guessing a model
  name). Mirrors `/assistant/settings/test`'s shape; never a non-2xx for a reachability failure.
- `POST /llm/providers/test` — the same test, run on a not-yet-saved draft (the Add/Edit form's own
  Test button): body is a provider payload (same shape as `POST /llm/providers`), `400` on
  `providers_store.validate()` failure, else `providers_store.draft_from_payload()` builds a
  transient `Provider(id="draft")` that's never persisted and never given an id in the response.
  Both routes share `_run_provider_test(provider_id, provider)`, so the actual cli/api probe logic
  lives in exactly one place.
- `GET /llm/providers/{id}/models` — `model_catalog.fetch_models(provider)`'s result verbatim
  (see above), `404` on an unknown id. Offloaded via `asyncio.to_thread` like the test routes.
- `GET /llm/call-sites` — `{"simple": [...], "groups": [...]}`. `simple` is the fixed catalog's
  `simple`-capability entries (including each id's `description`) joined with its current
  assignment (or `null`). `groups` is one entry per `GROUPS` id **excluding tab-hidden ones** —
  `id`, `label`, `members` (each member's `id`/`label`/`description`), the group's current
  assignment (`{provider_id, mode}` or `null`), and `cli_available: bool` (`_group_cli_available()`):
  `shutil.which()` on the group's *effective* binary — its assigned provider's `adapter` if
  assigned, else `load_assistant_settings().effective_cli` (`"claude"` unless changed on the Agent
  windows tab). An unassigned group still runs that default CLI, so `cli_available` only goes
  `false` when the binary is genuinely missing from PATH — never a false "not configured" for a
  working setup. No network call, no cost — just a `PATH` lookup, safe to fetch on every panel
  mount.

  **Tab-hidden groups.** `call_sites.py`'s `HIDDEN_GROUPS` (currently just `agents` — the provider
  for parallel-agent windows) is excluded from `groups` above so the Model routing table never
  renders it: that choice is edited on the "Agent windows" tab (`AssistantSection`'s "Agent
  provider" section), not next to the skill groups. The excluded group is still fully resolvable —
  `resolve_cli` (`parallel_agents`) reads the store directly, and `GET/PUT
  /llm/call-site-groups/{group_id}` keep working for it — so this is UI placement only, not a
  behavioral change.
- `PUT /llm/call-sites/{call_site_id}` — **`simple` ids only**: assign (`{provider_id, model,
  mode}`) or clear (`{}`/missing `provider_id`); `400` on kind/mode mismatch or on an `agentic` id
  (told to use the group route instead), `404` on an unknown id.
- `PUT /llm/call-site-groups/{group_id}` — assign (`{provider_id, model}`, no `mode` — always
  `cli`) or clear (`{}`/missing `provider_id`) a whole group at once; `400` on a non-`cli` provider,
  `404` on an unknown group id.
- `GET /llm/call-site-groups/{group_id}` — one group by id (the same joined shape as a `groups`
  entry), including tab-hidden ones like `agents`. The "Agent windows" tab calls this to read the
  agent provider assignment (`GET /llm/call-sites` won't return a hidden group); `404` on an
  unknown id.

## Web

One gear, one dialog, three tabs — no second rail button:

- `web/src/assistant/SettingsRailButton.tsx` — the only settings entry point on the canvas chrome
  now. Opens `SettingsDialog.tsx`, a small category list (currently one row: "LLM", with a live
  "N providers · M of K features routed" summary line fetched on open). Picking it swaps the home
  dialog for `LlmSettingsPanel` — never both mounted at once, since two live `ModalDialog`s would
  each bind a capturing document `keydown` listener and Escape in the child would dismiss the parent
  too.
- `web/src/llm-settings/LlmSettingsPanel.tsx` — the tabbed dialog: **Providers**, **Model routing**,
  **Agent windows**. A proper `tabpanel`/`aria-controls` pairing per tab (not just `role="tab"`
  buttons). `icons/RailIcon.tsx`'s `llm-providers` icon lives on the home dialog's LLM row.
- `ProvidersSection.tsx` (Providers tab) — a card per provider (name, one-line subtitle, kind/local/
  key-set/billing tags) plus add/edit/delete, a kind-branching form (CLI adapter picker vs. API
  transport/`base_url`/key-or-local toggle), an openai-compatible-only `test_model` field feeding the
  per-row Test button, and the billing warning (`billingWarning.ts`'s `shouldWarnBilling`) shown live
  as the form's `kind`/`is_local` change. `adapter === "claude"` also reveals optional "Base URL"/
  "API key" fields (`llm-provider-cli-base-url`/`llm-provider-cli-api-key`) — see "A `claude`
  provider's own endpoint" above; `toPayload()` clears both for any other adapter, and `subtitleOf()`
  shows `adapter → base_url` on the saved card once one's set. The Add/Edit form itself also has its own Test button
  (`testProviderDraft()` → `POST /llm/providers/test`), so a provider can be probed before it's ever
  saved; its result renders inline in the form (`llm-provider-form-test-result`) and clears whenever
  a field changes, same UX as the saved-row test but scoped to the draft in state. Also
  openai-compatible-only: a "Skip certificate verification" checkbox (`llm-provider-verify-ssl`,
  inverted against `verify_ssl` since the field reads as an opt-out) with an inline red warning
  (`llm-provider-verify-ssl-warning`) while checked, and an `llm-tag-warn` "TLS verification off" tag
  on the saved card (`llm-provider-insecure-tls-{id}`) so the setting stays visible outside the form.
- `CallSitesSection.tsx` (Model routing tab) — **two tables**. "Features": the 3 `simple` call
  sites, one row each, unchanged from before this addendum (mode toggle, provider/model picker,
  Apply once dirty, Reset). "Model routing": one row **per group** (`diagrams`/`research`/
  `planning`), not per call site — the row shows the group label, an inline comma-joined list of
  its member skill labels, and a single provider/model picker pre-filtered to `kind="cli"`
  providers (no mode toggle at all — a group is always CLI). Applying assigns every member at
  once; a `HelpHint.tsx` "?" marker on a group row lists every member's `description`. Both tables
  share the billing-warning badge and the "Apply only once dirty" convention; `llm-tab-subhead`
  labels which table is which. `HelpHint`'s bubble is portalled to `<body>` and positioned in JS
  from the marker's `getBoundingClientRect()` rather than CSS-absolute-positioned — the tables live
  inside a scrolling tab panel, and a bottom-row bubble positioned as that panel's child would be
  clipped by its own `overflow-y: auto` (which computes `overflow-x: auto` too, per the CSS spec,
  clipping every side once either axis is non-`visible`).
  Both tables' Model `<input>` also carries a "Fetch models" ghost button (disabled until a
  provider is picked) that calls `fetchProviderModels(providerId)` (`GET
  /llm/providers/{id}/models`) and, on a resolved `supported: true` result, backs the input with a
  `<datalist>` of the returned ids/labels — the field stays a free-text `<input>` throughout (never
  a strict `<select>`), since many providers can't list models and typing a custom name must keep
  working. One `<datalist>` per **provider id** is rendered once, shared and deduped across every
  row in both tables (not per row), specifically to avoid two rows that happen to share a selected
  provider rendering two DOM elements with the same `id`. An inline status line under the input
  reports "Fetching…", the resolved count, the provider's own error text, or (when
  `supported: false`) "This provider can't list its models — type the name directly." Never
  auto-fetches on provider change — same explicit-action convention as every Test button elsewhere
  in this tab.
- `AssistantSection.tsx` (Agent windows tab) — exactly the old `SettingsDialog.tsx` form (CLI picker,
  token field, copy-setup-prompt, test connection), unchanged behavior, just relocated. Its own test
  file inherits the old `SettingsDialog.test.tsx` cases; `assistant/SettingsDialog.test.tsx` now
  tests only the category-list home (the LLM row, the summary line, the swap-in, dismiss).
- `llmSettingsClient.ts` — thin fetch wrapper (same `VITE_ENGINE_BRIDGE_URL` base-URL convention as
  `assistantClient.ts`) for both route groups; `listCallSites()` returns `{simple, groups}`;
  `CallSite`/`CallSiteGroupMember` both carry `description`; `assignCallSiteGroup`/
  `clearCallSiteGroup` call the new group route. `CallSiteGroup` also carries `cli_available`.
- `useGroupAvailability.ts` — the one hook every agentic-feature button uses to know whether its
  group's CLI is actually reachable, so the button can disable itself with a `title` hint instead of
  the user hitting a bare "not found on PATH" error after clicking. Returns a plain `boolean`.
  Fetches `listCallSites()` on mount and reads that group's `cli_available`; before the fetch
  resolves, or if it fails outright (no bridge configured, e.g. dev mode on the mock bridge), it
  stays optimistic (`true`) rather than flash-disabling a button that might work fine — wiring it up
  wrong would regress a working setup, which is worse than an occasional late error. Several of these
  buttons can mount at once (Change review, the epic-brief panel), so the fetch is shared
  through one module-level in-flight promise (`fetchCallSitesShared`) rather than one request per
  consumer; it clears once settled, so the next independent mount still gets a fresh read.
  Every consumer gates its button with `aria-disabled` (never native `disabled`) plus
  `guardedClick(disabled, onClick)` (same file) to no-op the click — a natively `disabled` button
  drops out of the tab order, so its `title` hint would never reach a keyboard or screen-reader user.
  Wired into: `C1ChangeSummary.tsx`'s Re-review button (group `"diagrams"` — its own only remaining
  member since `diagram_type_agent`'s retirement), `EpicBriefView.tsx`'s Generate/Regenerate buttons (group
  `"planning"`) — see [`epics-view.md`](epics-view.md) — and `WikiGeneralNotice.tsx`'s
  Generate/Update buttons (also group `"planning"`, alongside `epic_brief_agent`) — see
  [`wiki-general.md`](wiki-general.md). Deliberately **not** wired into
  `ResearchPanel.tsx`'s Ask button: research already degrades to a non-LLM keyword answer whenever
  no embeddings index exists (see [`research-endpoint.md`](research-endpoint.md)), so disabling Ask
  on a missing CLI would block a button that still produces a useful answer in the common case. Also
  not applicable to `c1_agent`/`patterns_agent`/`impact_agent` (also group `"diagrams"`): today
  there's no direct web button for those three — regeneration runs inside an attached interactive
  agent window via the `codechroma-draw-diagram` skill, not a plain request to the group's assigned
  CLI.

## Tests

- `tests/unit/test_llm_providers_store.py` (incl. `draft_from_payload` and `verify_ssl`),
  `test_llm_call_site_settings.py` (includes the "every agentic id is in exactly one group"
  coverage guard and group-assignment/`load_assignment` delegation tests), `test_llm_cli_adapters.py`,
  `test_llm_provider_openai_compatible.py` (mocked HTTP endpoint, incl. `verify_ssl` forwarded to
  `httpx.post`'s `verify=`), `test_llm_model_catalog.py` (mocked `httpx.get` per
  kind/transport/adapter branch, incl. the unsupported-vs-network-error distinction),
  `test_bridge_llm_settings_route.py` (incl. `PUT /llm/call-site-groups/{id}`,
  the draft `POST /llm/providers/test` route, `verify_ssl=false` forwarded end-to-end, and
  `GET /llm/providers/{id}/models` delegating to a mocked `model_catalog.fetch_models`).
- `tests/unit/test_skill_agent.py::test_resolve_cli_uses_the_agentic_call_sites_group_assignment`
  — proves `_resolve_cli()` needed no change: it still resolves via `self.name`, and
  `load_assignment()` now transparently delegates that to the owning group.
- `web/src/assistant/SettingsDialog.test.tsx` — the category-list home; `AssistantSection.test.tsx` —
  the relocated agent-window form; `llm-settings/LlmSettingsPanel.test.tsx` — the tab switch itself.
- `tests/integration/test_llm_call_site_assignment_end_to_end.py` — unassigned vs. assigned
  resolution through the real stores, with a stubbed `LLMProvider` (no network).
- `tests/unit/test_terminal_server.py`'s regression assertion — `terminal/agents.py`'s
  `ALLOWED_AGENTS`/`agent_cli` dispatch are unaffected by the `_run_claude` → `_run_cli` refactor
  (FR-012).
- `web/src/llm-settings/*.test.ts(x)`.
- `tests/unit/test_skill_output.py::test_a_failed_result_prefers_its_readable_message_over_subtype` /
  `test_a_failed_result_names_its_subtype_when_there_is_no_readable_message`,
  `test_skill_agent.py::test_a_failed_run_reports_the_readable_api_error_over_cosmetic_stderr_noise`,
  `test_wiki_general_worker.py::test_run_worker_job_prefers_the_stdout_envelopes_message_over_stderr_noise`
  — the error-surfacing fix above.
- `test_llm_cli_adapters.py::test_build_argv_prefers_the_resolved_env_over_the_process_env` /
  `test_build_argv_omits_bare_for_an_auth_token_alone`,
  `test_skill_agent.py::test_start_omits_bare_for_a_keyless_proxy_even_with_a_real_key_on_the_bridge_process`
  — the `--bare`-uses-the-wrong-env fix above.
- `test_llm_providers_store.py::test_validate_rejects_a_non_claude_cli_provider_with_a_base_url` —
  `validate()` now rejects `base_url`/`api_key`/`api_key_path` on a non-`claude` `kind="cli"`
  provider, matching `ProvidersSection.tsx`'s own claude-only field visibility instead of silently
  accepting and ignoring them.
- 🔴 `tests/unit/conftest.py` — an autouse fixture pointing `codechroma_ASSISTANT_SETTINGS_FILE`/
  `codechroma_LLM_PROVIDERS_FILE`/`codechroma_LLM_CALL_SITE_SETTINGS_FILE` at a scratch dir for every
  unit test, added after a real group assignment on a developer's own machine (`~/.codechroma/`,
  populated by actually using the LLM settings UI) made `test_content_generators.py`'s
  `test_runs_claude_with_the_haiku_model` resolve that real assignment instead of the intended
  unassigned default — the test had no isolation of its own. Any new unit test that wants the real
  developer-machine store (none currently do) must explicitly override these env vars itself.

## Out of scope (v1)

- `codex`/`kimi-cli` CLI adapters (ship `claude`-only until their flags/output are verified).
- Running a `simple` call site's `mode="cli"` assignment (only the 8 agentic sites actually execute
  a CLI run in this feature; `build_provider` returns `None` for that combination today).
- A live model list from the bridge (same as the assistant-settings probe).
