# 025 — Draw dialog: pick a diagram type and say what to draw

Status: Done (web dialog, both bridges). Deviation: no scope switch in the dialog; the user writes scope in the prompt, so the dialog sends only type and request. The bridges carry only `diagram_type` and `diagram_request`. The agent card title is `Draw · <type>` with no scope subtitle. Kinds data is JSON (`kinds.json`), not YAML.

Source: the "Draw Diagram Picker" design canvas (board "Draw dialog · type picker + prompt → agent"), styled after the "Diagram Readability Options" canvas (022). Builds on `docs/architecture/diagram-skills.md`, `docs/architecture/parallel-agents.md` and `docs/architecture/web-canvas-shell.md`.

## Problem

The rail's "Draw…" button (`web/src/canvas/doc/DrawDiagramButton.tsx`) opens an agent straight away with `{ type: "any" }`, and the agent's terminal asks "What do you want to see?". The user cannot see which diagram types exist, cannot pick one, and has to type the request into a terminal after a CLI has already started. Picking the wrong kind of diagram is left to the router table in the skill.

## Goal

One click on "Draw…" opens a dialog centred over the canvas. It shows each diagram type as a small schematic, a prompt field, and a scope switch. "Draw with agent" (or Enter) opens one agent in the right-hand Agents panel that already knows the type, the scope and the request, and starts drawing without asking again.

## The dialog (from the design)

| Part | Behaviour |
|---|---|
| Type grid, 4 × 2 | `Let the agent pick` (`any`), `System context` (`c1`), `Design patterns` (`patterns`), `Change impact` (`impact`), `Feature plan` (`plan`), `Sequence` (`sequence`), `Data flow` (a saved custom type, see below), `Custom type` (`custom`). One card is selected; the selection persists for the session (last used). |
| Schematic | A static inline SVG per type, drawn in the 022 role colours (component green, entry cyan, data orange, external/changed amber, planned green dashed, pattern purple). No live rendering. |
| Prompt | A textarea, "What should it show?", with a placeholder that changes with the type. Optional for every type: empty means the agent asks, as today. Enter draws, Shift+Enter is a new line. |
| Scope | `Whole repo` / `Current change` / `Selected blocks`. `Current change` is the default for `impact`; `Selected blocks` is disabled when nothing is selected on the canvas. |
| Footer | "Opens a new agent in the Agents panel", Cancel, "Draw with agent". Disabled with the existing tooltip at agent capacity or while launching. |
| Close | Esc, Cancel, the close button, or a click on the scrim. Focus is trapped in the dialog and returns to "Draw…" on close. |

The dialog covers the canvas only; the rail and the Agents panel stay visible, so the user sees where the agent appears.

## Decisions

1. **Types come from the bridge, not a hard-coded list.** The built-ins live in a new `GET /diagram-kinds` (id, name, one-line purpose, default scope, whether a request is required). Custom types come from the existing `GET /diagram-types`; each saved type with a `schematic` hint becomes its own card ("Data flow" is the first), the rest sit behind "Custom type". The schematic SVGs stay in the web bundle, keyed by kind id; an unknown custom type falls back to the generic custom schematic.
2. **The request skips the terminal question.** When `diagram_request` is non-empty, the agent's first message is the request itself, not "What do you want to see?". With an empty request, today's behaviour stays.
3. **Type is a hint, not a lock.** The composed prompt says the user picked a type; the skill may still say if the request clearly fits another type better, but it draws the picked one unless the user agrees.
4. **No new agent kind.** The dialog calls the existing `attachAgent(client, null, task, { type, request, scope })`. The agent card's title becomes `Draw · <type name>`.

## Stage 1 — Bridge: carry type, request and scope (Python + C#, about 1 day)

Today the web client already sends `diagram_type` and `diagram_request` (`web/src/agents/agentClient.ts`), but the C# bridge reads only `diagram_type` and drops the request, and the Python bridge (`src/codechroma/bridge/routes/agents.py`) reads neither. Per `AGENTS.md`, both bridges change together.

Files: `dotnet/CodeChroma.Bridge/Routes/AgentRoutes.cs`, `dotnet/CodeChroma.Bridge/Context/DiagramContext.cs`, `dotnet/CodeChroma.Bridge/Skills/BareSkill.cs`, `dotnet/CodeChroma.Bridge/Agents/AgentManager.cs` (record fields), `src/codechroma/bridge/routes/agents.py` and its agent store, a new `routes/diagram_kinds` in both bridges.

