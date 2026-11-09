# AI questions and grill sessions (`src/codechroma/questions/`, `web/src/canvas/doc/question/`) — 017

An agent (Claude, Codex) asks a decision question through a bridge-hosted MCP tool instead of chat
text. The question becomes a `question` element on the one canvas document (shown only in the asking agent's window, see "Agent terminal host"; the canvas never draws a question or its option diagrams), the user selects an option and presses Send (or
types their own answer), and once every open question of that agent is settled, all its answers are typed into the asking agent's terminal as one next message; once they were really typed, the cards and their option diagrams are removed from the canvas (024, non-blocking). A run of questions sharing a
`session_id` is a grill session. Planning doc: `docs/planning/017-ai-questions-grill-session.md`.
Phases 1 (backend), 2 (canvas UI), 3 (agent wiring) and 4 (diagram options, 021) are implemented.

## Flow

```
agent ── MCP ask_user ──► bridge /mcp (bearer token names the workspace)
            QuestionMcp.ask: validate, then no attached window for the agent? refuse (NO_WINDOW, nothing written)
            store.open_question (apply_batch add_element) ──► `agent-questions` {id, open_questions} on every events socket
            ──► the agent window refetches GET /agents/{id}/questions ──► its QuestionCard
            returns at once {asked: true, question_id, next: "The question appears in the user's CodeChroma agent window..."}
            (agent says so in one line and ends its turn, LED idle + "?")
user click ─► POST /agents/{agent}/questions/{qid}/answer|skip (or /repos/{id}/...) ─► store.settle (meta, awaiting_delivery: true)
            ─► delivery.deliver_settled: live session for meta.agent_id? (no: stop, element kept)
            ─► store.claim_batch: batch complete (none open, some awaiting) and no wake-up queued? (no: stop)
                 claims the agent in memory (one queued wake-up per agent; a restart frees it)
            ─► AgentSession.inject_when_idle(builder, attempts=86400): once idle, store.pending_batch is re-read
                 a question open again (revise / new ask)? type nothing; else text, 0.3 s, Enter
            ─► typed? store.clear_batch: delete the questions still holding the typed answer + their decision diagrams
            ─► always (typed, not typed, or an error, which is logged): store.release_batch drops the claim
agent resumes with "[CodeChroma answer · Q1/3 · <qid>] <question> → <answer> [CodeChroma answer · Q2/3 · ...] ..." as its next user message
```

🔴 **No window, no question.** `ask_user` (and the `POST /questions/ask` hook route) checks the asking agent's attached windows after validation: `QuestionMcp(…, attached_windows=…)` (C# `attachedWindows:`) reads `AgentSessionRegistry.attached_windows(agent_id)` (C# `AgentSession.AttachedWindows`, the consumer count `attach`/`detach` keep; 0 without a session). At 0 it raises `QuestionRejected(NO_WINDOW)` (C# `QuestionMcp.NoWindowText`: "No CodeChroma window is showing this agent ... Ask in chat instead"), an MCP tool error or a 422, and writes nothing, so the agent asks in chat instead of waiting about 12 hours on a card nobody sees. A minimized window stays mounted, so it still counts. `attached_windows` is a required constructor argument (Python keeps it private as `_attached_windows`); tests pass their own (`QuestionTestKit.Host()` in C#, the `mcp` fixture in Python). Contract case `asking_without_an_attached_window_is_refused_and_writes_nothing`.

