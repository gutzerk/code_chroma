# 024 — Questions on the canvas: non-blocking ask, C# port, real option diagrams

Status: Specification

Issues: #281, #283, #278. Builds on `docs/architecture/ai-questions.md`, `017-ai-questions-grill-session.md`, `020-agent-questions-in-terminal.md` and `021-question-contract-and-diagrams.md`.


## Context

Three open bugs cover the agent-question flow (`ask_user` MCP → `question` element → answer back to the agent):
- **#281**: the agent sits "running" while it waits on a question, and an answer often never reaches it (after the 300 s wait it gets `{pending}`, goes idle, and nothing delivers the answer).
- **#283**: option diagrams shown with "Open on canvas" are not real diagrams (not in the Diagrams panel, can't be dragged or deleted), and the button doesn't centre the view (it searches `[data-node-id]`, which these elements don't have).
- **#278**: option diagrams in the agent window are unreadable: scaled down only, no pan, edge labels/descriptions/arrowheads not drawn, and position is read as top-left by the writer but as the centre by the reader, which roughly doubles the fitted area.

The C# bridge, the only bridge in the desktop app, has **no questions feature at all**: no `/mcp` `ask_user`, no `/questions` routes, it rejects `render:"question"`, and it doesn't inject `--mcp-config`. The user chose to port it in this PR (AGENTS.md: bridge parity, with shared contract cases).

User decisions:
- **C#**: port the questions subsystem in this PR.
- **#281**: don't block. `ask_user` returns at once and tells the agent to end its turn. When the user answers, the bridge types the answer into the agent's terminal as its next message.
- **#283**: one Diagrams-panel row per question (layer `decisions/<question_id>`).

## Branch

The working tree has many unrelated uncommitted changes, so work in a fresh worktree off `origin/main` on `fix/questions-canvas`. The PR body gets `Fixes #281`, `Fixes #283`, `Fixes #278`.

## 1. #281: non-blocking ask, answer typed into the terminal (Python first, then the C# port)

**Python**
- `src/codechroma/questions/mcp_server.py`:
  - `ask` no longer calls `broker.wait`. It returns `{asked: true, question_id, next: "End your turn now. The user's answer will arrive as your next message."}`.
  - Update `_INSTRUCTIONS` and the tool description to match.
  - Keep `ask_user_result` (reads element meta) for clients without a terminal.
- `src/codechroma/questions/broker.py`: delete it, since nothing waits any more. Drop `BridgeServices.questions` and `tests/unit/test_question_broker.py`.
- New `src/codechroma/questions/delivery.py`:
  - `deliver(services, element)` finds the agent session by `meta.agent_id` (`bridge/agents/sessions.py`) and calls `inject_when_idle(text)`.
  - Message format: `[CodeChroma answer · Q{step}/{total} · {question_id}] {question} → {answer}`. A skip becomes "… skipped by the user, decide yourself". A re-answer after revise becomes "… changed answer: …".
  - Returns whether a live session was found.
- `bridge/agents/sessions.py` `inject_when_idle`: add an `attempts` argument. Answers wait up to ~10 min for idle; launch context keeps the current default.
- `bridge/routes/questions.py`:
  - answer/skip call `deliver` after `store.settle`.
  - `waiting` now means "a live agent session will receive it".
  - revise keeps its canvas behaviour; the next answer is delivered with the "changed answer" wording.
- `skills/codechroma-grill/SKILL.md`:
  - After `ask_user`, stop and end the turn. Never poll, never repeat the question in chat.
  - Make the description trigger on "choose / decide / which approach". Drop the "fall back to chat" line only when the tool exists (keep it for no-tool sessions).

**Status / LED**
- Once the agent ends its turn, the detector reports `idle`, not `working`, which is the fix itself.
- `web/src/agents/CollapsedStrip.tsx:94` uses a bare `agent-led` span; switch it to `AgentLed` so the "?" asking badge shows there too.

## 2. C# port of questions (`dotnet/CodeChroma.Bridge/Questions/`, new)