1. Accept `diagram_type`, `diagram_request` (≤ 2000 chars, trimmed) and `diagram_scope` (`repo | change | selection`, plus `selection_ids` for `selection`) on `POST /agents`; persist them on the agent record next to `DiagramType`.
2. Extend `DiagramContext.Types` with `impact` (the skill already has `references/type-impact.md` and `bare-impact.md`) and `plan`. `plan` is a mode of the skill, not a type, so `plan` maps to `impact` plus an instruction to follow `references/feature-plan-mode.md`. `any` stays.
3. `BareSkill.ComposeInteractive` takes the request and scope. With a request: the "How this session starts" block says the user picked `<type>`, scope `<scope>`, and asked `<request>`; run the context command with phrases from that request, then draw. No greeting, no question. `asksInTerminal` is false whenever a request is given, so the bridge prints no banner.
4. Scope reaches the skill as text: `change` names the current diff (the same source the impact view uses), `selection` lists the selected element ids and titles.
5. `GET /diagram-kinds` returns the built-in list from one shared data file (`src/codechroma/diagrams/kinds.yaml`, embedded in C# the way `LlmCatalog` embeds its data).
6. Contract cases in `tests/fixtures/bridge_contract/agents.cases.json` (request and scope persisted, an unknown type rejected, an oversized request rejected) and a new `diagram_kinds.cases.json`. C# unit tests for `ComposeInteractive` with and without a request in `dotnet/CodeChroma.Bridge.Tests/Skills/BareSkillTests.cs`; Python tests in `tests/unit/`.

Exit check: `POST /agents` with `sequence` + a request starts an agent whose first visible message is the request and that never asks "What do you want to see?".

## Stage 2 — The dialog (web, about 2 days)

Files: new `web/src/canvas/doc/drawDialog/` (`DrawDialog.tsx`, `DrawDialog.css`, `DiagramKindCard.tsx`, `schematics.tsx`, `drawDialogStore.ts`, `useDiagramKinds.ts`), `DrawDiagramButton.tsx`, `web/src/agents/agentClient.ts` (`DiagramTaskHint` gains `scope` and `selectionIds`), `RootCanvas.tsx` (mount point), `web/src/engine-client/mockBridge.ts` (serve `/diagram-kinds` for the mock).

1. `DrawDiagramButton` opens the dialog instead of launching. The tutorial path (`tutorialStore.isActive()`) keeps opening the scripted mock agent.
2. `DrawDialog` renders over the canvas viewport only (portal into the canvas container, not `document.body`), with the scrim, focus trap, Esc and scrim-click to close.
3. Cards from `useDiagramKinds()` (built-ins + saved custom types); keyboard: arrow keys move the selection, Enter draws.
4. Prompt state and last-used type live in `drawDialogStore.ts` (per session; the draft survives close and reopen until drawn).
5. "Draw with agent" calls `attachAgent` with `{ type, request, scope, selectionIds }` and closes the dialog; errors show inline in the dialog footer, not under the rail button.
6. Colours from the existing canvas tokens in `web/src/styles.css`; add tokens only where 022's role colours are not yet named.
7. Tests: `DrawDialog.test.tsx` (opens, picks, Enter draws with the right hint, Esc closes, capacity disables), update `DrawDiagramButton.test.tsx`; one Playwright journey (click Draw…, pick Sequence, type, Enter, agent card appears with `Draw · Sequence`).

## Stage 3 — Agent card and polish (about half a day)

1. The agent card in the Agents panel shows `Draw · <type>` and the scope as its subtitle (`web/src/agents/`), so several draw agents can be told apart.
2. Saved custom types can carry an optional `schematic` id (`dataflow`, `layers`, `ownership`, …) in their definition; the library validates it against the web's known schematics. Document it in `docs/architecture/custom-diagrams.md`.
3. Avalonia canvas port (`dotnet/CodeChroma.Canvas*`): recorded as a gap in `docs/planning/013-avalonia-canvas.md`, not built here.

## Docs to update in the same change

- `docs/architecture/diagram-skills.md` — how a drawing agent now starts (type, request, scope; no question when a request is given).
- `docs/architecture/web-canvas-shell.md` — the Draw dialog replaces the direct launch.
- `docs/architecture/parallel-agents.md` — the new agent record fields.
- `docs/planning/012-csharp-bridge.md` — note that the Python bridge now carries the diagram hint too (it did not before).
- `README.md` / `web/QUICKSTART.md` wherever "Draw…" is described.

## Out of scope

- Live previews of the user's own repo inside the cards.
- Authoring a new custom type from the dialog (the retired wizard stays retired; "Custom type" with a request like "make a data-flow type" goes to the skill's Fallback).
- Changing what the skill draws for each type.

## Risks

- **Python bridge parity.** The Python bridge has no diagram hint today, so Stage 1 adds more on that side than on the C# side; budget for it.
- **A request that contradicts the type** ("sequence" picked, "show me the whole system" typed). Decision 3 handles it in the prompt; check it with one manual run per type.
- **Selection scope** depends on canvas selection ids being stable across a reanalyze; if not, fall back to titles.
