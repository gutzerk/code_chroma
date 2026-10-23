# 020 — Agent questions inside the agent terminal

Status: In progress (steps 1-6 and 8 implemented on `feat/agent-questions-terminal-ui`; step 7, the Playwright E2E, is outstanding)

Design: Design canvas "Agent questions in terminal" — https://claude.ai/artifact/6HCJ2L6EVkbynUbBVaLcwo (boards A2, A4, B1). Builds on 017 (`docs/architecture/ai-questions.md`).

## Problem

An agent's `ask_user` question shows only as a card on the canvas, while the agent runs in a terminal (docked rail, floating window, activity panel). The user has to leave the terminal to answer. Architecture questions also need a diagram next to the options, which the card cannot show.

## Goal

The open question appears next to the agent's own terminal, restyled to the approved "soft tiles" look, with a layout that depends on how much room the agent has. The answer is still written to the same `question` element, so answering in the terminal or on the canvas resolves both.

## What exists today (prototype, uncommitted on this branch)

- `web/src/canvas/doc/question/AgentQuestionTray.tsx`: lists open `question` elements with `meta.agent_id === agentId` and renders `ConnectedQuestionCard` for each.
- `web/src/canvas/doc/question/ConnectedQuestionCard.tsx`: `QuestionCard` wired to `answerOption`/`answerCustom`/`skipQuestion`/`reviseQuestion` (`questionClient.ts`). `QuestionElement.tsx` now uses it too.
- `web/src/agents/AgentTerminal.tsx`: renders `<AgentQuestionTray agentId={workspace} />` under the xterm container, so every host (`AgentTerminalDock`, floating windows, `ActivityPanel`, tutorial mock) gets the tray.
- `web/src/canvas/doc/question/devAskQuestion.ts`, installed from `EngineClientContext.tsx`: mock-bridge only, pressing Enter in an agent terminal asks a demo question. Keep it dev-only (mock bridge), never in a real-bridge build.
- `.agent-question-tray` in `web/src/styles.css`: `max-height: 55%`, scrolls.

## Decisions

| Topic | Decision |
|---|---|
| Which card | One restyled `QuestionCard` serves both the canvas and the terminal. No second card component. |
| Visual style | "Soft tiles" with muted colour (spec below). Replaces the current purple border, the green/amber/red rank borders, the rank badges and the bright pro/con text. |
| Recommended | Shown only as a small soft-green "Recommended" pill on the rank-1 option. The option tile itself is never green. |
| Selection model | Clicking an option (or pressing its number) selects it, and **Send** (or Enter) confirms. Rank 1 starts out selected. Today a click answers at once; change that. |
| Layouts | Three, picked automatically from the host's size (below). A1 (full cards under the terminal) and A3 (overlay) are dropped. |
| Diagram | Shown only when the selected option has `diagram_ref`. It follows the selected option. The canvas element it points to is rendered read-only. |
| Queue | One question at a time, oldest first. Show "Question N of M" from `meta.step/total`. Further open questions from the same agent wait. |
| Canvas copy | Unchanged as a record. The canvas card uses the same component in the `full` variant. |

## Layout selection

Measure the agent host's content box (ResizeObserver on the `AgentTerminal` wrapper, not `window`).

| Condition | Layout | Board |
|---|---|---|
| Host is in full mode (`layoutStore` `agentsMode === "full"`, or a floating window maximised) **and** width ≥ 1100px | **B1 split**: question (options grid + diagram) on the left, terminal on the right at a fixed 520px | B1 |
| Width ≥ 880px and the selected option has a `diagram_ref` | **A4**: diagram pane (420px) on the left of the terminal, compact card under the terminal | A4 |
| Otherwise (down to 320px) | **A2**: compact card under the terminal | A2 |

Re-evaluate on resize. Never let the terminal drop below 120px of height: the compact card scrolls inside its own box when needed.

## Visual spec (soft tiles, muted)

Add these as tokens on `:root` in `styles.css` (`--question-*`) and use the tokens, never raw hexes, in the component CSS.

| Token | Value | Use |
|---|---|---|
| `--question-surface` | `#1a1e27` | card background |
| `--question-border` | `#3a3550` | card border, 1px, radius 16px (18px in B1) |
| `--question-accent` | `#a995c9` | progress segments, selected number circle, `? ask_user` hint |
| `--question-accent-ink` | `#1a1124` | text on the accent |
| `--question-avatar-bg` / `--question-avatar-fg` | `#2f2840` / `#c3b2e0` | 28px "?" tile in the header |
| `--question-option-bg` / `--question-option-border` | `#20242d` / `#2f3440` | unselected option tile, radius 12px |
| `--question-selected-bg` / `--question-selected-border` | `#262236` / `#6c5b8a` | selected option tile |
| `--question-rec-bg` / `--question-rec-border` / `--question-rec-fg` | `#1c2620` / `#3d5546` / `#9cc7a8` | "Recommended" pill |
| `--question-pro-bg` / `--question-pro-fg` | `#1b241e` / `#9cc7a8` | pro chip with ✓ icon |
| `--question-con-bg` / `--question-con-fg` | `#2a1e20` / `#d1a3a6` | con chip with ✕ icon |
| `--question-send-bg` / `--question-send-border` / `--question-send-fg` | `#3a3149` / `#6c5b8a` / `#ece4f7` | Send button |
| `--question-new` | `#6f9a7c` | dashed outline of the "New" node in an option's diagram |