Mirror the Python modules after the §1 change. No broker is needed now that ask is non-blocking.
- **`QuestionModels.cs` + `QuestionValidation.cs`**: `AskRequest`/`QuestionOption` and `validate_ask`/`unknown_refs`, from `questions/models.py` + `validation.py`.
- **`QuestionDiagrams.cs`**: `diagram_ops` from `questions/diagrams.py` (limits, validation, the new centre positions and per-question layer from §3/§4).
- **`QuestionStore.cs`**: `open_question`, `find_element`, `list_questions`, `settle`, `reopen`, `draw_diagram`.
  - Writes go through the existing C# `ApplyBatch` and canvas commit, the same path `Stores/Recipes.cs` uses.
  - Each commit broadcasts the "canvas" ping.
- **`QuestionMcp.cs`**: a stateless JSON-RPC handler copied from the shape of `WorkflowRunner.Steer.cs` `HandleMcp`/`McpTools`/`Tool`.
  - Tools: `ask_user`, `ask_user_result`, `draw_option_diagram`, with the same names and schemas as Python.
  - Token: `<agentId>.<HMACSHA256>` keyed by a per-process random secret, compared with `CryptographicOperations.FixedTimeEquals`. `meta.agent_id` is stamped from the token.
- **`QuestionDelivery.cs`**: finds the `AgentSession` by agent id and calls `InjectWhenIdle(text, attempts: ~1200)` (`Agents/AgentSessions.cs:118`), with the same message text as Python.
- **`Routes/QuestionRoutes.cs`**:
  - `POST /mcp/` handles JSON-RPC and returns 202 for notifications. `GET /mcp/` answers quickly, which is what the hook's 0.5 s probe needs.
  - `GET /repos/{id}/questions` and `POST …/{qid}/answer|skip|revise|request-diagram`, with the same status codes and ack shapes as `bridge/routes/questions.py`.
  - Register in `Program.cs`.
- **Agent wiring**:
  - `Terminal/TerminalAgents.cs` `Argv`: for Claude, add `--mcp-config <file>` before `--plugin-dir` (it is variadic). The file is `<temp>/codechroma-mcp-<random>/<agentId>.json`, because inline JSON is mangled by PTY quoting on Windows. Not added for bare runs.
  - `Http/BridgeAddress.ExportIdentity` also exports `CODECHROMA_QUESTION_TOKEN`, so `hooks/ask_user_question_hook.py` starts denying the native `AskUserQuestion`.
- **`Stores/CanvasDocument.cs`**:
  - Add `"question"` to `RenderKinds`.
  - Add `questions`, `decisions` and the `decisions/` prefix rule to the non-diagram/no-projection logic (§3).
  - Same in `dotnet/CodeChroma.Canvas/Catalog/DiagramCatalog.cs`.
- **Contract**: new `tests/fixtures/bridge_contract/questions.cases.json`. It seeds a question through the canvas batch route (the MCP token is per-process), then covers GET, answer, skip, revise, 404/409/422 and request-diagram. It runs in both `tests/contract/test_bridge_wire_contract.py` and `dotnet/CodeChroma.Bridge.Tests/Contract/WireContractTests.cs`.
- **C# tests** in `dotnet/CodeChroma.Bridge.Tests/Questions/`: MCP round-trip (initialize, tools/list, ask_user creates the element, forged token gives 401), store and diagram ops, delivery injects into a fake session, and `Argv` contains `--mcp-config` before `--plugin-dir`.

## 3. #283: option diagrams become a real diagram per question

