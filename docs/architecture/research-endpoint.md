# Research endpoint (natural-language Q&A over the graph hierarchy)

A fourth skill-agent capability, after C1, Patterns, and C1-review: ask a question, get a
synthesized answer with citations that jump into the existing Inspector. The original planning doc
(`docs/planning/006-graph-research-endpoint/`) is not present in this checkout; see
`specs/006-graph-research-endpoint/` for the formalized spec/plan/tasks — this file is the permanent
record; the spec stops being the source of truth once behavior changes here.

## Backend pipeline

- `research/embeddings_provider.py` — `EmbeddingsProvider` protocol + `VoyageEmbeddingsProvider`
  (raw `urllib.request` POST to Voyage AI's REST endpoint — no SDK dependency, mirrors
  `context/llm_provider.py`'s `LLMProvider`/`provider_from_env` shape) and
  `embeddings_provider_from_env()`, gated on `VOYAGE_API_KEY`.
- `research/indexer.py` — `embed_node_summaries()` writes `.codechroma/research-index.json`
  (`{fingerprint, provider, model, entries: [{node_id, embedding}]}`), fingerprint-gated like
  `patterns.json` so an unchanged repo re-embeds nothing. Called from
  `GraphEngine._run_analysis()`/`seed()` (`engine.py`'s `_embed_research_index`), right beside the
  existing `_write_dependency_digest` call, and **only** if a provider is configured. The call is
  dispatched via `_embed_research_index_async` onto a fire-and-forget daemon thread rather than run
  inline: `reanalyze()` runs synchronously on the watcher's own thread (`bridge/live.py`'s
  `_Watcher._run`), so a blocking Voyage HTTP call there would stall every subsequent file-save's
  live update behind it, not just this one's embedding step.
- `research/search.py` — `semantic_search()` (cosine over the index), `keyword_search()`
  (token-overlap over `.codechroma/dependency-digest.json`, needs no provider or index at all),
  `find_hits()` (picks between them), and `build_degraded_answer()` (a templated, non-LLM answer for
  the keyword path). Absence of `research-index.json` — not a live provider probe — is the degrade
  signal `routes/research.py` checks, so the decision matches whatever the last `reanalyze()` (or its
  absence) actually computed.
- `bridge/research_context.py` — `build_research_context()`, the skill's *only* source of node ids
  (mirrors `patterns_context.py`'s role for Patterns).
- `bridge/research_agent.py` — the fourth `SkillAgent` instance. Jobs are keyed by a composite
  `job_key = f"{workspace_id}:{query_hash}"` rather than a bare repo id, so two different questions
  against the same repo get independent job slots and the same question asked twice attaches to the
  same in-flight/finished job instead of double-spawning `claude`. `research_answer_path(repo_root,
  job_key)` computes `.codechroma/research/answers/{query_hash}.json` — one file per question, not one
  shared file, so one question's snapshot/restore can never corrupt another's answer.
- `bridge/routes/research.py` — `POST /repos/{id}/research?q=...` (starts-or-attaches a job, or
  answers inline with no subprocess at all when degraded or already cached — `WritableWs`-guarded, so
  a PR-review workspace gets 409), `GET /repos/{id}/research/{job_key}` (poll status + answer),
  `find_hits()` runs via `asyncio.to_thread` here too — the same blocking-Voyage-HTTP-call reason the
  indexer's own embed call is backgrounded, this time so it doesn't stall the FastAPI event loop
  (other requests, the `/repos/{id}/events` websocket) for the round trip.
  `GET .../output` (streamed skill log), `GET .../context` and `GET .../path` (skill-internal, not
  called by the UI). The `research-status`/`research-output` callback pair comes from
  `routes/_skill_jobs.job_callbacks`, and the artifact read is `io.load_json_or_none` — both shared
  with the epics/custom routes.
- `GET /repos/{id}/research-search?q=...` — a second, synthesis-free consumer of `find_hits()`
  (056-diagram-draw-speed): returns raw `hits[]` plus the `semantic` flag, no `SkillAgent`, no job,
  no polling, plain `Ws` (no write, so no `WritableWs` guard — a PR-review workspace can search too).
  `codechroma-draw-diagram`'s "Docs-first, then research search" step calls this instead of the `POST`
  route above; the standalone Research panel is untouched and still gets its synthesized, cited answer
  from `POST /repos/{id}/research`.
- `.claude/skills/codechroma-research/SKILL.md` — reads `/context`, is instructed to cite only the
  `node_id`s that payload listed (never invents one), writes to `/path`'s resolved location.

🔴 **`SkillAgent.artifact` and `SkillAgent.start`'s `prompt` are both per-job, not fixed at
construction.** `artifact` widened from `Callable[[Path], Path]` to `Callable[[Path, str], Path]`
(repo root, job key) so research's per-question artifact path can differ per job; `c1_agent.py`,
`patterns_agent.py`, and `c1_review_agent.py` pass a lambda that ignores the new second parameter and
are otherwise unchanged (confirmed by their existing test suites passing unmodified). `start()` grew
an optional `prompt: str | None = None` — a local parameter, never stored on `self`, so concurrent
jobs on one `SkillAgent` instance can each use their own rendered prompt (research bakes the actual
question and `job_key` into the prompt via `render_prompt("research_agent", query=..., job_key=...)`)
without racing each other. Both changes are recorded in
[`docs/architecture/c1-diagram.md`](c1-diagram.md)'s `SkillAgent` section as a cross-reference.

## Frontend

- `state/useResearch.ts` — `ask(query)` + poll (plain `setInterval`, not a websocket push — a
  question is a one-off ask, not a status the user watches continuously like a diagram generation).
- `canvas/ResearchPanel.tsx` — a plain ask-a-question box (question input, answer, citation list),
  **not** a canvas view: no dagre layout, no per-node boxes. Docked at the bottom of `.canvas-area`
  beside `TerminalPanel`, toggled by a rail button (`canvas/researchPanelStore.ts`, mirrors
  `terminalPanelStore.ts`) — latch-mounted the same way Terminal/Inspector are, so an in-progress
  question survives close/reopen.
- A citation click calls `inspectorStore.open(node_id, label)` directly — the existing Inspector,
  zero new plumbing (same as Plan/Diff/C1 panels already do).
- `engine-client/EngineClient.ts` gained `askResearch()`/`getResearchAnswer()`;
  `mockBridge.ts`/`stubEngineClient.ts` carry `MOCK_RESEARCH_*`/`RESEARCH_STUB` fixtures.

## Tests

`tests/unit/test_research_indexer.py`, `test_research_search.py` (both branches),
`test_research_agent.py` (reuses `tests/unit/fake_claude.py`), `test_bridge_research_route.py`
(degrade/cache/read-only-guard, plus `research-search`'s no-subprocess/no-guard contract),
`test_skill_agent.py` (pins the widened `artifact`/`prompt`
contract) · `web/src/state/useResearch.test.ts`, `web/src/canvas/ResearchPanel.test.tsx`,
`web/e2e/research-panel.spec.ts`.

## Known gaps

- Git-history questions ("what changed recently") are explicitly out of scope — see
  [005 — ChunkHound MCP integration](../planning/005-chunkhound-mcp-integration/005-chunkhound-mcp-integration.md).
- Only one `EmbeddingsProvider` ships (Voyage AI); OpenAI/Ollama are future adapters behind the same
  protocol, zero caller changes when added.
- No research canvas view/rail-driven layout — the panel is intentionally the whole UI surface.
