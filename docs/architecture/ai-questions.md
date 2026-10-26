# AI questions and grill sessions (`src/codechroma/questions/`, `web/src/canvas/doc/question/`) — 017

An agent (Claude, Codex) asks a decision question through a bridge-hosted MCP tool instead of chat
text. The question becomes a `question` element on the one canvas, the user selects an option and presses Send (or
types their own answer), and the answer is typed into the asking agent's terminal as its next message (024, non-blocking). A run of questions sharing a
`session_id` is a grill session. Planning doc: `docs/planning/017-ai-questions-grill-session.md`.
Phases 1 (backend), 2 (canvas UI), 3 (agent wiring) and 4 (diagram options, 021) are implemented.

## Flow

```
agent ── MCP ask_user ──► bridge /mcp (bearer token names the workspace)
            QuestionMcp.ask: store.open_question (apply_batch add_element) ──► "canvas" ping ──► QuestionCard
            returns at once {asked: true, question_id, next: "End your turn now..."}   (agent ends its turn, LED idle + "?")
user click ─► POST /repos/{id}/questions/{qid}/answer|skip ─► store.settle (meta)
            ─► delivery.deliver ─► AgentSession.inject_when_idle(line, attempts=86400) ─► typed into the agent's terminal
agent resumes with "[CodeChroma answer · Q1/3 · <qid>] <question> → <answer>" as its next user message
```