There is no broker and nothing waits: `ask_user` never blocks, so the agent is never "running" while a question is open (#281). `ask_user_result(question_id)` still reads an answer back from the element meta for clients without a terminal (only while the element exists, i.e. when no live session took the batch).

🔴 **Enter is a separate write.** Claude Code reads one PTY write of `text + "\r"` as a paste: the `\r` becomes a newline in the input box and nothing is submitted (reproduced against `claude` 2.1 with a ~170-character line; short lines happened to submit). This was why answers never woke the agent. `inject_when_idle` now writes the text, waits `context_inject_submit_delay_seconds` (C# `AgentSession.SubmitDelay`, 0.3 s), then writes `\r` (`AgentSession.TypeAndSubmit` in C#).

**Batch = every question of one agent.** A batch completes when no `question` element with that `meta.agent_id` in the workspace is `open`. At most one wake-up per agent is queued: `claim_batch` holds an in-memory claim per (canvas file, agent id), so a second settle while it waits adds nothing; the queued wake-up builds its text only when the agent idles (`pending_batch`), so a revise or a late answer is typed in its current form and a question asked meanwhile holds the whole batch back. 🔴 **Only a session that can look idle gets a wake-up.** `delivery.live_session` (C# `QuestionDelivery.LiveSession`) counts a session only when it is alive and its status rules are not empty (`AgentSession.detects_idle` / `DetectsIdle`), so delivery and the `waiting` flag skip a session: its `inject_when_idle` could never type and would hold the claim for about 12 hours. The card then stays and `ask_user_result` still reads the answer. An `agent` window is detected as its resolved CLI adapter (see `parallel-agents.md`), so Claude windows get `detect/claude.toml` (a stand-in binary behind the claude adapter keeps the never-idle `agent` rules); a missing `detect/agent.toml` used to strand every `agent` window's answers. `awaiting_delivery` stays `true` on disk until the question is deleted, so a crash, a restart or a failed cleanup never strands a batch: the claim is gone and the next settle of that agent sends it. The cards stay until the inject task reports the text was typed (`inject_when_idle` resolves `True`); only then does `clear_batch` delete them, and only those whose `state`/`answer`/`option_id` still match what was typed, so an agent that never idles or exits loses no answer (`ask_user_result` still reads them). Another agent's open questions neither block nor receive it. Settled questions without `awaiting_delivery` (stale re-ask duplicates, or answers settled before this change) are neither sent nor deleted.

## Backend

- `questions/models.py`: `QuestionOption` (`id, title, description, pro, con, rank, why, diagram_ref`),
  `AskRequest` (the `ask_user` input: `question, session_id, kind "choices"|"diagram", options,
  allow_custom=true, allow_skip=true, total, agent_id`), `QuestionResult`
  (`answer, option_id, skipped, pending, question_id`). `to_tool_dict()` returns
  `{answer, option_id, skipped}` or, when pending, `{pending: true, question_id}`.
- `questions/delivery.py`: `answer_message(element)` builds `[CodeChroma answer · Q{step}/{total} · {question_id}] {question} → {answer}` (one line, control characters collapsed; a skip reads "skipped by the user, decide yourself"; an answer after a revise, i.e. `meta.revised`, reads "changed answer: ..."), `batch_message(batch)` joins the batch's answer lines with spaces (one line, asked order), `diagram_request_message` the "Add diagram" line, `live_session(services, element)` finds the live `AgentSession` by `meta.agent_id`, `deliver_settled(services, ws, element)` (answer/skip) runs `store.claim_batch` and, in a held follow-up task, passes `inject_when_idle` a builder that reads `store.pending_batch` at idle time and returns `batch_message` (or None), then runs `store.clear_batch` once typed and always `store.release_batch`, logging any error, and `deliver(services, element, text=None)` (the "Add diagram" request, sent at once) calls `session.inject_when_idle(text, attempts=settings.questions.answer_inject_attempts)` (86400 attempts, about 12 hours: effectively until the agent goes idle or exits; injections into one session are serialized and each is followed by one poll interval, so two quick answers never interleave; launch context keeps its own default). A reask clears `meta.revised`, so only the first answer after a revise reads "changed answer" and returns whether a live session received it. The old `QuestionBroker` and `BridgeServices.questions` are gone.
- `questions/store.py`: reads/writes `question` elements only through `apply_batch` under
  `canvas_lock`, committed by `routes/_canvas_write.commit_canvas_batch` (a lazy proxy; importing it
  at module load cycles through `bridge.routes`). `open_question` (layer `questions`, label = the
  question text, explanation "ai question"), `find_element`, `list_questions`, `settle` (also sets
  `meta.awaiting_delivery = true`), `claim_batch(ws, agent_id)`, `pending_batch(ws, agent_id)`,
  `release_batch(ws, agent_id)` and `clear_batch(ws, batch)` (see Flow; the last deletes the batch's questions that still hold the typed answer, every element on their `decisions/<qid>` layers and the `diagram_ref` roots the same agent drew
  plus their group members on a `decisions` or `decisions/*` layer, through `apply_batch_chunked`
  with the mass-delete guard confirmed; edges go by cascade), `result_from`, `reopen` (sets
  `meta.revised = true`), `request_diagram`, `draw_diagram`.
- `questions/mcp_server.py` `QuestionMcp`: one MCP server (`MCPServer`, name `codechroma`) mounted at
  `MOUNT_PATH = "/mcp"` in `create_app` before the SPA catch-all, served through a `_Delegate` ASGI
  shim (503 while not running). Its session manager runs inside the bridge `lifespan`
  (`async with app.state.question_mcp.running()`); a fresh `streamable_http_app` is built per run.
  Tools: `ask_user(question, options, kind, session_id, allow_custom, allow_skip, total)` (returns `{asked: true, question_id, next}` at once, `next` = `NEXT_STEP` / C# `NextText`: the question is in the user's CodeChroma agent window above this terminal, say so in one line and end the turn — one `WINDOW_NOTE` / C# `WindowNote` sentence shared with the instructions and the tool description; refused with `NO_WINDOW` when no window shows the agent; `agent_id` is not a tool argument; its description, `_ASK_DESCRIPTION` / C# `AskDescription`, says the same), `ask_user_result(question_id)` (settled answer from the element, else `{pending: true, question_id}`) and `draw_option_diagram`.
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
| `GET /repos/{id}/questions` | `{questions: [...]}` of open ones; each row is `{element_id, question, waiting, ...element.meta}`. `waiting` is true when a live agent session (by `meta.agent_id`) that can look idle will receive the answer; false when the agent window is gone, was never an agent window, or can never look idle. |
| `POST .../{qid}/answer` body `{answer?, option_id?}` | With `option_id`: must match an option (422 otherwise), answer defaults to its title. Without: refused 422 if `allow_custom` is false. Empty answer 422. Settles meta, then `delivery.deliver_settled` wakes the agent if this was its last open question (ack `waiting` = a live session will receive the answers, now or when the batch completes). |
| `POST .../{qid}/skip` | 422 if `allow_skip` is false. Settles as skipped; the batch line then reads "skipped by the user, decide yourself" for it. |
| `POST .../{qid}/revise` | Works on a settled question (no 409 check): reopens it (`state open`, answer and option_id cleared), deletes later-step questions of the same `session_id`, sets `meta.revised = true`. Returns the ack plus `removed: [element ids]`. |
| `GET /agents/{agent}/questions` | The agent window's source. 404 `unknown agent: <id>` for an agent the manager does not know. `{agent_id, workspace, open_questions, elements, edges}`: a small canvas doc holding the agent's open questions, the agent's own settled questions of their `session_id`s (the card's "Earlier" history; a neighbour's settled card with the same `session_id` in a shared workspace is left out, contract case `a_neighbours_settled_question_in_the_same_session_stays_out_of_an_agents_history`) and each open question's option-diagram subgraph (root, group members and arrow targets, walked like `QuestionDiagram.diagramSubgraph`, max 40) plus the arrows inside it. `workspace` is the id the agent's ask_user writes to: `WorkspaceRegistry.Resolve` / `resolve` (the alias an "Add agent here" agent shares, else its own id, main for an unregistered id), the same mapping the MCP token write goes through. The canvas file is read from disk; the workspace is never brought up. |
| `POST /agents/{agent}/questions/{qid}/answer\|skip\|revise\|request-diagram` | The repo routes' behaviour, acks and refusals on the workspace the agent asks into, limited to that agent's questions: another agent's question (even in a shared workspace) is 404 `unknown question`; an unknown agent is 404 `unknown agent: <id>`. Delivery is unchanged (`deliver_settled` / `DeliverSettled`). |

Unknown question id: 404. Answer/skip on an already-settled question: 409. Ack shape:
`{ok, question_id, state, waiting[, answer]}`.

**Push.** Every question change of an agent broadcasts `{type: "agent-questions", id, open_questions}` to every events socket (global, like `agent-status`): ask and re-ask (`QuestionMcp` `questions_changed` / `questionsChanged`), `draw_option_diagram` with a `question_id`, answer, skip, revise, a first "Add diagram" (both route families) and a typed batch's cleanup (`deliver_settled`'s follow-up / `DeliverSettled(..., cleared)`). Senders: C# `Questions/AgentQuestions.cs` `AgentQuestionEvents.Changed`, Python `questions/agent_view.py` `announce`; both count from the canvas file and never throw. `GET /agents` rows carry the same `open_questions`. A canvas `PATCH` that deletes a question sends nothing (the canvas never draws questions).

Revise only changes canvas state and delivers nothing (ack `waiting: false`); because `meta.revised` is set, the next answer to the reopened question is typed into the agent as "changed answer: ...". With a live agent, a question can only be revised while its batch is still open (another question of that agent unanswered): a completed batch is deleted, so "Change" and the "Earlier: …" history no longer reach delivered questions.

## Element shape

`render: "question"`, `layer: "questions"` (`"question"` is in `RENDER_KINDS` in
`canvas/document.py`; `questions` is a non-diagram layer in `diagramCatalog.ts` `NON_DIAGRAM_LAYERS`).
`meta`: `question_id` (uuid hex), `session_id`, `step` (1-based, = count of elements already in that
session + the session's questions earlier completed batches removed + 1, 1 without a session; the removed
count is an in-memory tally per canvas file and `session_id`, `store._delivered` / C# `QuestionStore.Delivered`,
so it resets on a bridge restart; it keeps the 512 most recent sessions), `total`, `kind`, `state` (`open|answered|skipped`), `answer`,
`option_id`, `allow_custom`, `allow_skip`, `agent_id`, `options[]` (the `QuestionOption` dicts). The
options live in `meta`, not as child elements (the planning doc's "options are children" is not
implemented; the diagram options kept this shape: `option.diagram_ref` points at a diagram root).

## Web (`web/src/canvas/doc/question/`)

- `questionAdapter.ts`: the one place mapping wire `meta`/payloads to the view model
  (`QuestionView`, `toQuestionView`, `sessionHistory`, `QuestionAck`, `OpenQuestionsPayload`,
  `QuestionAnswerBody`). Adjust here if backend field names change.
- `questionClient.ts` (`answerOption`, `answerCustom`, `skipQuestion`, `reviseQuestion` over
  `EngineClient`), `questionStrings.ts` (all labels; i18n strings, not hardcoded),
  `QuestionCard.tsx`, `QuestionOptions.tsx`, `ConnectedQuestionCard.tsx` (the card wired to
  the bridge; used by the agent terminal).
- **Soft-tiles card (020).** One `QuestionCard` with `variant: "compact" | "full"` (`full` in B1).
  A click or `1`-`9`/arrows only *selects* an option (`role="radiogroup"`/`radio`); **Send** or Enter confirms,
  and the rank-1 option starts selected. Rank shows only as a soft-green "Recommended" pill (the `why` text is
  its tooltip); there are no rank borders. Colours are `--question-*` tokens on `:root` in `styles.css`. The
  card handles its own keys (`onKeyDown` on the card, no global listeners): Esc skips when `allowSkip`,
  Shift+Tab / Ctrl+Enter / after an answer call `onReturnFocus` (the terminal's `focus()`). An answered card
  collapses to one line ("✓ Q2 · title · answer · Change"); "Earlier: … · Change" opens `DecisionHistory`.

### Agent terminal host (020)

`web/src/agents/AgentQuestionHost.tsx` wraps the xterm element in `AgentTerminal` (so the docked panel, floating
windows, `ActivityPanel` and the tutorial mock all get it). 🔴 **The bridge, not the web, maps the agent to its workspace.**
An agent asks into the workspace its MCP token names (its id, an alias of `shares_workspace_with` for an "Add agent here"
agent), so the active tab's `canvasDocStore` is the wrong source whenever that tab differs. `agents/agentQuestions.ts`:
`agentQuestionStore.watch(agentClient, agentId)` (held by `useAgentQuestions(agentId)` while a window is mounted, shared
by every window of that agent) loads `GET /agents/{id}/questions` once, and `refresh(id)` refetches (at most one request in
flight; a refresh meanwhile becomes one more). `AgentWindowLayer` refreshes the agent and calls `agentStore.setOpenQuestions`
on each `agent-questions` event; each write refreshes too. `agentQuestionActions(agentClient, agentId)` binds answer/skip/
revise/"Add diagram" to the agent routes (`AgentClient.questions`, `answerQuestion`, `skipQuestion`, `reviseQuestion`,
`requestQuestionDiagram`, optional so test stubs need none). The host passes the payload (a small CanvasDoc) to
`useOpenAgentQuestions(agentId, doc)` and `QuestionDiagram`, and `{client: actions, doc}` to `ConnectedQuestionCard`
(`client` is a `QuestionActions`, the four writes; an `EngineClient` still fits it). There are no per-workspace engine
clients, sockets or canvas docs and no fallback to the active doc. Badges read `agent.open_questions` (see
`parallel-agents.md` "Question counts"). Mock bridge: `MockAgentClient` serves the same routes from its own
`questionEngine` (a `MockBridgeEngineClient`) through `agentQuestionsFromDoc`, the web mirror of the bridge rule; the
opt-in `devAskQuestion.ts` preview (installed by `AgentWindowLayer` for a `MockAgentClient`) asks there. `useOpenAgentQuestions` filters open `question`
elements by `meta.agent_id` and sorts by `meta.step`; the host shows only the first (oldest). It measures its own
width (ResizeObserver) and `pickQuestionLayout({width, full, hasDiagram})` picks: **B1** (agents panel full mode and
width >= 1100: full-width question + diagram, up to 65% of the host), **A4** (width >= 880 and some option has a
`diagram_ref`: 420px diagram pane left of the compact card) or **A2** (compact card). In every layout the question sits on
top and the terminal spans the full width under it. In A2 the card row is `fit-content(55%)` of the host and the card scrolls inside it (`overflow-y: auto`); the terminal row's floor is `min(120px, 45%)` so a short host never starves the card. `hasDiagram` is "any option has one" (not just the selected one) so the pane does not flicker, and an option
without a diagram shows "No diagram for this option". The terminal div keeps one tree position across layouts, so a
switch never remounts xterm. A new question does not steal focus; Ctrl+Enter in the terminal focuses the card.
`QuestionDiagram.tsx` renders `diagram_ref` and its children (group members + arrow targets, max 40) as a
read-only scaled view with option tabs, drag-to-pan, wheel/button zoom and a full-screen overlay (Esc closes); the fit scale is floored at 0.6 so labels stay readable (a larger diagram is panned, not shrunk), nodes show label + description and arrows connect node boundaries so their heads remain visible, and show labels; it is a light renderer, not
`CanvasNodeBox`, which is interactive. Attention: `AgentLed` takes `agentId` and turns accent-coloured with a "?" badge
while that agent has an open question (the panel's agent rows show it as the amber `blocked` background tint instead, see `parallel-agents.md` "Row tint", so they never read as a plain `--bg-raised` question card), and the Agents tab shows a "N questions" pill (`useOpenQuestionCount`).
The highlighted option is owned by the host (`resolveSelection` in `questionAdapter.ts` falls back to the recommended option when the pick no longer exists, e.g. after a re-ask) and passed to `QuestionCard` as the controlled `selectedId`, so the diagram tabs and Send always agree; `QuestionCard` owns it only when used standalone. `devAskQuestion.ts` (mock bridge, opt-in via `VITE_DEV_ASK_QUESTION=1`, dynamically imported by `AgentWindowLayer`) asks a demo question on the mock agent client's question canvas when Enter is pressed in an agent terminal.
- `elementRules.ts`: `BLOCK_RULES.question` = `{renderer: "question", activation: "inspector",
  lockedLayout: true}` (never dragged or auto-laid-out); excluded from `StyledRenderKind`.
- `CanvasDocView.tsx`: `case "question"` renders nothing; question elements are excluded
  from `memberIdsByLayer` so they get no diagram frame.
- **The canvas never draws questions.** `displayPipeline.ts` `hideQuestions` (first of
  `STRUCTURAL_STAGES`) drops every `question` element and every option-diagram element (plain `decisions` or `decisions/<qid>` layer, `isDecisionLayer`)
  from rendering, canvas bounds, frames and edges, whatever its agent; the elements stay in the document
  (the bridges still write them, and `GET /agents/{id}/questions` serves them to `AgentQuestionHost`). `listActiveDiagramLayers` leaves
  `decisions/` layers out of the Diagrams tab. A question whose agent is stopped or gone is no longer
  answerable from the canvas; the bridges still remove the cards once a batch is delivered. Test:
  `displayPipeline.test.ts`, `CanvasDocView.test.tsx`, `diagramCatalog.test.ts`; the answer/skip/revise
  flow is covered on `ConnectedQuestionCard` in `questionFlow.test.tsx`.
- `EngineClient`: `getOpenQuestions`, `answerQuestion`, `skipQuestion`, `reviseQuestion` (HTTP,
  delegating, stub and `mockBridge.ts`, where the mock mutates element meta instead of using a broker): the repo routes,
  not used by the agent window.

## Tests

Python: `tests/unit/test_bridge_questions_route.py` (element meta, session steps, GET/answer/skip/revise,
refusals, answer/skip/request-diagram delivery into a fake live session, one wake-up per completed batch of one agent (none while another of its questions is open, never into another agent), no question or option diagram left after completion, step numbering kept across a cleared batch, non-blocking ask, `ask_user_result` read-back from the element, token
forgery). Web (vitest): `QuestionCard.test.tsx`, `QuestionOptions.test.tsx`,
`questionAdapter.test.ts`, `questionFlow.test.tsx`, `pickQuestionLayout.test.ts`, `QuestionDiagram.test.tsx`,
`web/src/agents/AgentQuestionHost.test.tsx` (over `MockAgentClient`, incl. the card disappearing once the batch is deleted and the agent refetched), `web/src/agents/agentQuestions.test.tsx` (`br_wt-1` active: the card loads and Send posts through the agent routes, never the active engine client; one watch per agent; the mock mirror), `AgentWindowLayer.test.tsx` (an `agent-questions` ping sets the count and refetches), `AgentLed.test.tsx` (the "?" label from `open_questions`, kept across a payload without it), plus the `question` case in `elementRules.test.ts`.
Agent-scoped routes and push: C# `Questions/AgentQuestionRoutesTests.cs` (shape over a shared tab workspace, history, option diagram, a neighbour's question left out; unknown agent 404 on all five; writes by agent id and a neighbour's 404; `open_questions` on `GET /agents`; `agent-questions` after an answer and an MCP ask), Python `tests/unit/test_agent_questions_route.py` (same, plus `announce` never raising), contract cases `an_agent_reads_its_questions_from_the_workspace_it_shares`, `an_agent_answers_by_its_own_id_and_every_canvas_hears_the_new_count`, `an_unknown_agent_has_no_questions_to_read_or_answer`.
No-window refusal: `test_bridge_questions_route.py` (`test_ask_without_an_attached_window_is_refused_and_writes_nothing`, `test_ask_proceeds_only_for_an_agent_an_attached_window_shows`), `test_agent_sessions.py` (attach/detach count), C# `QuestionRoutesTests` (same two) and `WidenResumeTests.Attached_windows_counts_each_attach_until_its_detach`. Question tests that ask as `main` give the mcp one window (`QuestionTestKit.Host()`, Python `_mcp(bridge)`).
Not yet written: the Playwright journey (ask in the docked panel, answer in the terminal, resize across the layout thresholds).

## Gotchas

- 🔴 The MCP session manager only runs inside the bridge lifespan; a test app without lifespan gets a
  503 from `/mcp`. A session manager runs once, hence a fresh app per `running()`.
- Delivery is best effort: with no live session (window closed, bridge restarted) the answer stays on the element meta (nothing is removed, `awaiting_delivery` stays true), `ask_user_result` returns it, and `GET /questions` reports `waiting: false`. The cards are cleared only by a later completed batch of the same agent id with a live session.
- After delivery the elements are gone, so `ask_user_result` for a delivered question returns `{pending: true}`; the typed message is the agent's only record.
- Answers are typed into the PTY, so `delivery._one_line` strips control characters; keep that when changing the message text (the C# `QuestionDelivery.OneLine` mirrors it).
- `commit_canvas_batch` is imported lazily in `store.py` (import cycle with `bridge.routes`).
- Answers are plain text, never executed; the endpoint relies on the loopback bridge plus the token.

## Question contract and option diagrams (021)

The `ask_user` server, not a skill, enforces the question format, so it holds for any CLI that gets the MCP config.

- **Contract** (`questions/validation.py`). `validate_ask` returns one line per problem: non-empty question; 2-4 options with unique ids, each with non-empty `title`, `description`, `pro`, `con`, `why`; exactly one `rank: 1`, ranks unique; `kind: "diagram"` needs a `diagram_ref` on at least one option. `QuestionMcp._check` also rejects a `diagram_ref` that names no option diagram of the asking agent, i.e. no element on a `decisions` or `decisions/*` layer that this agent drew (`store.option_diagram_ids(ws, agent_id)`, C# `QuestionStore.OptionDiagramIds(ws, agentId)`; ownership is `store._diagram_owners` / `DiagramOwners` (layers mapped once per doc): the diagram root's `meta.agent_id`, which `draw_option_diagram` stamps with the MCP token's agent id, else the `agent_id` of the question whose `decisions/<qid>` layer it is on). ⚠ Agents sharing a workspace never take, adopt (`_adopt_ops`) or clean up (`_cleanup_ops`) each other's option diagrams, and `draw_option_diagram` with a `question_id` of another agent's question is `unknown question`. Problem line "... is not an option diagram; draw it with draw_option_diagram ..."). 🔴 A question never takes a canvas diagram: before this, an agent could draw a diagram on a canvas layer (PATCH `/canvas`, a skill) and pass its id as `diagram_ref`, so the question's diagram showed on the main canvas (contract case `a_question_cannot_take_a_canvas_diagram_as_an_option_diagram`). A break raises `QuestionRejected`, which the MCP SDK returns as an `isError` tool result (header "CodeChroma rejected the question.", one bullet per problem, a fixed "Call ask_user again..." footer). `POST /repos/{id}/questions/ask` maps it to 422. No question element is created. Old stored questions render as before; validation runs only on new calls.
- **Retry limit.** `RejectionTracker` (`QuestionMcp.rejections`, in memory) counts rejections per (workspace id, `session_id`; when omitted, the MCP connection's `mcp-session-id`, and a call with neither is never tracked so agents never share a counter) and forgets after 10 minutes of silence, a valid question, or a degraded pass-through (the count is consumed, so the next bad call is rejected again); stale entries are evicted and the map is capped at 1000. Below `settings.questions.max_rejections` (3) the call is rejected; at the limit it is accepted with `meta.degraded = true` and `meta.validation` (the last rejection text); the only change is that a `diagram_ref` naming no option diagram of this agent is dropped (`_drop_foreign_refs` / `DropForeignRefs`), so a degraded card never pulls ordinary canvas elements into its diagram pane. `degraded` is server-side only: `POST /repos/{id}/questions/ask` ignores a caller-sent `"degraded": true` in both bridges (contract case `a_caller_sent_degraded_flag_does_not_skip_validation_on_the_hook_route`). The card shows no error, only fewer parts.
- **Tool description.** `_INSTRUCTIONS` in `mcp_server.py` carries the whole contract, when to use `kind: "diagram"`, and the `needs`/`pending` results, so it reaches the agent without any project skill.
- **`draw_option_diagram` tool** (`questions/diagrams.py`, `store.draw_diagram`). Args `title`, `nodes [{id, label, description?, status?}]`, `edges [{from, to, label?}]`, optional `question_id` + `option_id`. At most 12 nodes (`MAX_NODES`), unique ids, non-empty title/labels, length caps (title 80, id 40, label 60, description 300), edges between known nodes with no self-loops or duplicates, else `QuestionRejected`; `check_decision_diagram.py` applies the same rules and `test_question_validation.py` pins parity between the two (the NON_DIAGRAM_LAYERS mirror is pinned by `test_non_diagram_layers_parity.py`). It writes a `group` root plus `custom` member elements and edges on the per-question layer `decisions/<question_id>`, or on a `decisions/draft-<hex>` layer when drawn before the question exists (`store._adopt_ops` moves the diagrams an `ask_user` option references onto `decisions/<qid>` when the question opens). Positions are element centres (what `elementRect.ts` reads) and the root group is sized to wrap its members; a new diagram is placed below the lowest existing `decisions/*` element (`store._next_top`), so dragged diagrams never overlap. `status: "new"` in `meta` marks parts that do not exist yet; when more than half the nodes lack a `description` the result carries a `warning`. `decisions/*` layers are shown only in the question UI (`QuestionDiagram`), never on the canvas or in the Diagrams tab, and the client offers no way to move one onto the canvas; on disk they are canvas-only: `document.py` `is_canvas_only_layer` keeps them out of the projection path, so deleting one removes canvas content only (the option's `diagram_ref` then dangles and the card shows "No diagram"; "Add diagram" is allowed again). The plain `decisions` layer stays non-diagram for old elements. Returns `{diagram_ref: <root id>}`; with `question_id`/`option_id` the ref is also written onto that option. Skill: `skills/codechroma-decision-diagram` (a quality guide on top of the tool, `scripts/check_decision_diagram.py` as the draft checker), listed in `SKILL_NAMES` and `SkillSync.cs`.
- **"Add diagram" button.** `POST .../{qid}/request-diagram` (422 when every option has a diagram) sets `meta.diagram_requested`, `diagram_requested_at`, `diagram_requests` (counted once: repeat clicks only re-send the line) and types a request line (`delivery.diagram_request_message`: draw the diagrams, then call `ask_user` again with the same `session_id` and question) into the agent's terminal, so the button also reaches the agent (the response's `waiting` is true when a live session received it). The agent draws diagrams and calls `ask_user` again: `store.find_diagram_requested` finds the open diagram-requested element (same `session_id`, or with no session the same text on a session-less card; there is no sole-card fallback, so an unrelated ask opens its own card) and `store.reask` updates it in place (same id; label, options, session/total replaced, `degraded`/`validation` rewritten, `diagram_requested` cleared) and skips older same-session duplicates in the same commit. The card (`QuestionCard` `onRequestDiagram`, `EngineClient.requestQuestionDiagram`, mock bridge parity) shows "Add diagram" while an option lacks a ref and fewer than 2 requests were made, and a disabled "Diagram requested" while waiting.
- **"Chat about it" button.** `QuestionCard` `onChat` (set by `ConnectedQuestionCard` when an `AgentClientProvider` exists and the element has `meta.agent_id`, exposed as `QuestionView.agentId`) switches the activity panel to full screen on the asking agent (`layoutStore.setAgentsMode("full")` then `restoreAgentWindow`, which also selects the agent), so the user can talk to it in the terminal. It sends nothing and leaves the question open.
- **Native `AskUserQuestion`.** `hooks/ask_user_question_hook.py` denies the call, naming `mcp__codechroma__ask_user` and its fields, only when `CODECHROMA_QUESTION_TOKEN`, `CODECHROMA_BRIDGE_URL` and `CODECHROMA_WORKSPACE_ID` are all set (the launcher injects it together with `--mcp-config`, so the agent has the `codechroma` server) and `GET {bridge}/mcp/` answers within 0.5 s (any HTTP status). Otherwise it prints nothing and Claude's native dialog appears; there is no reroute to the canvas any more. `AskRequest.degraded` is never read from a caller: the HTTP ask route resets it, and the hook no longer sends it.
- 🔴 Not covered: questions typed as terminal text (not detected). The C# bridge hosts `/mcp/` and the `AskUserQuestion` hook too (see "C# bridge port" below). Codex gets only the server contract and its tool-error handling is unverified.
- Tests: `tests/unit/test_question_validation.py`, `test_bridge_questions_route.py` (request-diagram), `test_question_agent_wiring.py` (hook), `QuestionCard.test.tsx`.

## C# hook

`Questions/AskUserQuestionHook.cs` is the C# twin of `hooks/ask_user_question_hook.py`: the bridge binary run as `codechroma-bridge ask-user-question` (dispatched in `Program.cs` before the web host boots) reads the same `CODECHROMA_BRIDGE_URL`/`CODECHROMA_QUESTION_TOKEN`/`CODECHROMA_WORKSPACE_ID` env (lower-case legacy spelling accepted), probes `{bridge}/mcp/` for 0.5 s (any HTTP status counts) and prints the same deny decision; any error exits 0 silently. `AgentSessionOwnership.HookSettings(sessionTracking, askUserQuestion, statusHooks)` builds the `--settings` JSON, and `TerminalAgents.OwnedLaunch` passes it whenever the window has session tracking, an MCP endpoint or a bridge URL for the status hooks (bare windows included; the `PreToolUse` list keeps the `AskUserQuestion` entry first, then the `*` status hook, see [parallel-agents.md](parallel-agents.md#status-hooks-done-and-error-both-bridges)); with an MCP endpoint it also carries the tool permissions, even when no bridge executable resolves for the hooks. Tests: `AskUserQuestionHookTests`, `TerminalAgentsBareTests`.

## Agent wiring (phase 3)

- **MCP registration.** Each CLI adapter registers the server its own way: C# `ICliAdapter.Mcp(endpoint, workdir)` (`Skills/CliAdapters.cs`, called from `TerminalAgents.McpFor`), Python `CliAdapter.mcp_registration` (`llm/cli_adapters.py`, called from `terminal/agents.py` `_mcp_registration`). The caller merges `McpEndpoint.env()` into what the adapter returns; `McpEndpoint.server_document`/`ServerDocument` builds the shared header + timeout shape. `agent_cli(..., mcp=, workdir=)` / `TerminalAgents.Resolve(..., workdir:)` get the window's worktree.

  | CLI | Registration | Token |
  |---|---|---|
  | claude | `--mcp-config <file>` | in the 0600 file |
  | codex | `-c mcp_servers.codechroma.url=<base>/mcp/` + `-c mcp_servers.codechroma.bearer_token_env_var=CODECHROMA_QUESTION_TOKEN` (`codex mcp get` resolves it as `streamable_http`, codex-cli 0.144.1) | env only, never argv |
  | gemini | `GEMINI_CLI_SYSTEM_SETTINGS_PATH` → private 0600 settings file with `mcpServers.codechroma.httpUrl` + `headers` | in the file |
  | kimi | merges `{transport: http, url, bearerTokenEnvVar}` into `<worktree>/.kimi-code/mcp.json` (no per-run flag exists), keeps the user's other servers; the file is in the skill exclude patterns, so git never shows it; a git-tracked file (an exclude cannot hide edits to it, so the agent would commit the bridge URL), an unreadable file or an unwritable path is left alone and the window gets no server. Keys verified against kimi's own MCP schema (`transport: "http"`, `url`, `bearerTokenEnvVar`) | env only |

  ⚠ Gemini's env var replaces any admin system settings file for that process. A plain `claude` kind with a non-default binary still gets nothing. The Claude config (`questions/launch.py`, `McpEndpoint.claude_config()`) is `{type: http, url: <base>/mcp/, headers: {Authorization: Bearer <token>}, timeout: 60_000} (60 s on both bridges, since `ask_user` returns at once)`, written to `<tempdir>/codechroma-mcp-XXXX/<agent id>.json` (a file, because inline JSON is mangled by PTY quoting on Windows). The directory is a per-process `mkdtemp` (0700), never a fixed shared path another local user could pre-create or symlink (`launch.py` `_private_config_dir`, reused while it exists; the file is chmod 0600). 🔴 `--mcp-config` is variadic, so it must precede `--plugin-dir` and the positional initial prompt.
- **Tool permissions.** A claude window with the server registered also gets `--settings` with `permissions.allow` = `mcp__codechroma`, claude's rule for every tool of that server, so a new tool needs no list update (`McpEndpoint.ClaudePermission`; Python `CLAUDE_PERMISSION`, `terminal/agents.py` `_settings_args`). Without it claude asked "Do you want to proceed?" on every call, and "don't ask again" lasted one worktree only, since each agent runs in its own. The flag is per launch, so a new, resumed or auto-started window picks it up at once; nothing is written to the user's settings. Only this server's tools are approved, so none of them may edit files or run commands (a comment on `QuestionMcp.Tools()` / `QuestionMcp.__init__` says so; `QuestionRoutesTests` pins the tool list).
- **Port and token.** The terminal router shares the graph bridge's process and port. The workspace id is the agent id, and `QuestionMcp.ask` stamps it server-side as `meta.agent_id` (overriding any caller value; the canvas selects terminal questions by it); the token is `QuestionMcp.token_for(agent_id)`. The base URL comes from `CODECHROMA_BRIDGE_URL`, else uvicorn's `--port` in `sys.argv` (boot-time auto-start), else the `/agents/{id}/start` request's base URL rewritten to 127.0.0.1. With none of these nothing is injected and argv is unchanged. The agent env also gets `CODECHROMA_BRIDGE_URL` and `CODECHROMA_QUESTION_TOKEN`.
- **Skill.** `skills/codechroma-grill/SKILL.md` (listed in `SKILL_NAMES`, so synced into opened repos) tells the agent to ask via `ask_user`, one question at a time, 2-4 options with description/pro/con/rank/why (rank 1 recommended), and, after `ask_user` returns `{asked: true}`, to end the turn (never poll, never repeat the question in chat); once every open question is settled, all answers arrive as the next message, one `[CodeChroma answer ...]` part per question. The MCP `_INSTRUCTIONS` (C# `QuestionMcp.Instructions`, pinned by `tests/fixtures/bridge_contract/mcp_instructions.txt`) say the same.
- **AskUserQuestion hook** (021 changed it to deny first, see above). `hooks/hooks.json` (plugin root, so no edit to user settings) matches `AskUserQuestion` with `timeout: 15` (the hook only does a 0.5 s probe) and `onFailure: "block"`; `ask_user_question_hook.py` (stdlib only) denies the native tool toward `ask_user` (see above) and fails open (prints nothing, exit 0) when the env vars are absent, the bridge is unreachable, or any error occurs.
- **Other CLIs' skills.** The grill and decision-diagram skills reach Codex, Gemini and Kimi through `.agents/skills/` (see `diagram-skills.md`).
- **Verified:** real uvicorn + `mcp` client: the bearer header reaches `ctx.headers`, `ask_user` blocks until answered over REST, a forged token errors, and the hook script runs end to end. Codex (0.144) and Kimi (kimi-code 0.23) option names and file schemas were checked against the installed CLIs' help and bundled schema; Gemini's were not (not installed). **Not verified in a real CLI process:** the codex/gemini/kimi windows actually calling `ask_user`; **in a real `claude` process:** plugin-dir `hooks/hooks.json` loading, the `AskUserQuestion` matcher, `onFailure`, `updatedInput.answers` auto-answering, per-server `timeout`, and the frozen-bundle `hooks` layout.
- Tests: `tests/unit/test_question_agent_wiring.py`, `QuestionAgentWiringTests`.

- **`store.draw_diagram`** draws the diagram and attaches `diagram_ref` in one atomic commit (nothing is drawn if the option is unknown); placement is `_next_top` (below the question's own layer, else below every `decisions/*` element), so deleting a diagram never causes overlap. Draft diagrams are stamped `meta.drawn_at`; each ask/reask prunes unadopted drafts older than `DRAFT_TTL_SECONDS` (1 h) so abandoned asks leave no layer.

## C# bridge port (`dotnet/CodeChroma.Bridge`)

The shipped desktop app runs the C# bridge, so the feature is ported there with the same non-blocking flow (no new NuGet packages; plain JSON-RPC over `POST`, modelled on `Workflows/WorkflowRunner.Steer.cs` `HandleMcp`). There is no broker in C# either.

File map (`Questions/`):
- `QuestionModels.cs` (`AskRequest`, `QuestionOption`, `QuestionResult`, strict `ArgReader`), `QuestionValidation.cs` (the contract, `RejectionText`, `RejectionTracker`), `QuestionDiagrams.cs` (`draw_option_diagram` budget, centre positions, `LayerFor`/`DraftPrefix`, canvas ops), `QuestionStore.cs` (all `question` element reads/writes through `ApplyBatch.Apply` + `CanvasWrite.Commit` under `CanvasWrite.LockFor`; adopts draft layers; `Reopen` sets `revised`; `Settle` sets `awaiting_delivery`; `ClaimBatch`/`PendingBatch`/`ClearBatch`/`ReleaseBatch` mirror `claim_batch`/`pending_batch`/`clear_batch`/`release_batch`; the delete goes through `ApplyBatch.ApplyChunked`).
- `QuestionDelivery.cs`: `AnswerMessage`/`BatchMessage`/`DiagramRequestMessage` (same text as `delivery.py`), `DeliverSettled` (answer/skip: `QuestionStore.ClaimBatch`, one `InjectWhenIdle(Func<string?>)` whose builder reads `PendingBatch` at idle time, then `ClearBatch` when its `Task<bool>` reports typed, and always `ReleaseBatch`; errors go to stderr) and `Deliver` (the "Add diagram" request), which find the live `AgentSession` by `meta.agent_id` and call `InjectWhenIdle(text, IdleAttempts = 86400)`; overloads take an injector delegate for tests.
- `QuestionMcp.cs` (HMAC token, `Ask`/`Result`/`DrawDiagram`, `HandleMcp`), `McpEndpoint.cs` (URL, env, `--mcp-config` file), `AskUserQuestionHook.cs` (see "C# hook").
- `Questions/AgentQuestions.cs`: `AgentQuestionView.Read`/`OpenCount` (the agent-scoped read over `WorkspaceRegistry.Resolve`, canvas read under the canvas lock without bringing the workspace up) and the `AgentQuestionEvents` singleton (`agent-questions` broadcast); Python twin `questions/agent_view.py`.
- `Routes/QuestionRoutes.cs`: `GET /agents/{id}/questions` and `POST /agents/{id}/questions/{qid}/answer|skip|revise|request-diagram` (handlers shared with the repo routes, scoped to the agent's own questions), `GET /repos/{id}/questions` (`waiting` = live session), `POST .../questions/ask` (bearer, 401/422), `.../{qid}/answer|skip|request-diagram|revise` (404 unknown, 409 settled, 422 refusals, same ack shape as Python; answer/skip wake the session once the batch completes, request-diagram types at once), and `POST /mcp/` (bearer = `workspace_id.hmac-sha256`, per-process random secret, constant-time compare; 401 on a forged or missing token). `GET`/`DELETE /mcp/` return 405 (the hook's 0.5 s probe accepts any status). Tools `ask_user`, `ask_user_result`, `draw_option_diagram`; results carry `structuredContent`. `initialize` issues an `Mcp-Session-Id`, which only keys the retry counter of a sessionless agent (the server stays stateless).
- Retry budget `MaxRejections` (3); the MCP config timeout is 60 s (`McpEndpoint`), as `ask_user` returns at once.
- Consistency: `Ask` selects a diagram-requested card and commits its options under one canvas lock, shared with answer/skip/revise. `ask_user_result` verifies the question exists in the authenticated workspace under that lock; foreign or unknown ids return pending. Regression tests: `QuestionConcurrencyTests`, `QuestionResultScopeTests`.
- 🔴 `CanvasDoc.RenderKinds` gained `question`, `NonDiagramLayers` gained `questions` and `decisions`, plus the `decisions/` canvas-only prefix rule (kept in step with `document.py`); without that the elements are rejected or written as a projection folder. Canvas op numbers must be JSON doubles (`ApplyBatch` reads positions with `TryGetValue<double>`, which fails on an int node).
- Wiring: `Terminal/TerminalAgents.cs` `Resolve(..., agentId, bridgeUrl)` adds `--mcp-config <tempdir>/codechroma-mcp-XXXX/<agent id>.json` (a per-process `Directory.CreateTempSubdirectory`, 0700) for Claude windows only, before `--plugin-dir` and the positional prompt (the flag is variadic), and returns env `CODECHROMA_QUESTION_TOKEN`, `CODECHROMA_BRIDGE_URL`, `CODECHROMA_WORKSPACE_ID`. Nothing is injected without an agent id or a known bridge URL (`BareSkill.BridgeUrl`), for non-Claude CLIs, shells, or bare windows. Resumed windows get a fresh config, since the token changes per bridge process.
- Gaps (also in `docs/planning/012-csharp-bridge.md`): Codex is not wired; the hook still needs Python on PATH for the Python plugin `hooks/hooks.json` copy (the C# bridge binary is its own hook); the Avalonia canvas (`CodeChroma.Canvas`) has no `question` render kind (its `SceneGraph` skips `questions` and `decisions*` elements via `DiagramCatalog.IsAgentWindowOnly`, and `ListActiveDiagramLayers` leaves option-diagram layers out); `check_decision_diagram.py` parity with `QuestionDiagrams.Validate` is by matching rules, not a cross-language test; not verified against a real `claude` process. Shared contract cases: `tests/fixtures/bridge_contract/questions.cases.json` (Python `test_bridge_wire_contract.py`, C# `WireContractTests`).
- Tests (`dotnet/CodeChroma.Bridge.Tests/Questions/`): `QuestionValidationTests`, `QuestionRoutesTests` (routes, MCP JSON-RPC over the test server, non-blocking ask, degraded pass-through, re-ask, draw), `QuestionDeliveryTests`, `QuestionBatchDeliveryTests` (once per batch, right session, cleanup, step numbering after a cleared batch, no-session retention, text and Enter as separate writes), `QuestionDiagramLayoutTests`, `QuestionAgentWiringTests` (argv order, env, config file, token), `AskUserQuestionHookTests`.