- `questions/diagrams.py` (and C#): write the layer `decisions/<question_id>` instead of the shared `decisions`. The root group's label is the option title, so the layer row is labelled with the question text.
- `canvas/document.py` `NON_DIAGRAM_LAYERS` / `web/src/canvas/doc/diagramCatalog.ts`:
  - `decisions/*` layers count as diagram layers for the panel and frames (`isDiagramLayer`).
  - They have no file projection: exclude them from the projection path at `document.py:154`, from `isRecipeBackedLayer` and from `hasDeletableDiagramArtifact`, so deleting one removes canvas content only.
  - Extend `tests/unit/test_non_diagram_layers_parity.py` to cover the prefix rule.
- `diagramCatalog.ts` `labelForDiagramLayer`: for `decisions/<qid>`, use the question element's text, shortened.
- Placement: `store._next_band` currently assumes untouched bands. Change it to put a new question layer below the max bottom of every existing `decisions/*` element, so dragged diagrams don't overlap.
- Delete: the existing `DeleteDiagramDialog` → `removeLayerAndRefresh` path. The option's `diagram_ref` then dangles, and `QuestionDiagram` already shows "No diagram". The "Add diagram" request is allowed again.
- Drag: works through `DiagramFrame`/`useGroupDrag` once the layer is a diagram layer (`CanvasDocView.tsx:243-252` buckets it).
- Centre:
  - Add `data-diagram-layer` to `DiagramFrame`'s root.
  - Add `focusDiagram(layer)` to `CanvasFocusContext`, implemented in `RootCanvas.tsx` with `viewportRef.current?.fitToSelector('[data-diagram-layer="…"]')` (`CanvasViewport.tsx:503`).
  - "Open on canvas" in `QuestionDiagram.tsx:119` calls it, and the A4 pane variant gets the button too.
- Migration: existing elements on the plain `decisions` layer keep rendering as before (still non-diagram). No rewrite.

## 4. #278: readable, movable option diagrams

- **Coordinates**: `questions/diagrams.py` `diagram_ops` (and C#) writes centre positions, which is what `elementRect.ts` expects, and sizes the root group to its members. This fixes the doubled fit area and the misplaced boxes on the real canvas.
- **`web/src/canvas/doc/question/QuestionDiagram.tsx`**:
  - Fit may scale up to 1.5 and never goes below a readable minimum (0.7). When the content doesn't fit, the user pans.
  - New local `usePanZoom` hook (`web/src/canvas/doc/question/usePanZoom.ts`): pointer-drag pan with a threshold, and wheel zoom toward the cursor (the `zoomAround` maths from `CanvasViewport.tsx:324`). The stage uses `translate(...) scale(...)`. The buttons and ⤢ reset stay.
  - Draw the root group as a dashed frame instead of a box.
  - Edges get arrowheads and their `label` text, and edges are painted above the frame but below the nodes, at their midpoints.
  - Nodes show `description` as a second line, clamped to 3 lines, with the full text in a tooltip. `status:"new"` keeps its dashed accent.
  - Full screen renders through a portal into `document.body`, so it covers the whole window.
  - Node text uses a 13px base.
- **Content**:
  - `skills/codechroma-decision-diagram/SKILL.md` + `references/drawing-decision-diagrams.md`: every node gets a `description` saying what changes for it under this option, every edge gets a verb label, and the diagram shows what this option adds or changes versus today.
  - `draw_option_diagram` keeps its limits. Add a soft check (warning text in the tool result, not an error) when more than half the nodes lack a description.
- **Tests**:
  - `QuestionDiagram.test.tsx`: renders edge labels and descriptions, the min scale is applied for a large diagram, a drag changes the translate, and the wheel changes the zoom.
  - `diagrams` unit tests: centre positions and the layer name.

## 5. Docs (same PR)

- `docs/architecture/ai-questions.md`:
  - New non-blocking flow diagram, delivery via inject, broker removed, the `waiting` meaning, per-question `decisions/<qid>` layers.
  - Remove the "🔴 C# bridge has no /mcp" note and add the C# file map.
  - Fix the stale `mkdtemp` note against `launch.py`.
- `docs/architecture/single-canvas.md`: `decisions/*` layers as canvas-only diagrams.
- `docs/planning/012-csharp-bridge.md`: questions ported. Remaining gaps: Codex is still not wired, and the hook needs Python on PATH.
- `docs/architecture/parallel-agents.md`: answers are typed into the agent terminal.

## Verification

- `poetry run pytest -n auto tests/unit/test_bridge_questions_route.py tests/unit/test_question_agent_wiring.py tests/unit/test_non_diagram_layers_parity.py tests/contract`, then a full `poetry run pytest -n auto` and `poetry run ruff check .`.
- `dotnet test dotnet`: the new Questions tests and the shared `questions.cases.json` through `WireContractTests`.
- `cd web && npm test && npm run lint && npm run build`.
- **Manual (desktop app, C# bridge)**: `dotnet run --project dotnet/CodeChroma.Shell.App -- --repo .`, start a Claude agent and say "grill me on X".
  - The question card appears and the agent ends its turn (LED idle with "?").
  - Pick an option → the answer is typed into the agent terminal and it continues.
  - With a diagram option: "Open on canvas" centres the view, the diagram is a row in the Diagrams panel, it can be dragged and deleted, and the agent-window diagram is readable and pannable.
- Repeat the agent flow once on the Python bridge (`python -m codechroma.bridge.launch --repo-path .`).