There is no broker and nothing waits: `ask_user` never blocks, so the agent is never "running" while a question is open (#281). `ask_user_result(question_id)` still reads an answer back from the element meta for clients without a terminal.

## Backend

- `questions/models.py`: `QuestionOption` (`id, title, description, pro, con, rank, why, diagram_ref`),
  `AskRequest` (the `ask_user` input: `question, session_id, kind "choices"|"diagram", options,
  allow_custom=true, allow_skip=true, total, agent_id`), `QuestionResult`
  (`answer, option_id, skipped, pending, question_id`). `to_tool_dict()` returns
  `{answer, option_id, skipped}` or, when pending, `{pending: true, question_id}`.
- `questions/delivery.py`: `answer_message(element)` builds `[CodeChroma answer · Q{step}/{total} · {question_id}] {question} → {answer}` (one line, control characters collapsed; a skip reads "skipped by the user, decide yourself"; an answer after a revise, i.e. `meta.revised`, reads "changed answer: ..."), `diagram_request_message` the "Add diagram" line, `live_session(services, element)` finds the live `AgentSession` by `meta.agent_id`, and `deliver(services, element, text=None)` calls `session.inject_when_idle(text, attempts=settings.questions.answer_inject_attempts)` (86400 attempts, about 12 hours: effectively until the agent goes idle or exits; injections into one session are serialized and each is followed by one poll interval, so two quick answers never interleave; launch context keeps its own default). A reask clears `meta.revised`, so only the first answer after a revise reads "changed answer" and returns whether a live session received it. The old `QuestionBroker` and `BridgeServices.questions` are gone.
- `questions/store.py`: reads/writes `question` elements only through `apply_batch` under
  `canvas_lock`, committed by `routes/_canvas_write.commit_canvas_batch` (a lazy proxy; importing it
  at module load cycles through `bridge.routes`). `open_question` (layer `questions`, label = the
  question text, explanation "ai question"), `find_element`, `list_questions`, `settle`,
  `result_from`, `reopen` (sets `meta.revised = true`), `request_diagram`, `draw_diagram`.
- `questions/mcp_server.py` `QuestionMcp`: one MCP server (`MCPServer`, name `codechroma`) mounted at
  `MOUNT_PATH = "/mcp"` in `create_app` before the SPA catch-all, served through a `_Delegate` ASGI
  shim (503 while not running). Its session manager runs inside the bridge `lifespan`
  (`async with app.state.question_mcp.running()`); a fresh `streamable_http_app` is built per run.
  Tools: `ask_user(question, options, kind, session_id, allow_custom, allow_skip, total)` (returns `{asked: true, question_id, next}` at once; `agent_id` is not a tool argument), `ask_user_result(question_id)` (settled answer from the element, else `{pending: true, question_id}`) and `draw_option_diagram`.
- `settings.questions.answer_inject_attempts` (default 86400, `config.py` `QuestionsConfig`). `ask_wait_seconds` was removed with the blocking design.
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
| `GET /repos/{id}/questions` | `{questions: [...]}` of open ones; each row is `{element_id, question, waiting, ...element.meta}`. `waiting` is true when a live agent session (by `meta.agent_id`) will receive the answer; false when the agent window is gone or was never an agent window. |
| `POST .../{qid}/answer` body `{answer?, option_id?}` | With `option_id`: must match an option (422 otherwise), answer defaults to its title. Without: refused 422 if `allow_custom` is false. Empty answer 422. Settles meta, then `delivery.deliver` types the answer into the agent (ack `waiting` = a live session received it). |
| `POST .../{qid}/skip` | 422 if `allow_skip` is false. Settles as skipped and delivers the "skipped by the user, decide yourself" line. |
| `POST .../{qid}/revise` | Works on a settled question (no 409 check): reopens it (`state open`, answer and option_id cleared), deletes later-step questions of the same `session_id`, sets `meta.revised = true`. Returns the ack plus `removed: [element ids]`. |

Unknown question id: 404. Answer/skip on an already-settled question: 409. Ack shape:
`{ok, question_id, state, waiting[, answer]}`.

Revise only changes canvas state and delivers nothing (ack `waiting: false`); because `meta.revised` is set, the next answer to the reopened question is typed into the agent as "changed answer: ...".

## Element shape

`render: "question"`, `layer: "questions"` (`"question"` is in `RENDER_KINDS` in
`canvas/document.py`; `questions` is a non-diagram layer in `diagramCatalog.ts` `NON_DIAGRAM_LAYERS`).
`meta`: `question_id` (uuid hex), `session_id`, `step` (1-based, = count of elements already in that
session + 1, 1 without a session), `total`, `kind`, `state` (`open|answered|skipped`), `answer`,
`option_id`, `allow_custom`, `allow_skip`, `agent_id`, `options[]` (the `QuestionOption` dicts). The
options live in `meta`, not as child elements (the planning doc's "options are children" is not
implemented; the diagram options kept this shape: `option.diagram_ref` points at a diagram root).

## Web (`web/src/canvas/doc/question/`)

- `questionAdapter.ts`: the one place mapping wire `meta`/payloads to the view model
  (`QuestionView`, `toQuestionView`, `sessionHistory`, `QuestionAck`, `OpenQuestionsPayload`,
  `QuestionAnswerBody`). Adjust here if backend field names change.
- `questionClient.ts` (`answerOption`, `answerCustom`, `skipQuestion`, `reviseQuestion` over
  `EngineClient`), `questionStrings.ts` (all labels; i18n strings, not hardcoded),
  `QuestionElement.tsx` (the `CanvasDocView` renderer; default width 620; refreshes via the bridge
  "canvas" ping), `QuestionCard.tsx`, `QuestionOptions.tsx`, `ConnectedQuestionCard.tsx` (the card wired to
  the bridge; used by the canvas element and the agent terminal alike).
- **Soft-tiles card (020).** One `QuestionCard` with `variant: "compact" | "full"` (`full` on the canvas and in B1).
  A click or `1`-`9`/arrows only *selects* an option (`role="radiogroup"`/`radio`); **Send** or Enter confirms,
  and the rank-1 option starts selected. Rank shows only as a soft-green "Recommended" pill (the `why` text is
  its tooltip); there are no rank borders. Colours are `--question-*` tokens on `:root` in `styles.css`. The
  card handles its own keys (`onKeyDown` on the card, no global listeners): Esc skips when `allowSkip`,
  Shift+Tab / Ctrl+Enter / after an answer call `onReturnFocus` (the terminal's `focus()`). An answered card
  collapses to one line ("✓ Q2 · title · answer · Change"); "Earlier: … · Change" opens `DecisionHistory`.

### Agent terminal host (020)

`web/src/agents/AgentQuestionHost.tsx` wraps the xterm element in `AgentTerminal` (so the docked panel, floating
windows, `ActivityPanel` and the tutorial mock all get it). `useOpenAgentQuestions(agentId)` filters open `question`
elements by `meta.agent_id` and sorts by `meta.step`; the host shows only the first (oldest). It measures its own
width (ResizeObserver) and `pickQuestionLayout({width, full, hasDiagram})` picks: **B1** (agents panel full mode and
width >= 1100: question + diagram left, terminal 520px right), **A4** (width >= 880 and some option has a
`diagram_ref`: 420px diagram pane left, compact card under the terminal) or **A2** (compact card under the
terminal). `hasDiagram` is "any option has one" (not just the selected one) so the pane does not flicker, and an option
without a diagram shows "No diagram for this option". The terminal div keeps one tree position across layouts, so a
switch never remounts xterm. A new question does not steal focus; Ctrl+Enter in the terminal focuses the card.
`QuestionDiagram.tsx` renders `diagram_ref` and its children (group members + arrow targets, max 40) as a
read-only scaled view with option tabs, drag-to-pan, wheel/button zoom and a full-screen overlay (Esc closes); the fit scale is floored at 0.6 so labels stay readable (a larger diagram is panned, not shrunk), nodes show label + description and arrows connect node boundaries so their heads remain visible, and show labels; it is a light renderer, not
`CanvasNodeBox`, which is interactive. Attention: `AgentLed` takes `agentId` and turns accent-coloured with a "?" badge
while that agent has an open question, and the Agents tab shows a "N questions" pill (`useOpenQuestionCount`).
The highlighted option is owned by the host (`resolveSelection` in `questionAdapter.ts` falls back to the recommended option when the pick no longer exists, e.g. after a re-ask) and passed to `QuestionCard` as the controlled `selectedId`, so the diagram tabs and Send always agree; `QuestionCard` owns it only when used standalone (`QuestionElement`). `CanvasFocusContext` is provided at `RootCanvas` root so "Open on canvas" works from the agents panel. `devAskQuestion.ts` (mock bridge, opt-in via `VITE_DEV_ASK_QUESTION=1`, dynamically imported) asks a demo question when Enter is pressed in an agent terminal.
- `elementRules.ts`: `BLOCK_RULES.question` = `{renderer: "question", activation: "inspector",
  lockedLayout: true}` (never dragged or auto-laid-out); excluded from `StyledRenderKind`.
- `CanvasDocView.tsx`: `case "question"` renders `QuestionElement`; question elements are excluded
  from `memberIdsByLayer` so they get no diagram frame.
- `EngineClient`: `getOpenQuestions`, `answerQuestion`, `skipQuestion`, `reviseQuestion` (HTTP,
  delegating, stub and `mockBridge.ts`, where the mock mutates element meta instead of using a broker).

## Tests

Python: `tests/unit/test_bridge_questions_route.py` (element meta, session steps, GET/answer/skip/revise,
refusals, answer/skip/request-diagram delivery into a fake live session, non-blocking ask, `ask_user_result` read-back from the element, token
forgery). Web (vitest): `QuestionCard.test.tsx`, `QuestionOptions.test.tsx`,
`questionAdapter.test.ts`, `questionFlow.test.tsx`, `pickQuestionLayout.test.ts`, `QuestionDiagram.test.tsx`,
`web/src/agents/AgentQuestionHost.test.tsx`, plus the `question` case in `elementRules.test.ts`.
Not yet written: the Playwright journey (ask in the docked panel, answer in the terminal, resize across the layout thresholds).

## Gotchas

- 🔴 The MCP session manager only runs inside the bridge lifespan; a test app without lifespan gets a
  503 from `/mcp`. A session manager runs once, hence a fresh app per `running()`.
- Delivery is best effort: with no live session (window closed, bridge restarted) the answer stays on the element meta, `ask_user_result` returns it, and `GET /questions` reports `waiting: false`.
- Answers are typed into the PTY, so `delivery._one_line` strips control characters; keep that when changing the message text (the C# `QuestionDelivery.OneLine` mirrors it).
- `commit_canvas_batch` is imported lazily in `store.py` (import cycle with `bridge.routes`).
- Answers are plain text, never executed; the endpoint relies on the loopback bridge plus the token.

## Question contract and option diagrams (021)

The `ask_user` server, not a skill, enforces the question format, so it holds for any CLI that gets the MCP config.

- **Contract** (`questions/validation.py`). `validate_ask` returns one line per problem: non-empty question; 2-4 options with unique ids, each with non-empty `title`, `description`, `pro`, `con`, `why`; exactly one `rank: 1`, ranks unique; `kind: "diagram"` needs a `diagram_ref` on at least one option. `QuestionMcp._check` also rejects a `diagram_ref` that names no canvas element (`store.known_element_ids`). A break raises `QuestionRejected`, which the MCP SDK returns as an `isError` tool result (header "CodeChroma rejected the question.", one bullet per problem, a fixed "Call ask_user again..." footer). `POST /repos/{id}/questions/ask` maps it to 422. No question element is created. Old stored questions render as before; validation runs only on new calls.
- **Retry limit.** `RejectionTracker` (`QuestionMcp.rejections`, in memory) counts rejections per (workspace id, `session_id`; when omitted, the MCP connection's `mcp-session-id`, and a call with neither is never tracked so agents never share a counter) and forgets after 10 minutes of silence, a valid question, or a degraded pass-through (the count is consumed, so the next bad call is rejected again); stale entries are evicted and the map is capped at 1000. Below `settings.questions.max_rejections` (3) the call is rejected; at the limit it is accepted unchanged with `meta.degraded = true` and `meta.validation` (the last rejection text). The card shows no error, only fewer parts.
- **Tool description.** `_INSTRUCTIONS` in `mcp_server.py` carries the whole contract, when to use `kind: "diagram"`, and the `needs`/`pending` results, so it reaches the agent without any project skill.
- **`draw_option_diagram` tool** (`questions/diagrams.py`, `store.draw_diagram`). Args `title`, `nodes [{id, label, description?, status?}]`, `edges [{from, to, label?}]`, optional `question_id` + `option_id`. At most 12 nodes (`MAX_NODES`), unique ids, non-empty title/labels, length caps (title 80, id 40, label 60, description 300), edges between known nodes with no self-loops or duplicates, else `QuestionRejected`; `check_decision_diagram.py` applies the same rules and `test_question_validation.py` pins parity between the two (the NON_DIAGRAM_LAYERS mirror is pinned by `test_non_diagram_layers_parity.py`). It writes a `group` root plus `custom` member elements and edges on the per-question layer `decisions/<question_id>`, or on a `decisions/draft-<hex>` layer when drawn before the question exists (`store._adopt_ops` moves the diagrams an `ask_user` option references onto `decisions/<qid>` when the question opens). Positions are element centres (what `elementRect.ts` reads) and the root group is sized to wrap its members; a new diagram is placed below the lowest existing `decisions/*` element (`store._next_top`), so dragged diagrams never overlap. `status: "new"` in `meta` marks parts that do not exist yet; when more than half the nodes lack a `description` the result carries a `warning`. `decisions/*` layers are diagram layers in the panel (one row per question, labelled with the question text) but canvas-only: `document.py` `is_canvas_only_layer` keeps them out of the projection path, so deleting one removes canvas content only (the option's `diagram_ref` then dangles and the card shows "No diagram"; "Add diagram" is allowed again). The plain `decisions` layer stays non-diagram for old elements. Returns `{diagram_ref: <root id>}`; with `question_id`/`option_id` the ref is also written onto that option. Skill: `skills/codechroma-decision-diagram` (a quality guide on top of the tool, `scripts/check_decision_diagram.py` as the draft checker), listed in `SKILL_NAMES` and `SkillSync.cs`.
- **"Add diagram" button.** `POST .../{qid}/request-diagram` (422 when every option has a diagram) sets `meta.diagram_requested`, `diagram_requested_at`, `diagram_requests` (counted once: repeat clicks only re-send the line) and types a request line (`delivery.diagram_request_message`: draw the diagrams, then call `ask_user` again with the same `session_id` and question) into the agent's terminal, so the button also reaches the agent (the response's `waiting` is true when a live session received it). The agent draws diagrams and calls `ask_user` again: `store.find_diagram_requested` finds the open diagram-requested element (same `session_id`, or with no session the same text on a session-less card; there is no sole-card fallback, so an unrelated ask opens its own card) and `store.reask` updates it in place (same id; label, options, session/total replaced, `degraded`/`validation` rewritten, `diagram_requested` cleared) and skips older same-session duplicates in the same commit. The card (`QuestionCard` `onRequestDiagram`, `EngineClient.requestQuestionDiagram`, mock bridge parity) shows "Add diagram" while an option lacks a ref and fewer than 2 requests were made, and a disabled "Diagram requested" while waiting.
- **Native `AskUserQuestion`.** `hooks/ask_user_question_hook.py` denies the call, naming `mcp__codechroma__ask_user` and its fields, only when `CODECHROMA_QUESTION_TOKEN`, `CODECHROMA_BRIDGE_URL` and `CODECHROMA_WORKSPACE_ID` are all set (the launcher injects it together with `--mcp-config`, so the agent has the `codechroma` server) and `GET {bridge}/mcp/` answers within 0.5 s (any HTTP status). Otherwise it prints nothing and Claude's native dialog appears; there is no reroute to the canvas any more. `AskRequest.degraded` remains on the HTTP ask route but the hook no longer sends it.
- 🔴 Not covered: questions typed as terminal text (not detected). The C# bridge hosts `/mcp/` and the `AskUserQuestion` hook too (see "C# bridge port" below). Codex gets only the server contract and its tool-error handling is unverified.
- Tests: `tests/unit/test_question_validation.py`, `test_bridge_questions_route.py` (request-diagram), `test_question_agent_wiring.py` (hook), `QuestionCard.test.tsx`.

## C# hook

`Questions/AskUserQuestionHook.cs` is the C# twin of `hooks/ask_user_question_hook.py`: the bridge binary run as `codechroma-bridge ask-user-question` (dispatched in `Program.cs` before the web host boots) reads the same `CODECHROMA_BRIDGE_URL`/`CODECHROMA_QUESTION_TOKEN`/`CODECHROMA_WORKSPACE_ID` env (lower-case legacy spelling accepted), probes `{bridge}/mcp/` for 0.5 s (any HTTP status counts) and prints the same deny decision; any error exits 0 silently. `AgentSessionOwnership.HookSettings(sessionTracking, askUserQuestion)` builds the `--settings` JSON, and `TerminalAgents.OwnedLaunch` passes it whenever the window has session tracking or an MCP endpoint (never for a bare window). Tests: `AskUserQuestionHookTests`, `TerminalAgentsBareTests`.

## Agent wiring (phase 3)

- **MCP registration.** `terminal/agents.py` `agent_cli(..., mcp=)` adds `--mcp-config <file>` for the `claude` and provider-routed `agent` kinds, only when the resolved CLI is Claude. The config (`questions/launch.py`, `McpEndpoint.claude_config()`) is `{type: http, url: <base>/mcp/, headers: {Authorization: Bearer <token>}, timeout: 60_000} (60 s on both bridges, since `ask_user` returns at once)`, written to `<tempdir>/codechroma-mcp-XXXX/<agent id>.json` (a file, because inline JSON is mangled by PTY quoting on Windows). The directory is a per-process `mkdtemp` (0700), never a fixed shared path another local user could pre-create or symlink (`launch.py` `_private_config_dir`, reused while it exists; the file is chmod 0600). 🔴 `--mcp-config` is variadic, so it must precede `--plugin-dir` and the positional initial prompt.
- **Port and token.** The terminal router shares the graph bridge's process and port. The workspace id is the agent id, and `QuestionMcp.ask` stamps it server-side as `meta.agent_id` (overriding any caller value; the canvas selects terminal questions by it); the token is `QuestionMcp.token_for(agent_id)`. The base URL comes from `CODECHROMA_BRIDGE_URL`, else uvicorn's `--port` in `sys.argv` (boot-time auto-start), else the `/agents/{id}/start` request's base URL rewritten to 127.0.0.1. With none of these nothing is injected and argv is unchanged. The agent env also gets `CODECHROMA_BRIDGE_URL` and `CODECHROMA_QUESTION_TOKEN`.
- **Skill.** `skills/codechroma-grill/SKILL.md` (listed in `SKILL_NAMES`, so synced into opened repos) tells the agent to ask via `ask_user`, one question at a time, 2-4 options with description/pro/con/rank/why (rank 1 recommended), and, after `ask_user` returns `{asked: true}`, to end the turn (never poll, never repeat the question in chat); the answer arrives as the next message.
- **AskUserQuestion hook** (021 changed it to deny first, see above). `hooks/hooks.json` (plugin root, so no edit to user settings) matches `AskUserQuestion` with `timeout: 15` (the hook only does a 0.5 s probe) and `onFailure: "block"`; `ask_user_question_hook.py` (stdlib only) denies the native tool toward `ask_user` (see above) and fails open (prints nothing, exit 0) when the env vars are absent, the bridge is unreachable, or any error occurs.
- **Codex.** Not wired: no per-run MCP override could be verified (`codex` was not installed when this was built). Needs `-c mcp_servers.codechroma.*` or a generated `CODEX_HOME`, plus an `AGENTS.md` snippet.
- **Verified:** real uvicorn + `mcp` client: the bearer header reaches `ctx.headers`, `ask_user` blocks until answered over REST, a forged token errors, and the hook script runs end to end. **Not verified in a real `claude` process:** plugin-dir `hooks/hooks.json` loading, the `AskUserQuestion` matcher, `onFailure`, `updatedInput.answers` auto-answering, per-server `timeout`, and the frozen-bundle `hooks` layout.
- Tests: `tests/unit/test_question_agent_wiring.py`.

- **`store.draw_diagram`** draws the diagram and attaches `diagram_ref` in one atomic commit (nothing is drawn if the option is unknown); placement is `_next_top` (below the question's own layer, else below every `decisions/*` element), so deleting a diagram never causes overlap. Draft diagrams are stamped `meta.drawn_at`; each ask/reask prunes unadopted drafts older than `DRAFT_TTL_SECONDS` (1 h) so abandoned asks leave no layer.

## C# bridge port (`dotnet/CodeChroma.Bridge`)

The shipped desktop app runs the C# bridge, so the feature is ported there with the same non-blocking flow (no new NuGet packages; plain JSON-RPC over `POST`, modelled on `Workflows/WorkflowRunner.Steer.cs` `HandleMcp`). There is no broker in C# either.

File map (`Questions/`):
- `QuestionModels.cs` (`AskRequest`, `QuestionOption`, `QuestionResult`, strict `ArgReader`), `QuestionValidation.cs` (the contract, `RejectionText`, `RejectionTracker`), `QuestionDiagrams.cs` (`draw_option_diagram` budget, centre positions, `LayerFor`/`DraftPrefix`, canvas ops), `QuestionStore.cs` (all `question` element reads/writes through `ApplyBatch.Apply` + `CanvasWrite.Commit` under `CanvasWrite.LockFor`; adopts draft layers; `Reopen` sets `revised`).
- `QuestionDelivery.cs`: `AnswerMessage`/`DiagramRequestMessage` (same text as `delivery.py`) and `Deliver`, which finds the live `AgentSession` by `meta.agent_id` and calls `InjectWhenIdle(text, IdleAttempts = 86400)`; an overload takes an injector delegate for tests.
- `QuestionMcp.cs` (HMAC token, `Ask`/`Result`/`DrawDiagram`, `HandleMcp`), `McpEndpoint.cs` (URL, env, `--mcp-config` file), `AskUserQuestionHook.cs` (see "C# hook").
- `Routes/QuestionRoutes.cs`: `GET /repos/{id}/questions` (`waiting` = live session), `POST .../questions/ask` (bearer, 401/422), `.../{qid}/answer|skip|request-diagram|revise` (404 unknown, 409 settled, 422 refusals, same ack shape as Python; answer/skip/request-diagram deliver into the session), and `POST /mcp/` (bearer = `workspace_id.hmac-sha256`, per-process random secret, constant-time compare; 401 on a forged or missing token). `GET`/`DELETE /mcp/` return 405 (the hook's 0.5 s probe accepts any status). Tools `ask_user`, `ask_user_result`, `draw_option_diagram`; results carry `structuredContent`. `initialize` issues an `Mcp-Session-Id`, which only keys the retry counter of a sessionless agent (the server stays stateless).
- Retry budget `MaxRejections` (3); the MCP config timeout is 60 s (`McpEndpoint`), as `ask_user` returns at once.
- Consistency: `Ask` selects a diagram-requested card and commits its options under one canvas lock, shared with answer/skip/revise. `ask_user_result` verifies the question exists in the authenticated workspace under that lock; foreign or unknown ids return pending. Regression tests: `QuestionConcurrencyTests`, `QuestionResultScopeTests`.
- 🔴 `CanvasDoc.RenderKinds` gained `question`, `NonDiagramLayers` gained `questions` and `decisions`, plus the `decisions/` canvas-only prefix rule (kept in step with `document.py`); without that the elements are rejected or written as a projection folder. Canvas op numbers must be JSON doubles (`ApplyBatch` reads positions with `TryGetValue<double>`, which fails on an int node).
- Wiring: `Terminal/TerminalAgents.cs` `Resolve(..., agentId, bridgeUrl)` adds `--mcp-config <tempdir>/codechroma-mcp-XXXX/<agent id>.json` (a per-process `Directory.CreateTempSubdirectory`, 0700) for Claude windows only, before `--plugin-dir` and the positional prompt (the flag is variadic), and returns env `CODECHROMA_QUESTION_TOKEN`, `CODECHROMA_BRIDGE_URL`, `CODECHROMA_WORKSPACE_ID`. Nothing is injected without an agent id or a known bridge URL (`BareSkill.BridgeUrl`), for non-Claude CLIs, shells, or bare windows. Resumed windows get a fresh config, since the token changes per bridge process.
- Gaps (also in `docs/planning/012-csharp-bridge.md`): Codex is not wired; the hook still needs Python on PATH for the Python plugin `hooks/hooks.json` copy (the C# bridge binary is its own hook); the Avalonia canvas (`CodeChroma.Canvas`) has no `question` render kind; `check_decision_diagram.py` parity with `QuestionDiagrams.Validate` is by matching rules, not a cross-language test; not verified against a real `claude` process. Shared contract cases: `tests/fixtures/bridge_contract/questions.cases.json` (Python `test_bridge_wire_contract.py`, C# `WireContractTests`).
- Tests (`dotnet/CodeChroma.Bridge.Tests/Questions/`): `QuestionValidationTests`, `QuestionRoutesTests` (routes, MCP JSON-RPC over the test server, non-blocking ask, degraded pass-through, re-ask, draw), `QuestionDeliveryTests`, `QuestionDiagramLayoutTests`, `QuestionAgentWiringTests` (argv order, env, config file, token), `AskUserQuestionHookTests`.
