# 017 — AI questions and grill sessions on the canvas

Status: Specification

Prototype: `Chroma-AI-Canvas-Example.html` (the unified session: choice cards, architecture-diagram options, AI ranking with pro/con, decision history).

## Problem

When an agent (Claude, Codex) needs a decision it asks in the terminal as plain text. The answer is typed free-form, alternatives are not comparable, decisions are not recorded, and a diagram-worthy question (architecture options) cannot be shown as a diagram.

## Goal

An agent asks through the canvas: a question becomes an element on the one canvas, the user answers by clicking a branch (or typing their own), and the answer returns to the waiting agent. A sequence of questions is a **grill session** with progress, history and revise.

## Decisions

| Topic | Decision |
|---|---|
| Transport (all CLIs) | A bridge-hosted MCP server exposing a blocking `ask_user` tool. MCP is the one interface Claude and Codex share. |
| Claude extra path | `PreToolUse` hook on `AskUserQuestion` reroutes the built-in tool to the same canvas question (phase 3). |
| Codex extra path | Deferred. App-server `tool/requestUserInput` is experimental; Codex hooks are not documented to cover it. |
| Data model | A `question` element kind on `CanvasDoc`, written through `apply_batch` like every other element. No second store for the content. |
| Answer storage | Question state (`open`/`answered`/`skipped`) and answer live on the element's `meta`; the bridge also keeps an in-memory waiter per open question. |
| Rendering | New `question` entry in `elementRules.ts` `BLOCK_RULES`, new renderer; option cards reuse the existing node-box styling and the connector drawing. |
| AI ranking | The agent supplies `recommended` rank per option plus `pro`/`con`; the canvas only renders them. Labels are i18n strings, not hardcoded (the prototype mixes RU/EN). |

## Wire shapes

`ask_user` input (MCP tool):

```json
{
  "session_id": "optional grill session id",
  "question": "How should checkout be structured?",
  "kind": "choices | diagram",
  "options": [
    {"id": "a", "title": "Modular monolith", "description": "...", "pro": "...", "con": "...", "rank": 1, "why": "...", "diagram_ref": "optional element id"}
  ],
  "allow_custom": true,
  "allow_skip": true
}
```

Result returned to the agent: `{"answer": "<option title or custom text>", "option_id": "a|null", "skipped": false}`. If the user does not answer within the wait budget the tool returns `{"pending": true, "question_id": "..."}` and a later `ask_user_result(question_id)` call fetches it.

Canvas element: `render: "question"`, `meta: {session_id, step, total, state, answer, options[]}`; options are children (`add_element` with parent) so a `diagram` option can link a drawn diagram by `diagram_ref`.

## Architecture

```
agent (claude/codex PTY)
   └─ MCP tool ask_user ──► bridge /mcp (streamable HTTP, per workspace)
                               ├─ apply_batch(add question element) ──► ws "canvas" ping ──► canvas renders QuestionCard
                               └─ await future(question_id)  ◄── POST /repos/{id}/questions/{qid}/answer ◄── user click
```

Backend (new): `src/codechroma/questions/` (`models.py`, `broker.py` futures keyed by question id, `mcp_server.py`), `bridge/routes/questions.py` (`GET` open questions, `POST .../answer`, `POST .../skip`).
Web (new): `web/src/canvas/doc/question/` (`QuestionCard.tsx`, `QuestionOptions.tsx`, `DecisionHistory.tsx`, `questionClient.ts`); registry entry in `elementRules.ts`.
Agent launch: `terminal/agents.py` `agent_cli` injects the MCP registration — Claude via `--mcp-config <json>`; Codex via `-c mcp_servers.codechroma=...` overrides (verify the flag exists, otherwise a generated `CODEX_HOME` config).

## Phases

1. **Backend core.** Models, broker (open/answer/skip/timeout/restart-safe: an open question with no live waiter shows as "agent is no longer waiting"), routes, `ask_user` MCP server, unit tests for broker and routes.
2. **Canvas UI.** `question` element + `QuestionCard` with choices, custom answer, skip, progress, decision history, revise (restarts later steps), AI-rank styling and pro/con. Vitest per component; Playwright journey: agent asks → click → agent receives answer (mock MCP client).
3. **Agent wiring.** Inject MCP config into Claude and Codex windows; `codechroma-grill` skill (Claude) and an `AGENTS.md` snippet (Codex) telling the agent to use `ask_user` with a recommended option and pro/con; Claude `AskUserQuestion` hook.
4. **Diagram options.** `kind: "diagram"` options linked to drawn diagrams (reuse the draw-diagram skill output); scenario toggles stay inside the diagram element, not the question.
5. **Docs.** New `docs/architecture/ai-questions.md`, row in CLAUDE.md map, update `single-canvas.md`, `parallel-agents.md`, `assistant-settings.md` where they touch.

## Risks and open items

- **Timeouts.** Claude MCP default is very long (configurable per server in ms); Codex `tool_timeout_sec` defaults to 60 and is per server. Raise it in our injected config and keep the pending/`ask_user_result` fallback.
- **Claude hook caveat.** A timed-out `PreToolUse` command hook does not block unless `onFailure: "block"`; the hook must set it and its timeout deliberately.
- **Unverified (check against the installed CLI versions before coding):** `AskUserQuestion` matcher syntax; Codex per-session MCP registration without editing user config; plugin-bundled `.mcp.json`/hooks as an alternative to `--mcp-config` for Claude (the repo already passes `--plugin-dir`); `MCP_TOOL_TIMEOUT` unit.
- Agent may still ask in chat text; the skill/AGENTS.md instruction is the only mitigation.
- Concurrent open questions from several agent windows: question element carries `agent_id` and is placed next to its window.
- Security: the MCP endpoint is loopback-only with a per-workspace token; answers are plain text and never executed.

## Out of scope

Codex app-server integration, answering from outside the canvas (CLI/mobile), persisting grill sessions across repos.
