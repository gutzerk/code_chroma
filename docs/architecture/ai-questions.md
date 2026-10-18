# AI questions and grill sessions (`src/codechroma/questions/`, `web/src/canvas/doc/question/`) — 017

An agent (Claude, Codex) asks a decision question through a bridge-hosted MCP tool instead of chat
text. The question becomes a `question` element on the one canvas, the user clicks an option (or
types their own), and the answer returns to the blocked agent call. A run of questions sharing a
`session_id` is a grill session. Planning doc: `docs/planning/017-ai-questions-grill-session.md`.
Phases 1 (backend) and 2 (canvas UI) are implemented; phase 3 (agent wiring) is a stub below; phase 4
(diagram options) is not started.

## Flow

```
agent ── MCP ask_user ──► bridge /mcp (bearer token names the workspace)
            QuestionMcp.ask: store.open_question (apply_batch add_element) ──► "canvas" ping ──► QuestionCard
                             broker.open + broker.wait(ask_wait_seconds)
user click ─► POST /repos/{id}/questions/{qid}/answer|skip ─► store.settle (meta) ─► broker wakes the waiter
```

## Backend

- `questions/models.py`: `QuestionOption` (`id, title, description, pro, con, rank, why, diagram_ref`),
  `AskRequest` (the `ask_user` input: `question, session_id, kind "choices"|"diagram", options,
  allow_custom=true, allow_skip=true, total, agent_id`), `QuestionResult`
  (`answer, option_id, skipped, pending, question_id`). `to_tool_dict()` returns
  `{answer, option_id, skipped}` or, when pending, `{pending: true, question_id}`.
- `questions/broker.py` `QuestionBroker` (one per `BridgeServices.questions`): in-memory, one asyncio
  future per question id plus a settled-result map. `open` (must run on the loop that will await),
  `wait(id, timeout)` (shielded; on timeout returns pending and keeps the waiter), `answer`/`skip`
  (return whether a live waiter was woken; settle via `call_soon_threadsafe`, since the routes run in
  a thread pool), `lookup`, `result`, `is_waiting`, `forget` (revise), `close`.
- `questions/store.py`: reads/writes `question` elements only through `apply_batch` under
  `canvas_lock`, committed by `routes/_canvas_write.commit_canvas_batch` (a lazy proxy; importing it
  at module load cycles through `bridge.routes`). `open_question` (layer `questions`, label = the
  question text, explanation "ai question"), `find_element`, `list_questions`, `settle`,
  `result_from`, `reopen`.
- `questions/mcp_server.py` `QuestionMcp`: one MCP server (`MCPServer`, name `codechroma`) mounted at
  `MOUNT_PATH = "/mcp"` in `create_app` before the SPA catch-all, served through a `_Delegate` ASGI
  shim (503 while not running). Its session manager runs inside the bridge `lifespan`
  (`async with app.state.question_mcp.running()`); a fresh `streamable_http_app` is built per run.
  Tools: `ask_user(question, options, kind, session_id, allow_custom, allow_skip, total, agent_id)`
  and `ask_user_result(question_id)`.
- Wait budget: `settings.questions.ask_wait_seconds` (default 300, `config.py` `QuestionsConfig`).
  On timeout `ask_user` returns `{pending: true, question_id}`; the agent polls `ask_user_result`.
- `routes/questions.py` (registered in `routes/__init__.py`).

### Auth token

`QuestionMcp.token_for(workspace_id)` = `<workspace_id>.<hmac-sha256>` keyed by a per-process random
secret (`secrets.token_bytes(32)`), sent as `Authorization: Bearer ...`. `workspace_id_for(token)`
splits on the last `.`, compares with `hmac.compare_digest` and raises `QuestionAuthError` when
forged or missing. The token is stable for the process lifetime only; it changes on every bridge
restart, so a long-lived agent window must be relaunched to get a new one.

## Routes (`bridge/routes/questions.py`)

| Route | Behaviour |
|---|---|
| `GET /repos/{id}/questions` | `{questions: [...]}` of open ones; each row is `{element_id, question, waiting, ...element.meta}`. `waiting` is false when no agent call is blocked on it (restart, or the wait timed out and was dropped). |
| `POST .../{qid}/answer` body `{answer?, option_id?}` | With `option_id`: must match an option (422 otherwise), answer defaults to its title. Without: refused 422 if `allow_custom` is false. Empty answer 422. Settles meta, then wakes the waiter. |
| `POST .../{qid}/skip` | 422 if `allow_skip` is false. Settles as skipped and wakes the waiter. |
| `POST .../{qid}/revise` | Works on a settled question (no 409 check): reopens it (`state open`, answer and option_id cleared), deletes later-step questions of the same `session_id`, `broker.forget`. Returns the ack plus `removed: [element ids]`. |

Unknown question id: 404. Answer/skip on an already-settled question: 409. Ack shape:
`{ok, question_id, state, waiting[, answer]}`.

Revise only changes canvas state: the agent call already returned, so the agent is not re-woken; the
reopened question shows `waiting: false` (an agent that wants the new answer must ask again).

## Element shape

`render: "question"`, `layer: "questions"` (`"question"` is in `RENDER_KINDS` in
`canvas/document.py`; `questions` is a non-diagram layer in `diagramCatalog.ts` `NON_DIAGRAM_LAYERS`).
`meta`: `question_id` (uuid hex), `session_id`, `step` (1-based, = count of elements already in that
session + 1, 1 without a session), `total`, `kind`, `state` (`open|answered|skipped`), `answer`,
`option_id`, `allow_custom`, `allow_skip`, `agent_id`, `options[]` (the `QuestionOption` dicts). The
options live in `meta`, not as child elements (the planning doc's "options are children" is not
implemented; phase 4 may revisit it for diagram options).