Card anatomy, top to bottom:
1. Header: "?" tile, "Question N of M", a flexible gap, then 4 segmented progress bars (18×3px, accent for done and current, `--border` for the rest).
2. Title: 17px, weight 600 (20px in B1).
3. Options (`role="radiogroup"`, each tile `role="radio"`): a 26px number circle (accent when selected, else grey), then the title.
   - **compact (A2, A4)**: only the selected tile expands to show the description and the pro/con chips, and the others are one line. In A2, unselected tiles show a chevron.
   - **full (B1, canvas)**: a 3-column grid, and every tile shows its description and chips.
4. Custom answer: an input ("Or say it in your words…") plus the Send button on one row, both 44px tall with radius 12px.
5. Footer: small muted links, "Earlier: <last answer> · Change" on the left (opens `DecisionHistory`) and "Skip" on the right.

Answered state: the card collapses to one line ("✓ Q2 · Per-session lock · Change"). Remove the tray when no open question is left.

All strings go in `questionStrings.ts` (i18n rule from 017). Keep the `why` text available as the `title` tooltip of the Recommended pill, not inline.

## Diagram pane (A4 and B1)

- Source: `option.diagramRef` → a canvas element id. Render that element and its children read-only (reuse the doc renderer used by `RootCanvas`, scaled to fit), with no editing, dragging or selection.
- A4: a pane header with option tabs ("1 · Lock", "2 · Future", …, only for options that have a diagram) synced with the radio selection. Zoom +/−/fit and a full-screen button sit bottom-right. No Compare button, no "Open on canvas" button, no window-titlebar toggle.
- B1: a diagram box under the option grid. The header shows "Option N · <title>", "follows the selected option", an "Open on canvas" link (pans the canvas to the element) and a full-screen button.
- Full screen: an overlay over the agent host showing the same diagram, closed with Esc.
- An option without `diagram_ref` while others have one shows an empty-state line ("No diagram for this option").

## Keyboard and focus

- When a question opens, do **not** steal focus from the terminal. Show the card and the `? ask_user` hint only.
- `Ctrl+Enter` in the terminal (or clicking the card) moves focus into the card.
- In the card: `1`–`9` select an option, ↑/↓ move the selection, Enter sends (from the input, it sends the custom text), Esc skips if `allowSkip` is set, and Shift+Tab or `Ctrl+Enter` returns focus to the terminal (`useXtermSession`'s `focus()`).
- After an answer, focus goes back to the terminal.
- Scope the handlers to the card element. No global `keydown` listeners.

## Attention when the agent is not visible

- Collapsed rail / minimised window: the agent's LED turns `--question-accent`, with a small "?" badge.
- The Agents tab in `ActivityPanel` shows a "1 question" counter pill.
- Use the same `meta.agent_id` filter as `AgentQuestionTray`. Factor it into one hook, `useOpenAgentQuestions(agentId)`.

## Work plan

1. **Tokens + restyle**: add the `--question-*` tokens, then restyle `QuestionCard`/`QuestionOptions`/`DecisionHistory` with a `variant: "compact" | "full"` prop and the select-then-Send model. Update `QuestionCard.test.tsx`, `QuestionOptions.test.tsx` and `questionFlow.test.tsx` (selection, Send, rank-1 preselect, no answer on single click).
2. **Hook + tray**: `useOpenAgentQuestions`, queue one at a time, and the collapsed answered row. Tray tests: filters by agent, shows only the oldest, disappears when none are open.
3. **Layout switch**: `AgentQuestionHost` wraps the terminal and tray and picks A2/A4/B1 from measured size + `agentsMode`. Unit-test the picker as a pure function `pickQuestionLayout({width, full, hasDiagram})`.
4. **Diagram pane**: a read-only element render + tabs + zoom + full-screen overlay.
5. **Keyboard/focus** as above, with tests.
6. **Attention badges** on the rail LED and the Agents tab.
7. **E2E** (Playwright, mock bridge): ask in the docked panel → answer in the terminal → the canvas card shows answered; resize to each layout threshold.
8. **Docs**: update `docs/architecture/ai-questions.md` (tray, layouts, selection model, tokens) and `docs/architecture/web-panels.md` if the agent host changes. Set this file to Done when shipped.

## Out of scope

- The C# Avalonia canvas port (`dotnet/CodeChroma.Canvas*`). Track it there separately.
- Backend changes: `ask_user`, `diagram_ref` and the answer/skip/revise routes already exist.

## Repo rules to keep

One-line comments and docstrings only, Arrange-Act-Assert tests, no AI attribution in commits, Conventional Commit messages (`feat(web): …`), and docs updated in the same change.
