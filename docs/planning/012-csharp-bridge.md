# 012 — FastAPI bridge + WebSocket → ASP.NET Core (Plan 2)

Status: **In progress** (the C# bridge is the only bridge in the desktop app; wiki-general generate/update port is still open, see 017; wire contract green on both backends for graph, diagrams, workspaces, transport, assistant, runtime settings, llm settings, traces, issues, diagram types and branches; the graph is served by `CodeChroma.Core`).

> Update 2026-10-18: Electron (`desktop/`, `electron-builder.yml`, PyInstaller, `cryptoCompat.ts`, the install forwarders) was removed from the tree; the last Electron commit is the local tag `electron-last-build`. Mentions below of Electron as the shipping app or reference describe the plan's history. Current state: [`docs/architecture/desktop-app.md`](../architecture/desktop-app.md).

Target is .NET 8 (`net8.0`, the only SDK installed here; the original plan said .NET 10). Code lives in `dotnet/CodeChroma.Bridge` (+ `.Tests`). Nothing in Python was deleted; strangler rules apply.

## Step 0 — baseline (Python bridge, measured)

`poetry run python scripts/bench_bridge_cold_start.py "" 3` (Windows 11, Python 3.14 dev venv, `uvicorn codechroma.bridge.server:app` over a copy of `tests/fixtures/sample_repo`, 7 files):

| run | spawn → `/health` 200 | working set / peak (largest process of the tree) |
|---|---|---|
| 1 | 4.74 s | 82.4 MB |
| 2 | 4.75 s | 82.0 MB |
| 3 | 4.75 s | 82.4 MB |

Notes: this is the dev venv, not the 72 MB PyInstaller folder, so cold start of the frozen build and its on-disk size are not measured. A first attempt accidentally analyzed the whole repo (11–18 s), so cold start scales with repo size; the bridge is IO-bound and 82 MB idle is the real number to beat. The C# bridge with a snapshot engine starts in-process in well under a second in tests, but that is not comparable until `CodeChroma.Core` does a real analyze. **The baseline shows startup (4.7 s, mostly Python import + analyze) and RSS as the only measurable costs; no CPU bottleneck in the bridge itself.**

## Step 1 — test audit (3 questions)

Questions: (1) observable behaviour? (2) already covered elsewhere? (3) tied to Python/FastAPI?

| Python test file(s) | Verdict | Where it went |
|---|---|---|
| `test_bridge_children_route`, `test_bridge_connections_route`, `test_bridge_structure_route`, `test_bridge_source_route` | keep, rewrite as contract | `graph.cases.json` (21 cases). The duplicated `_init_repo` helpers and `TestClient` plumbing are dropped. `test_context_digest_reflects_the_fixture_repo` (in the c1 file) is a duplicate of the digest unit tests and dropped, per Plan 1. |
| `test_bridge_c1_route`, `test_bridge_patterns_route`, `test_bridge_impact_route` | merged | one table over diagram kind (`c1/patterns/impact/epics/sequence`) for `-path` and `DELETE`; c1-only for read/resolver cases in `diagrams.cases.json`. Resolver-dependent cases (`needs_regeneration`, `node_id` attach, `unmapped`) tagged `requires: diagram-resolver`. Patterns/impact *content* tests (heuristic detection, diff seeds) are engine tests, not wire shape, and are not extracted. |
| `test_bridge_diagram_status_route` (7), `test_bridge_c1_output_route` | merged, parametrized | job state machine over kinds `c1`, `impact-changes`; invalid-state table. |
| `test_bridge_diagrams_status_route` | merged | 3 cases (ready+fingerprint, delete flips ready, feature-plan). The "empty repo reports nothing ready" case is dropped: it depends on monkeypatching the deterministic bootstrap. Custom-type library readiness not extracted. |
| `test_bridge_workspace_route` | partly extracted | main/unknown status, unknown activate, main activate. Agent-worktree cases need the agent manager (not ported). |
| `test_bridge_origin_guard` | extracted | `transport.cases.json`: 4 unsafe methods, allowed/loopback origins, rebinding, cross-origin read, cross-origin WS. The `is_cross_origin` unit table is not duplicated (the HTTP cases cover each row). |
| `test_bridge_events_route` | extracted | repo change → `changed` + paths (real watcher), diagram file change → `{"type":"c1"}`, status broadcast. The direct `broadcast_threadsafe` test is Python-internal and dropped. |
| `test_bridge_terminal_route` / terminal server | partly extracted | unknown agent and bare `agent` kind error frames (tag `e`, close 4404); PTY `o` frame case (`requires: pty`). Input/resize/binary frames not extracted. |
| `test_bridge_app_factory`, `lifespan`, `spa_mount`, `event_loop_liveness`, `main`, `pr_boot` | dropped / rewrite later | Python-internal (fails question 3). Behaviour (readiness, SPA mount) becomes `WebApplicationFactory` tests when those features are ported. |
| `test_bridge_live` (8) | rewritten | C# `DebouncerTests` + `WorkspaceRegistryTests` (limits, lazy bring-up, idle unload at exactly 600 s, main never unloaded). |
| `agents_route` (85), `agents_autostart`, `llm_settings_route` (41), `pr_routes` (36), `pr_boot`, `wiki_general_*` (3 files), `branches_route` (20), `epics`, `epic_brief`, `canvas`, `recipes`, `assistant`, `issues`, `accept`, `diff`, `change_cards`, `impact_changes`, `trace`, `*_context`, `route_probe`, `hierarchy_layout`, `dependency_digest` | **not audited in depth** | Listed under remaining work. Planned tables: validation/error tables for agents and llm_settings; PR routes need a first parametrization pass. |

Wire contract design: JSON case files in `tests/fixtures/bridge_contract/*.cases.json` (format documented in the docstring of `tests/contract/bridge_contract.py`), steps = `http` / `fs` / `ws`, exact-JSON or JSONPath-lite `checks`, `matrix` expansion, `requires` capability tags. The Python runner `tests/contract/test_bridge_wire_contract.py` replays them against the FastAPI app; `dotnet/CodeChroma.Bridge.Tests/Contract/WireContractTests.cs` replays the same files against ASP.NET Core. Matcher semantics are pinned by mirrored tables (`test_bridge_contract_matchers.py`, `ContractMatchersTests.cs`).

Graph data in the C# tests comes from `engine_snapshot.sample_repo.json`, dumped from the Python engine by `scripts/dump_bridge_contract_snapshot.py` and served through the `IGraphEngine` interface (`CodeChroma.Bridge/Engine`). `CodeChroma.Core` is not referenced; production wiring uses `UnavailableEngineFactory` until Plan 1 lands.

## Results

| Suite | Result |
|---|---|
| Python contract replay (`tests/contract/test_bridge_wire_contract.py`) | 69 cases passed, 0 skipped (reference proven first) |
| Python matcher tests | 23 passed |
| xUnit (`dotnet test`) | 96 passed, 0 failed: 59 contract cases + 1 guard test for the 5 unsupported cases + 23 matcher rows + 7 registry/limits + 1 debounce |
| `poetry run ruff check .` | clean |

Red-first evidence: with an empty ASP.NET app and stubbed registry the xUnit run was 67 failed / 29 passed (the 29 are the matcher rows and cases that expect 404) before any route existed.

## Coverage by route group

| Group | Covered by contract | Not covered |
|---|---|---|
| graph | node ref, root ref, children, connections, structure (4 behaviours), source, repo-id fallback to main | `context-digest`, `dependency-digest`, `route` (now ported: `Routes/GraphRoutes.cs`, cases in `graph.cases.json`); binary-file and doc-only folder cases exist but are `requires: real-engine` (C# skips; needs a real engine) |
| diagrams | `{kind}-path`, `DELETE`, missing/written c1, `diagrams/status`, job status/output/cancel for `c1`, `impact-changes` | resolvers (c1/patterns/impact/epics/sequence enrichment, staleness, overlays), `generate`, layout routes, `context`, `review`, custom and feature-plan routes, wiki context routes. The C# fingerprint is SHA-256 over canonical JSON, not Python's `hash_lines`; the contract only checks it is a string. |
| workspaces | status, activate (main/unknown) | agent worktree activation, agents, PR and branch workspaces |
| transport | health, origin guard (HTTP + WS), `/events` live pings (repo change, diagram file, status), terminal error frames | terminal PTY host (C# sends error frame + close 1011 for a valid agent), input/resize/binary frames, `/trace-stream`, `/trace-ingest` |
| everything else | none | agents, llm_settings, prs, branches, canvas, recipes, epics, wiki_general, assistant, issues, diffs/accept, change cards, traces |

C# cases skipped by capability (listed and asserted by `Unsupported_cases_are_exactly_the_documented_set`): `a_docs_only_folder_is_flagged_doc_only`, `binary_files_are_listed_with_null_source`, `an_unconvertible_legacy_c1_is_flagged_for_regeneration`, `c1_nodes_get_graph_node_ids_and_unmapped_code_is_listed`, `terminal_pty_output_arrives_in_o_tagged_frames`.

## Implemented in C# (step 2, partial)

Minimal APIs, `System.Text.Json` source generation (`Http/BridgeJson.cs`, snake_case), built-in WebSockets, origin guard middleware, `WorkspaceRegistry` (lazy bring-up, 600 s idle unload with a 60 s sweep, injectable `TimeProvider`), one recursive `FileSystemWatcher` per workspace routed to a 1000 ms repo debouncer or 500 ms per-diagram debouncers, git CLI runner with the 10 s / 120 s timeouts (`GitRunner`), the same git-status signature sync as `GitSync`. All limits are in `Workspaces/BridgeLimits.cs` and pinned by a test.

Known differences: the repo watcher ignores the same directory names as the engine but does not honour `.gitignore`; Python's `ensure_excluded`/skill sync is not ported; CORS is configured but not contract-tested; text reading normalizes newlines like Python but `splitlines` edge separators (form feed, U+2028) are not mirrored.

## Remaining work

1. Audit and extract the remaining ~40 route test files (start with agents/llm_settings validation tables, then PR routes, branches, canvas/recipes, epics, wiki_general), adding `requires` tags where an engine or an agent runtime is needed.
2. Port those route groups in the plan's order (agents next), each green against the shared cases.
3. Replace `UnavailableEngineFactory` with `CodeChroma.Core` once Plan 1 lands; then run the `real-engine` and `diagram-resolver` cases and add the digest routes.
4. ConPTY/PTY terminal host and frame input handling; screen detection fixtures from `tests/fixtures/agent_screens`.
5. LLM/skill-agent subprocess runners (`claude -p`), trace proxying to the Python tracer, `/trace-*` sockets.
6. Self-contained trimmed (or AOT) publish and the installer-size measurement against the 72 MB PyInstaller folder; frozen-bridge cold start for a fair comparison with Step 0.
7. CI job for `dotnet test` (`.github/` was out of scope here).

## Removal candidates (nothing deleted yet)

Only after the matching routes pass the shared contract against a real engine: `bridge/routes/{graph,events,workspaces}.py` and the graph part of `routes/diagrams.py` (path/delete/status/diagrams-status), `bridge/origin_guard.py`, `bridge/live.py`, `bridge/git_sync.py`, the corresponding `tests/unit/test_bridge_*` files whose cases moved into the contract, and finally `fastapi`, `uvicorn`, `websockets`, `watchfiles` (+ `pywinpty`, `pyte` once the terminal host is ported), `packaging/bridge.spec`. The contract runner and `scripts/dump_bridge_contract_snapshot.py` must stay until the Python bridge is gone.

## Phase 5 progress (bridge finish)

Contract runner additions (both backends): http `capture` + `{{var}}` substitution, `ws send`, and per-case empty machine-local stores (assistant/runtime/llm/diagram-types env vars; C# `UserPaths.Under`). New case files: `assistant`, `runtime`, `llm_settings`, `traces`, `issues`, `diagram_types`, `branches`. `llm_catalog.json` (call sites, adapters, diagram styles, provider names) is dumped from Python by `python -m tests.contract.llm_catalog`, embedded in `CodeChroma.Bridge`, and guarded by `tests/contract/test_llm_catalog_snapshot.py`.

Engine: `CoreEngineFactory` analyzes with the Python analyzers (`python -m codechroma.analysis_export`, `CODECHROMA_PYTHON` picks the interpreter) and serves from `CodeChroma.Core`; reanalyze shells out for a delta of the changed files. With `CODECHROMA_PYTHON` set the whole contract runs on this real engine (the two `real-engine` cases then run too).

| Route group | State |
|---|---|
| assistant (GET/PUT settings, test probe partial) | ported, contract |
| runtime settings GET/PUT | ported, contract; `environment`, `cli/{name}`, `refresh`, `focus` not ported |
| llm_settings (providers, call-sites, groups, models) | ported, contract; API-provider completion test not ported |
| traces (list/get, trace-stream, trace-ingest, `trace` ping) | ported, contract |
| issues (status, create via `gh`) | ported; validation contract only |
| custom diagram types + custom/feature-plan paths/delete, diagrams/status custom entries | ported, contract; resolved GET payloads not ported |
| branches (list, choices, open/create, close) | ported, contract; skills are not synced into branch worktrees |
| canvas GET/PATCH, recipes run, diff/change-cards/accept | ported, contract (`canvas`, `recipes`, `diffs` case files; function-level diff cases are `requires: real-engine`) |
| not ported | agents, prs, epics, wiki_general, skill runners (`claude -p`), generate routes, resolvers, PTY terminal host |
| branches (list, choices, open/create, close) | ported, contract; skills installed and diagrams seeded into branch worktrees, agent worktrees count as holders |
| agents (cards, git-preflight/init, branch switcher, start/stop/resume, window, pr-preflight, pr, recreate-worktree, delete), autostart, status LED poller | ported, contract (`agents.cases.json`); `claude -p` commit-message generation is a plain process call |
| prs (preflight, list, github list, open, refresh, close) | ported, contract (`prs.cases.json`: validation and 404 paths; the gh/fetch happy path needs a GitHub remote and is covered by unit-level logic only) |
| PTY terminal host `WS /ws/terminal` | ported, contract (`terminal.cases.json`) plus real-process xUnit tests |
| not ported | canvas (GET/PATCH), recipes, diffs/change-cards/accept, epics, wiki_general, skill runners (`claude -p`), generate routes, resolvers |

PTY choice: `Porta.Pty` 1.0.7 (MIT, netstandard2.0, ConPTY on Windows, native `openpty` shim on Linux/macOS) behind `Terminal/PtyHost.cs`, which adds incremental UTF-8 decoding, the ConPTY startup `ESC[c` reply, exit reporting and kill. Newer Porta.Pty versions target net10 only. `Terminal/ScreenTap.cs` is a managed VT emulator (pyte replacement) for reattach redraws and the status detector; `Agents/StatusDetector.cs` reads the shipped `detect/*.toml` (embedded). Known gap: the foreground-process probe (`tcgetpgrp`+`ps`) is not ported, so the detector never treats a nested `vim` as foreign.

Results: `dotnet test dotnet/CodeChroma.Bridge.sln` 173 passed / 0 skipped with `CODECHROMA_PYTHON` set (170 passed, 1 skipped without); Python `tests/contract` 251 passed.

## Phase 5 progress (bridge skills, runners and resolvers)

Ported to `dotnet/CodeChroma.Bridge` by the `bridge-skills` branch; all of it has C# xUnit tests, and everything with a wire shape has contract cases replayed on both backends (`runtime_environment`, `layout`, `epics`, `wiki_general`, `diagrams_resolved`; the two `diagram-resolver` cases in `diagrams` now run too).

| Group | State |
|---|---|
| Skill/LLM subprocess runners | `Skills/SkillAgent.cs` (snapshot, restore, timeout, cancel, flush, composite keys, run bodies), `CliAdapters.cs` (claude/codex/kimi argv + JSONL rendering), `SkillOutput.cs`, `CliResolver.cs` (call site to provider to adapter to binary/model/env), `RuntimeEnvironment.cs` (login-shell capture, resolution cache, diagnostics), `Prompts.cs` (prompts/*.yaml embedded). Tested against `CodeChroma.Bridge.FakeCli`, a scripted executable; no real Claude or network |
| Generate/status/output/cancel | `c1` and `impact-changes` run through `SkillAgent`; `Workspaces/SkillJobs.cs` is gone |
| Runtime | `environment`, `cli/{name}`, `refresh`, `focus` ported; `PUT /runtime/settings` reconfigures the environment |
| Assistant / llm_settings | `POST /assistant/settings/test` and the API-provider completion test make a real completion through `Skills/LlmCompletion.cs` (anthropic, openai-compatible, gemini), tested with stub handlers |
| Epics | `Epics/` (markdown requirements source, speckit delivery source, assembler, brief normalization, tasks.md splice) and `Routes/EpicsRoutes.cs` (items, brief start/poll/cancel/output/path, diagram-path) |
| wiki-general | status, interactive status (with the generate/update mutual exclusion and commit stamp), output, cancel, `wiki-general-context`; `generate`/`update` answer 501 |
| Diagrams | `Diagrams/` shared resolver (diagnostics, path to node_id, origins, coverage, staleness, legacy c1 migration); resolved GET for c1, epics, sequence, custom and feature-plan; `custom/{id}/context`, `c1/context`, `epics/context`; hierarchy layout GET/POST |
| Still not ported | patterns and impact resolved payloads (need the pattern detector and change cards), `impact-changes` payload, `wiki-context` (needs the plain wiki generator), wiki-general pipeline/update, PR workspaces' `c1_source_root` |

Known differences: the custom-diagram staleness fingerprint hashes `.codechroma/dependency-digest.json` with the C# canonical-JSON hash (the C# engine does not write that file, so it is constant); `epic_brief_agent`'s prompt carries compact JSON; the plain-wiki sync that `prepare_new_run` does is skipped; a login shell is captured with `env -0` (POSIX) or `Get-ChildItem env:` (PowerShell) instead of the Python helper.
Pre-existing, not from this change: on the integration branch `tests/fixtures/sample_repo/.claude/` is tracked (commit 21b0ec0), which makes two Python `graph::structure_*` contract cases fail.

### Agent questions (017) ported

`Questions/`, `Routes/QuestionRoutes.cs`, the `/mcp` JSON-RPC endpoint and the `TerminalAgents` MCP args/env are in C# with contract cases (`questions.cases.json`) and xUnit tests. Deferred: (1) a Python-free `AskUserQuestion` hook (`hooks/ask_user_question_hook.py` still needs `python3`/`python` on PATH; without it the native dialog appears and `codechroma-grill` still asks through `ask_user`); (2) SSE/`Mcp-Session-Id`-based sessions (the endpoint is plain JSON-RPC and only issues the id for the retry counter); (3) `settings.questions.*` is not configurable in C# (`QuestionMcp.AskWait`/`MaxRejections` are code defaults); (4) Codex wiring (not wired in Python either).