## Web (`web/src/canvas/doc/question/`)

- `questionAdapter.ts`: the one place mapping wire `meta`/payloads to the view model
  (`QuestionView`, `toQuestionView`, `sessionHistory`, `QuestionAck`, `OpenQuestionsPayload`,
  `QuestionAnswerBody`). Adjust here if backend field names change.
- `questionClient.ts` (`answerOption`, `answerCustom`, `skipQuestion`, `reviseQuestion` over
  `EngineClient`), `questionStrings.ts` (all labels; i18n strings, not hardcoded),
  `QuestionElement.tsx` (the `CanvasDocView` renderer; default width 620; refreshes via the bridge
  "canvas" ping), `QuestionCard.tsx`, `QuestionOptions.tsx` (rank, pro/con styling).
- `elementRules.ts`: `BLOCK_RULES.question` = `{renderer: "question", activation: "inspector",
  lockedLayout: true}` (never dragged or auto-laid-out); excluded from `StyledRenderKind`.
- `CanvasDocView.tsx`: `case "question"` renders `QuestionElement`; question elements are excluded
  from `memberIdsByLayer` so they get no diagram frame.
- `EngineClient`: `getOpenQuestions`, `answerQuestion`, `skipQuestion`, `reviseQuestion` (HTTP,
  delegating, stub and `mockBridge.ts`, where the mock mutates element meta instead of using a broker).

## Tests

Python: `tests/unit/test_question_broker.py` (wake on answer/skip, timeout then lookup, is_waiting),
`tests/unit/test_bridge_questions_route.py` (element meta, session steps, GET/answer/skip/revise,
refusals, blocked-ask wake, pending then `ask_user_result`, restart read-back from the element, token
forgery). Web (vitest): `QuestionCard.test.tsx`, `QuestionOptions.test.tsx`,
`questionAdapter.test.ts`, `questionFlow.test.tsx`, plus the `question` case in `elementRules.test.ts`.
Not yet written: the planned Playwright journey.

## Gotchas

- 🔴 The MCP session manager only runs inside the bridge lifespan; a test app without lifespan gets a
  503 from `/mcp`. A session manager runs once, hence a fresh app per `running()`.
- 🔴 `broker.open` must be called on the loop that awaits; `answer`/`skip` are called from route
  threads and hop back with `call_soon_threadsafe`.
- The broker is in memory: after a bridge restart an open question has no waiter. `ask_user_result`
  falls back to the element's meta, and `GET /questions` reports `waiting: false`.
- `commit_canvas_batch` is imported lazily in `store.py` (import cycle with `bridge.routes`).
- Answers are plain text, never executed; the endpoint relies on the loopback bridge plus the token.

## Agent wiring (phase 3)

- **MCP registration.** `terminal/agents.py` `agent_cli(..., mcp=)` adds `--mcp-config <file>` for the `claude` and provider-routed `agent` kinds, only when the resolved CLI is Claude. The config (`questions/launch.py`, `McpEndpoint.claude_config()`) is `{type: http, url: <base>/mcp/, headers: {Authorization: Bearer <token>}, timeout: (ask_wait_seconds + 60) * 1000}`, written to `<tempdir>/codechroma-mcp/<agent id>.json` (a file, because inline JSON is mangled by PTY quoting on Windows). 🔴 `--mcp-config` is variadic, so it must precede `--plugin-dir` and the positional initial prompt.
- **Port and token.** The terminal router shares the graph bridge's process and port. The workspace id is the agent id; the token is `QuestionMcp.token_for(agent_id)`. The base URL comes from `codechroma_BRIDGE_URL`, else uvicorn's `--port` in `sys.argv` (boot-time auto-start), else the `/agents/{id}/start` request's base URL rewritten to 127.0.0.1. With none of these (and on the C# bridge, which does not host `/mcp`) nothing is injected and argv is unchanged. The agent env also gets `codechroma_BRIDGE_URL` and `codechroma_QUESTION_TOKEN`.
- **Skill.** `.claude/skills/codechroma-grill/SKILL.md` tells the agent to ask via `ask_user`, one question at a time, 2-3 options with description/pro/con/rank/why (rank 1 recommended), and to poll `ask_user_result` on `{pending: true}`. It is bundled in `packaging/bridge.spec` but deliberately not in `SKILL_NAMES`, so it is not synced into analyzed repos.
- **AskUserQuestion hook.** `.claude/hooks/hooks.json` (plugin root, so no edit to user settings) matches `AskUserQuestion` with `timeout: 600` and `onFailure: "block"`; `ask_user_question_hook.py` (stdlib only) posts each question to `POST /repos/{id}/questions/ask` (same bearer token) and prints `permissionDecision: allow` with the original input plus an `answers` map. It fails open (prints nothing, exit 0) when the env vars are absent, the bridge is unreachable, an answer is skipped/pending, or its 570 s deadline passes, so Claude's native dialog appears. Multi-select questions are asked as single-select.
- **Codex.** Not wired: no per-run MCP override could be verified (`codex` was not installed when this was built). Needs `-c mcp_servers.codechroma.*` or a generated `CODEX_HOME`, plus an `AGENTS.md` snippet.
- **Verified:** real uvicorn + `mcp` client: the bearer header reaches `ctx.headers`, `ask_user` blocks until answered over REST, a forged token errors, and the hook script runs end to end. **Not verified in a real `claude` process:** plugin-dir `hooks/hooks.json` loading, the `AskUserQuestion` matcher, `onFailure`, `updatedInput.answers` auto-answering, per-server `timeout`, and the frozen-bundle `hooks` layout.
- Tests: `tests/unit/test_question_agent_wiring.py`.
