# 021 — Enforced question contract and option diagrams

Status: Done (Python and C# bridges: C# hosts `/mcp` and the `AskUserQuestion` hook; Playwright journey not written)

Builds on 017 (`docs/architecture/ai-questions.md`) and 020 (`020-agent-questions-in-terminal.md`).

## Problem

CodeChroma opens other people's repositories on other people's machines. Those projects carry their own rules, skills and settings. We copy our skills into them, but nothing guarantees an agent uses them. Today a good question (pros, cons, a recommendation, a diagram) only happens when the agent happens to follow `codechroma-grill`:

- `pro`, `con`, `rank` and `why` are optional in `questions/models.py`, so an incomplete question is accepted and the card shows fewer parts.
- Nothing asks for `diagram_ref`, so complex architecture questions arrive with no picture.
- An agent can bypass `ask_user` with Claude's native `AskUserQuestion` (rerouted today by `hooks/ask_user_question_hook.py`, which hard-codes `rank 1` on the first option and sends no pros or cons) or with plain terminal text.

## Goal

1. The question format is enforced by the thing every agent must go through, the `ask_user` MCP tool, not by a skill.
2. Complex questions get a diagram by default, drawn from a new abstract-diagram skill.
3. The user can ask for a diagram on any question that came without one.

## Decisions

| Topic | Decision |
|---|---|
| Where the contract lives | The `ask_user` server validates every call. It works for any CLI, because the MCP config is the one thing we pass at launch. Skills and hooks only help. |
| Failure feedback | A rejected call returns a tool error listing each problem and saying to call `ask_user` again with the same intent. No question is created. |
| Retry limit | After 3 rejected calls for one agent in one session, accept the question as sent and show it simplified (today's behaviour). The user is never stuck behind a stubborn agent. |
| Native `AskUserQuestion` | For Claude, the existing `PreToolUse` hook stops rerouting blindly: it denies with a message naming `ask_user` and its required fields. If `ask_user` is not reachable in that session, it fails open to the native dialog (no reroute). |
| Text questions | Not detected. A `Stop`-hook guess would produce false positives. The tool description and the native-tool deny are the guard. |
| Diagram authorship | The agent draws a "decision diagram" with a new skill. The bridge never invents one. |
| "Complex" | Marked by the agent with `kind: "diagram"` (already in `AskRequest`). The tool description says when to use it. The server only enforces that a `diagram` question has a diagram. |
| User-requested diagram | A button on the card asks the agent to add one. It does not call a model from the bridge. |
| Backward compatibility | Old stored questions and any already-open question render as today. Validation applies only to new `ask_user` calls. |

## The contract (server side)

A new `validate_ask(request) -> list[str]` in `questions/validation.py`. Rules for `kind: "choices"`:

- 2–4 options, each with a non-empty `title`, `description`, `pro`, `con` and `why`.
- Exactly one option has `rank: 1`. Ranks are unique integers.
- Option ids are unique.
- `question` is non-empty.

For `kind: "diagram"` the same, plus: at least one option has `diagram_ref`, and every `diagram_ref` resolves to an existing canvas element (the check happens in the store, which holds the doc).

Error text, one line per problem and a fixed footer:

```
CodeChroma rejected the question.
- Option "B": missing con
- No option has rank 1
Call ask_user again with all fields. Keep the original intent and options. Do not ask in terminal text.
```

`QuestionMcp.ask` returns this as an MCP tool error (`isError`), so the agent sees it as an ordinary failed call and fixes it.

The tool description (`_INSTRUCTIONS` in `mcp_server.py`) is rewritten to carry the whole contract (field list, rank rule, when to use `kind: "diagram"`, "never ask in chat text"), since it reaches the agent regardless of project skills. The JSON schema marks the same fields required where the MCP SDK allows it, but the server check stays the source of truth.

### Retry counter and fallback

- Key: `agent_id` (the workspace id) plus `session_id`, held in memory on the broker or store; reset on a valid question, an answer, or after 10 minutes of silence.
- Reject while the count is below `settings.questions.max_rejections` (default 3, added to `config.py` and to `docs/architecture/config-and-prompts.md`).
- At the limit, accept the question unchanged and set `meta.degraded = true`. The card shows no error, only fewer parts, as it does today. The last rejection's text is kept in the element's `meta.validation` for support and tests.

## Native `AskUserQuestion` hook (Claude only)

`hooks/ask_user_question_hook.py`:

- Check whether the `codechroma` MCP server answers (the env from `McpEndpoint.env()` is already read here). If it does, print the `permissionDecision: "deny"` JSON with a reason that names `mcp__codechroma__ask_user` and the required fields, and exit. The agent retries through `ask_user` and is validated there.
- If the bridge is unreachable, keep the current fail-open path, which shows the question on the canvas, so a broken bridge never blocks the agent.
- `build_payload` stops fabricating `rank`; the reroute fallback was dropped later, the hook now fails open.

The hook is delivered the way it is today (plugin `hooks/hooks.json`); we do not edit the project's own settings. Other CLIs get only the server-side contract.

## Diagrams

### New skill: `codechroma-decision-diagram`

Lives in `skills/` (never under `.claude/skills/`, see `docs/architecture/diagram-skills.md`). The existing drawing skill produces code-structure views (C1, patterns, impact) from the repository. A decision diagram is more abstract: components, flows, ownership or trade-offs for an option that may not exist in the code yet. The skill:

- draws one small diagram per option (or one shared diagram with the option's part highlighted), at most about 12 nodes, labelled in the user's language;
- writes it through the canvas batch route as elements on a dedicated layer (`decisions`), with a root element per option whose id becomes that option's `diagram_ref`;
- marks new parts with `meta.status = "new"` (the dashed "New" outline already styled by `--question-new`);
- registers a checker like `check_diagram.py` with a node budget and a rule that a root exists per option, and follows the soft-diagnostics path described in `diagram-skills.md`;
- ships a router entry in `codechroma-draw-diagram` pointing at it, so the existing "draw a diagram" requests reach it too.

### Default for complex questions

The `ask_user` description and `codechroma-grill` say: for a question that changes structure (boundaries, data flow, ownership, a new component), draw the diagram first with `codechroma-decision-diagram`, then call `ask_user` with `kind: "diagram"` and a `diagram_ref` per option. The server enforces only that the references are valid (above). The new skill must be reachable even where our skill copy is ignored, so its instruction is also in the tool description: "call `request_diagram`", see next.

### Make the diagram reachable without the skill

Add a second MCP tool, `draw_option_diagram(question_id | element ids, option_id, nodes, edges)`, which writes a validated small graph (budget-checked server side) and returns the new `diagram_ref`. An agent that never loaded our skill can still produce a diagram because the tool, its schema and its description arrive over MCP. The skill then is a quality guide on top of the tool, not the only way in. The tool shares the node budget and the layer with the skill's checker.

## "Add a diagram" button

- On a card whose open question has options without `diagram_ref`, a quiet footer button "Add diagram" (strings in `questionStrings.ts`). Not shown for answered cards or when every option has one.
- Click: `POST /repos/{id}/questions/{qid}/request-diagram` records `meta.diagram_requested = true` and `meta.diagram_requested_at`. The agent is blocked inside `ask_user`, so the request is delivered as the result of that call: the waiting call returns `{ "needs": "diagram", "question_id": ... }` (a new result shape next to `pending`), and the tool description tells the agent to draw the diagrams with `draw_option_diagram` and call `ask_user` again with the same `session_id` and the references. The original question element is updated in place (same id), not duplicated.
- While the agent works, the card shows "Diagram requested" and disables the button. If the agent re-asks without diagrams after the retry limit, the card shows the question as is and the button becomes available again once.
- The result shape change is additive. Agents that ignore `needs` fall back to the existing pending-poll behaviour, so a skipped request costs nothing.

## Work plan

1. **Contract:** `questions/validation.py`, wire it into `QuestionMcp.ask` and the HTTP ask route, rewrite the tool description and schema, add the retry counter and `settings.questions.max_rejections`. Tests in `tests/unit/test_question_validation.py` (each rule, error text, counter, fallback), and extend `test_bridge_questions_route.py` and `test_question_agent_wiring.py`.
2. **Native tool hook:** deny-with-redirect when the bridge answers, fail-open otherwise, drop the fake `rank`. Update the hook tests.
3. **Diagram reference check** in the store: unknown `diagram_ref` rejects; add the `diagram` kind rule.
4. **`draw_option_diagram` MCP tool** with the node budget, the `decisions` layer and a per-option root; tests for budget, layer, returned reference.
5. **New skill `codechroma-decision-diagram`** (`SKILL.md`, a reference file, checker script), router row in `codechroma-draw-diagram`, sync through `SkillSync`; update `codechroma-grill` to point at it.
6. **"Add diagram" button:** route, `meta` fields, the `needs` result shape, card button and states, web tests; mock bridge parity.
7. **Docs:** `ai-questions.md` (contract, retry, hook, tool, button), `diagram-skills.md` (new skill and layer), `config-and-prompts.md` (setting); set this file to Done.
8. **E2E:** Playwright on the mock bridge, a rejected incomplete question, then a valid one; the Add diagram flow.

## Risks and open points

- **C# bridge.** The question stack exists only in the Python bridge (no `ask_user` in `dotnet/`). The desktop app bundles the C# bridge, so confirm how questions reach agents there before relying on this. If they do not, the contract must be ported or the Python MCP server run beside it. Decide this before step 1.
- **Loop on weak agents.** Three rejections is a guess; measure with Claude, Codex and a smaller model and tune.
- **Cost of default diagrams.** Each complex question now needs a diagram call first. Keep the node budget small and let the user skip the wait ("Skip" already exists).
- **No text-question guard.** An agent that asks in terminal text bypasses everything. Accepted for now; revisit with real session data.
- **Other CLIs.** Only the server contract applies. Verify Codex tool-error handling reaches the model the same way.

## Out of scope

- Detecting questions in terminal text.
- Generating diagrams in the bridge from the option text, without an agent.
- The Avalonia canvas port (`dotnet/CodeChroma.Canvas*`).

## Repo rules to keep

One-line comments and docstrings, Arrange-Act-Assert tests, no AI attribution in commits, Conventional Commit messages, docs updated in the same change.
