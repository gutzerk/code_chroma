# Fast diagrams: the context tool and bare CLI runs

Planning doc: [`docs/planning/018-fast-diagrams.md`](../planning/018-fast-diagrams.md). C# bridge only (`dotnet/CodeChroma.Bridge`); the Python engine has no counterpart.

A process diagram used to take an agent 25–30 steps (read wiki, query the graph, open files). Now a deterministic tool picks the relevant components, prints one 18–30 KB context, and a **bare** CLI agent draws from it in about 3–4 steps (a real run on this repo: 42 s, `OK: 8 node(s) resolved`).

## Pieces

| Piece | File | Role |
|---|---|---|
| Model files | `Embeddings/ModelStore.cs` | `jina-embeddings-v2-base-code` int8 ONNX (162 MB) + `tokenizer.json`, pinned by SHA-256, downloaded on first use to `~/.codechroma/models/<name>/` (`codechroma_MODELS_DIR` overrides, resolved by `UserPaths.Resolve`); each file is hashed once per bridge process. A failed or mismatching download leaves no file. |
| Hosting | `.github/workflows/publish-model.yml` | Manual workflow copies the two files from Hugging Face to the `models-v1` GitHub release (not marked latest, so installers' `releases/latest` is unaffected). Free: 2 GiB per asset, unmetered. **Not Git LFS** (1 GiB free storage/bandwidth) and not in the installer. Changing a file means a new tag and new hashes in `ModelStore.cs`. |
| Tokenizer | `Embeddings/ByteLevelBpeTokenizer.cs` | RoBERTa byte-level BPE read from `tokenizer.json`, `<s>…</s>`, 512-token cap. |
| Embedder | `Embeddings/OnnxEmbedder.cs` | ONNX Runtime, mean pooling over real tokens, L2 normalize. `IEmbedder` is the test seam. |
| Cache | `Context/ContextService.cs` (`ContextCache`), `ContextCacheBuilder.cs` | `.codechroma/context-cache/{data.json,title_emb.bin}` built from `wiki-general/manifest.json` + c2/c3 pages + the graph's symbols (calls kept only if repo functions or `Error\d{3}`, ≤12, no test files). Fingerprint = manifest hash + symbol count + model name + builder version, stored in `fingerprint.txt` so a freshness check reads one small file; a mismatch rebuilds (and the ONNX model is only loaded then). |
| Selection | `Context/ContextSelector.cs` | Per-phrase z-score of cosine similarity to the page titles, max over phrases, top 10, plus import-edge neighbours (weight ≥2, ≤12). |
| Rendering | `Context/ContextRenderer.cs` | Architecture block, best matches with `node_id Lx-y > calls`, related components, links. Shrinks files/symbols per component tier by tier to stay under 30 000 chars. Limits live in `ContextLimits`. |
| Command | `Program.cs` → `ContextTool.Run` | `CodeChroma.Bridge context --repo-path X [--models-dir D] "phrase" …`; stdout context, stderr timing. Cold run ≈ 0.6 s on 118 components. Exit 2 with a message when the cache or model is missing. |
| Run | `Skills/ProcessDiagram.cs`, `Routes/ProcessDiagramRoutes.cs` | `POST /repos/{id}/custom/{typeId}/generate` `{request}` (+ `/generate/status`, `/output`, `/cancel`). Ensures model + cache, fills `references/process-bare.md` placeholders (context command, self-check command, type id, style) and starts the `process-diagram` `SkillAgent` kind (call-site `c1_agent`, so it follows the agentic group's provider). Errors if wiki-general doesn't exist yet. |

## Bare runs

`RunOptions.Bare` defaults to **on** for every headless `SkillAgent` run (`SkillAgent.RunCli`):
- `ICliAdapter.BareArgs(tools)` — claude: `--tools T --allowedTools … --disable-slash-commands --strict-mcp-config --setting-sources local --no-session-persistence --system-prompt …`. Unlike `--bare` it works with OAuth logins. Codex and kimi-cli return nothing (no verified switch yet) and run as before.
- A `/skill args` prompt is inlined by `Skills/BareSkill.cs`. For `codechroma-draw-diagram type: <t>` with a **short body** `references/bare-<t>.md` (c1, patterns, impact, sequence; ~3–4 KB each vs ~45 KB of `SKILL.md` + `type-*.md` + `drawing-rules.md`) only that file is inlined, with `{BRIDGE}`, `{WORKSPACE}`, `{REPO_ROOT}`, `{OUTPUT_PATH}` and `{CHECK_COMMAND}` filled (the bridge URL is captured at startup in `BareSkill.BridgeUrl`, so the agent needs no environment) and the prompt's "read references/… before writing anything" clause stripped from the `Task:` line. Every other skill/type (custom, epics, reviews, epic-brief, wiki-general-update) inlines `SKILL.md` (frontmatter dropped) plus the `references/*.md` the args name. Skill not installed → the run stays a normal slash-command run.
- 🔴 A short body is a condensed copy of its `type-*.md`: when a type's rules or schema change, change `bare-<t>.md` too (the full references remain the source for interactive agent windows).
- Prompts over ~20 000 characters are written to a unique `.codechroma/prompts/<call-site>-<guid>.md` and the argv says to read that file first (Windows command-line limit); the file is deleted when the run ends.
- Kill switch: `codechroma_BARE_AGENTS=0`. Workflow steps/chat pass `RunOptions.Bare = false` (they need `--resume`/MCP config) and are never bare.
- Terminal and parallel agents (`Terminal/TerminalAgents.cs`, call-site `parallel_agents`) keep `--plugin-dir` and the full context, except task agents that draw a diagram (see "Context for every diagram type but impact").

## Context for every diagram type but impact

`Context/DiagramContext.cs` gathers the same context in-process (no CLI hop) for `c1`, `patterns`, `sequence` and `custom`; `impact` (reads the diff) and `epics` (read requirements) get none. Phrases: fixed seed phrases for the headless `c1` run, which has no request (`DiagramContext.Phrases`); interactive agents choose their own.
- **Model on install/first launch:** the desktop app sets `codechroma_MODEL_WARMUP=1` for the bridge it spawns (`Shell.App/Program.cs`), which then starts a background `WarmModelAsync`, so the 162 MB model downloads right after the app is installed or updated, not on the first diagram. A bridge started any other way (tests, `uvicorn`, the launcher) does not warm up; its first diagram context starts the download instead. The installer scripts only place the app, so the pinned hashes stay in `ModelStore.cs`.
- **Cache on wiki runs:** `WikiGeneralRoutes.StampOnSuccess` calls `DiagramContext.PrepareAsync` (model + `ContextCache.Ensure`) in the background after every successful wiki-general generate or update.
- **Headless c1:** `POST /repos/{id}/c1/generate` gathers the context and passes it as `RunOptions.Context`, which `SkillAgent.RunCli` appends under "Pre-gathered context".
- **Interactive agents (Draw button and popover) start bare too:** `AgentClient.create(..., diagram: {type})` sends `diagram_type` (`c1`/`patterns`/`custom` from the popover, `any` from the generic "Draw…" button, nothing for impact/epics), stored on the `AgentRecord`. At `POST /agents/{id}/start` the bridge replaces the natural-language task with `BareSkill.ComposeInteractive`: the draw skill inlined (the short `bare-<type>.md` for a known type, else `SKILL.md` with absolute paths to its references), a "ask the user what to draw" start, and the exact `context --repo-path … --models-dir …` command. `TerminalAgents.Resolve(..., bare: true, visiblePrompt)` then launches the terminal CLI with the short `BareSkill.InteractiveVisiblePrompt` as the only visible first message, the inlined skill carried as the hidden `--system-prompt` value (so the window never shows the skill text), and `BareArgs` (no `--plugin-dir`, slash commands, MCP or user/project settings; the session file is kept so Resume works). The agent asks the user, runs `context` with 3-6 phrases from the answer, reads the output and draws. `codechroma_BARE_AGENTS=0` turns this off; non-claude CLIs without a bare switch keep the normal launch.
- **Fallback:** if the architecture map, graph or model is not ready, nothing is gathered (a missing model starts downloading) and the agent searches the repo itself, as before.

## Where the skills come from

`skills/` in the repo root is the only source; the bridge build copies it beside the executable, `SkillSync.SkillsRoot()` reads it (env `CODECHROMA_SKILLS_DIR` or `<bridge folder>/skills`), and `SyncAll` installs it into the opened project's `.claude/skills` at start. The short bodies (`bare-*.md`, `process-bare.md`) live there too. Details: [`diagram-skills.md`](diagram-skills.md).

## Gotchas

- 🔴 The agent's process gets a rebuilt environment, so the context command carries `--repo-path` and `--models-dir` explicitly; don't rely on inherited env vars.
- ⚠ The tool only knows what wiki-general knows: components whose files have no symbols in the c3 page show up as file names only (the agent then draws conceptual boxes). Regenerate wiki-general first.
- ⚠ Measured on this repo (Sonnet 5.5 only, 2026-10-20; 10 queries bare, same first 3 queries with the standard skill): bare averaged 38.6 s, 3.9 turns, $0.125 and found 13 of 21 expected components; on the 3 shared queries bare took 38 s / 4 turns / $0.11 / 5 of 7 vs standard 52 s / 8.7 turns / $0.24 / 7 of 7. That is about −27% time and −53% cost, not the prototype's −83% / −91%, and recall is lower. Weak spots: the retrieval budget (components with many files show few of them) and this repo's Python/web/C# duplicates. Opus was not measured.
- Measured (Sonnet 5.5, `c1` generate, 3 paired runs, after the C1 prompt was aligned with `type-c1.md`): short body 24 s / 6 turns / $0.043 avg vs full-skill inline 35 s / 9 turns / $0.156, all valid. Actor sets were similar (Anthropic, GitHub, Developer, sometimes Gemini/OpenAI); the full run found the spawned Claude Code CLI in 2 of 3 runs, the short one in 0 of 3; neither found SQLite. Only `c1` and `impact-changes` have headless generate routes in the C# bridge, so the patterns/impact/sequence short bodies are used only where those agents are started (not measured).
- Reranking (ettin-17m) was tested and lost end to end; it is intentionally not wired.

## Tests

`dotnet/CodeChroma.Bridge.Tests/Embeddings/` (tokenizer, hash-checked download; the real-model test runs when `CODECHROMA_TEST_MODEL_DIR` points at a folder with `model_quantized.onnx` + `tokenizer.json`), `Context/ContextTests.cs` (builder, selector, renderer, cache invalidation; real-repo test with `CODECHROMA_TEST_REPO`), `Skills/CliAdapterTests.cs`, `Skills/GenerateRouteTests.cs` (bare argv and inlined prompt).

## Canvas entry point

The rail's "Quick draw" button (`web/src/canvas/doc/QuickDrawPanel.tsx`, next to "Draw…") picks a saved diagram type, takes a one-sentence request and calls `EngineClient.generateProcessDiagram` → the route above, polling `getProcessDiagramStatus`. It shows the bridge's error (no architecture map, model unavailable) instead of falling back; "Draw…" (agent window) stays the fallback. The finished diagram appears through the usual diagram ping.
