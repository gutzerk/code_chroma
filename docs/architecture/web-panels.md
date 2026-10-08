# Terminal panel, breadcrumb & games (`web/src/{terminal,breadcrumb,games}/`)

The small IDE-chrome panels around the canvas shell (see [`web-canvas-shell.md`](web-canvas-shell.md)).

There used to be a third panel here — `src/sidebar/` (`Sidebar`/`TreeItem`), an Explorer-style file
tree docked left of the canvas, toggled by a rail button and `sidebarStore`. It was removed outright
(component, store, CSS, e2e coverage) rather than left disabled — there's no flag or dead code path
to revive if it comes back, it would be rebuilt from scratch.

- **`src/terminal/`** — `WebSocketTerminalClient` (in `TerminalClient.ts`) connects to
  `src/codechroma/terminal/server.py` over a real WebSocket. This is the one place the web app talks
  to a real Python backend by default, rather than a mock. The panel is a **bottom** dock inside
  `.canvas-area` (see [`web-canvas-shell.md`](web-canvas-shell.md)), not the right-hand one it originally was.
  🔴 **`useXtermSession.ts` is the only place an xterm is constructed.** `TerminalPanel.tsx` and
  `AgentTerminal.tsx` (one per agent window) both go through it, because they were near-duplicates
  that drifted: the agent copy had silently missed the panel's resize debounce, so a window drag
  fired `fit()` plus a SIGWINCH on every pointermove and smeared the TUI it was resizing. What that
  hook owns, and why each part is not optional for an agent TUI:
  - `allowProposedApi: true` + `Unicode11Addon` + `unicode.activeVersion = "11"`. Without it xterm
    measures with the Unicode 6 width table and every braille spinner, box-drawing frame and emoji
    lands at the wrong cell width.
  - An explicit `fontFamily` (xterm's default is `courier-new`, which has none of those glyphs) and
    `lineHeight: 1` — anything larger breaks box borders into dashes.
  - `WebglAddon` with an `onContextLoss` dispose so a lost context degrades to the DOM renderer
    rather than a blank panel, plus a `matchMedia("(resolution: Ndppx)")` listener that clears the
    texture atlas when the window moves between a Retina and an external display.
  - **No `convertEol`** — a raw PTY already emits `\r\n`, and converting bare `\n` fights the TUI's
    own cursor model.
  - The debounced, size-deduped `refit`, the 0x0 guard for a hidden host box, and `onBinary`.
  - Copy-on-select: `term.onSelectionChange` writes the new (non-empty) selection to
    `navigator.clipboard`, the same way a native terminal (iTerm, GNOME Terminal) works — no
    Cmd/Ctrl+C needed. Applies to both the panel and every agent window since they share this hook.
    A missing/denied Clipboard API fails silently (`.catch(() => {})`) rather than throwing.
    Debounced (`SELECTION_COPY_DEBOUNCE_MS`, 150ms) same as `scheduleRefit` above — a drag-select
    fires `onSelectionChange` on every extended cell, so only the settled end state is copied.
- **`src/games/`** (026-snake-game-panel) — a control in `.canvas-chrome`'s right side, now first in
  the group (before a `.canvas-chrome-separator` rule, then `PrRailButton`/`SettingsRailButton`; not
  in `.app-rail`): `GamesMenu.tsx` opens a dropdown (`GAMES`, currently just
  `{ id: "snake", label: "Snake", Component: SnakeGame }` — add another game by extending that array,
  no menu rewrite needed) and picking an entry opens `GameWindow.tsx`, a thin `ModalDialog` wrapper
  (no drag/resize — `AgentWindow`'s is unneeded for a small game). `snake/snakeLogic.ts` is the pure
  rule engine (grid movement, wall/self collision, food, score) with an injectable `rng` so
  `snakeLogic.test.ts` can pin food placement; `snake/SnakeGame.tsx` is just a `<canvas>` tick loop
  (`setInterval`, arrow keys, Space to pause/resume, Enter to restart once `state.gameOver`) driven by
  that logic. No score/progress persists across a **close** (×) — that always starts a fresh game.
  **Minimize** (–) is meant to read as "not a close": the trigger button stays `pressed` (it reads "a
  game is running", not "the window is open") until the game is actually closed. 🔴 But `GameWindow`
  does *not* actually keep the game mounted while minimized, despite switching to a `.game-window-minimized`
  hidden `<div>` looking like it should: its return value flips between that `<div>` and a
  `ModalDialog` element, two different root types at the same tree position, so React unmounts and
  remounts `children` (i.e. `SnakeGame`) on every minimize/restore — proven by the DOM canvas node
  changing identity across the toggle. `SnakeGame`'s own doc comment used to claim otherwise; it
  doesn't keep ticking in the background, because it isn't mounted at all while hidden. Real
  persistence is faked instead: `SnakeGame` takes `snapshot`/`onSnapshotChange` props, and `GamesMenu`
  holds the last snapshot in a `useRef` (cleared on `pick()`/close) that a freshly-remounted
  `SnakeGame` reads back as its lazy initial state — so score/snake position/pause all survive a
  minimize→restore round trip, but the snake does not actually keep moving while hidden (nothing is
  running to move it). A future game with its own state must implement the same
  `snapshot`/`onSnapshotChange` contract to survive minimize, or its progress will silently reset
  every restore. `SnakeGame`'s `active` prop (false while minimized) only gates keyboard input.
  🔴 `pressed` alone does nothing — `styles.css` needs a matching
  `.games-menu-button[aria-pressed="true"]` rule (same shape as `.terminal-toggle-button`'s) or the
  button never actually highlights while minimized; that rule was missing until this was fixed. The
  control also has its own color, `--games` (`#4ade80`, the snake body color): the icon is tinted
  green even idle (`.canvas-chrome .games-menu-button`'s `color`), unlike every other rail control
  here, so it stands out from the grey chrome row at a glance — but the border only turns green once
  `aria-pressed` is true, so idle vs. a game actually running still reads as a distinct on/off, not
  one flat look throughout.
- **`src/breadcrumb/`** — `Breadcrumb.tsx`, derived from `ExpansionStore`; renders the deepest
  expanded node path. No longer mounted anywhere: `RootCanvas.tsx`'s `.canvas-chrome` used to show it
  next to `BranchSwitcher`, but on a PR workspace that put an unrelated node-path string (e.g.
  "pr-69 / specs / …") right beside the branch chip, reading as broken/unrelated UI. `RootCanvas`
  now renders a plain `PR #<number> · <head_ref>` label there instead (only when the active
  workspace is a PR — computed via `usePrWorkspaces()` matched against `useActiveWorkspace()`), and
  nothing at all otherwise, since `BranchSwitcher` already covers "which branch" for the main
  workspace. The component/unit tests are kept, unused, rather than deleted, in case a future need
  for a path breadcrumb elsewhere in the chrome comes back. ⚠ `multi-expand-collapse.spec.ts`'s two
  `breadcrumb-current` assertions were dropped with the mount — an e2e locator against an unmounted
  component can only fail, unlike a unit test that renders the component itself.

## Guided tutorial (`web/src/tutorial/`)

When `RootCanvas`'s root node is named `codechroma-tutorial` (the project the desktop launcher's
Tutorial button writes — `TUTORIAL_ROOT_NAME`), `useStartTutorial` closes the project-tree panel and
starts `tutorialStore`. `TutorialChat` (mounted in `RootCanvas`) types out the current step's English
text in a floating chat, glides to the step's `target` CSS selector with an arrow and a pulsing
highlight, and installs capture-phase guards on pointer/click events so only the target (or the chat)
is clickable. Steps live in `tutorialSteps.ts` (`advance: "click"` waits for the target click,
`"next"` shows a button); a step's `onEnter` can prepare state (step 3 expands `dir::backend`).
Current lessons: welcome → open the code tree button → click `backend/service.py` → code sidebar.
Tests: `tutorialStore.test.ts`.

The chat header shows the run-agent icon plus "Stage N of 5 · title" and a 5-segment progress bar
(`StageProgress`); each segment is a button that calls `tutorialStore.goToStage`, which jumps to that
stage's first step. Stages are `TUTORIAL_STAGES` (names only so far); a stage without steps in
`TUTORIAL_STEPS` renders as a disabled "coming soon" segment. All five stages are implemented, and stage 1's first click step resets the tree panel/open files so a jump back replays cleanly.

**Stage 2 (Diagrams)** is scripted on top of two simulations (`tutorialSim.ts`, a non-global store so
it resets with the workspace): a fake wiki build and a fake agent run. While the tutorial runs,
`WikiGeneralNotice` renders a simulated "Generate" (never `status.trigger`) and `DrawDiagramButton`
opens `TutorialAgentMock` instead of `attachAgent`, so no lesson calls a model. `TutorialAgentMock` is
the **real** xterm (`AgentTerminal` -> `useXtermSession`) fed through a `TerminalClientProvider` whose
client is `drawDiagramScript.ts`'s scripted session: it types a Claude Code banner and prompt, asks
"Which diagram would you like?" with arrow-key navigation over `DIAGRAM_CHOICES` (System context, Design patterns, Change impact),
prints scripted work lines on Enter, then runs the real `runRecipeAndLayout(engineClient, <recipe>)`
against the prebuilt `c1.json` / `patterns.json` / `impact.json` that `desktop/src/tutorialProject.ts`
ships, and fits the canvas. The window itself reuses the real `.agent-window` chrome (run-agent icon,
`agent-window-title`, inset terminal well), which the floating `AgentWindow` and the docked
`DockedAgentPanel` now share, so a real agent window and the tutorial's look the same; only the terminal
content differs (the provider's own TUI there, the script here).
`advance: "auto"` steps wait for `advanceTutorialFrom(stepId)`. Gotchas: the panel is hidden, not
unmounted, when the run ends; in dev, React StrictMode's double mount makes xterm log an uncaught
`Viewport.syncScrollArea ... 'dimensions'` error on every terminal open (not specific to the tutorial,
absent from production builds); and the canvas document is stored server-side, so replaying stage 2 on
the same project finds the C1 diagram already placed.

**Prebuilt diagrams are gated and laid out by hand.** `tutorialDiagramGate.ts` wraps the
`EngineClient` (in `EngineClientContext`) so the tutorial project's `c1`/`patterns`/`impact` report
`ready: false` until `tutorialSimStore.reveal(kind)`, which keeps the canvas and the Diagrams panel from
showing or auto-placing them early; the gate stays up for the whole session. `tutorialLayouts.ts` holds
the hand-arranged block positions per diagram (keyed by `meta.recipe_key`; only `patterns` so far) and
`TutorialAgentMock`/`tutorialStageState.ts` feed them to `layerPositionCache.seedLayerPositions` just before
`runRecipeAndLayout`, so every run lands on the same layout.

**Every stage starts from a fixed scene.** When the tutorial reaches the first step of a stage — by
playing on or by jumping on the progress bar — `TutorialAgentMock` calls `applyStageState`
(`tutorialStageState.ts`): `tutorialSimStore.beginStage(stage)` resets every simulated thing (wiki,
agent windows, the pretend agents, the picked feature; `wiki` is already done and acknowledged from
stage 3 on), the inspector, description popup, selection, collapsed layers, code tree and open files
are closed, all diagram layers are removed, and for stages 3-4 only the design patterns diagram is
drawn again with its saved layout (`seedLayerPositions`), so what the user did on a later stage never
leaks into an earlier one. The agents panel goes back to its Diagrams tab (`railResets`) and both
scripted terminals are recreated. `stageReady` turns true shortly after, so step watchers ignore the
setup's own fit animation. A stage opens on its first action, never on a bare "Show me" button.

**Stage 3 (Working with a diagram)** runs on that diagram: the stage opens straight on the move-a-block step, and `TutorialMoveArrow.tsx` blinks a green up arrow above the block and, through `canvas/dragAxisLock.ts` (read by `useDragOffset`), lets it be dragged only that way; the step ends when that drag is released (`reportDragEnd`).
Steps then click the `backend/app.py` block (opens the real
`InspectorPanel`: Show File, drill into functions) and the SQLite block, a conceptual box
(`meta.no_code_reason === "conceptual"`) that opens the description popup instead of code.
`CanvasNodeBox` exposes `data-recipe-key` and `data-no-code` so steps can target boxes that have no
`node_id`; a step's `quiet: true` skips the highlight ring when the target is just the region the user
may use (the whole canvas, the inspector, the popup).

**Stage 4 (Agents and plans)** (its first agent window docks at the left edge, `AGENT_LEFT` in `TutorialAgentMock.tsx`, so the new one fits on the right) adds two pretend agents on top of the real panels. The first agent is
the stage-2 terminal (`createDrawDiagramClient`, built on `scriptedSession.ts`: a `Scene` is a typed
prompt, an optional arrow-key question, scripted work lines and a done line); `tutorialSimStore.scene`
asks it to play the next exchange. `AgentRail` lists the pretend agents (`tutorial-1`, `tutorial-2`)
with the real card markup, and `RootCanvas`'s Run agent starts the second one
(`implementScript.ts`) instead of `attachAgent` while the tutorial runs. The plan is real canvas
data: `tutorialPlan.ts` adds two `pattern` elements with `meta.plan_kind: "add"` (the "PLAN · ADD" top
band) and edges via `patchCanvasDoc`, and when agent 2 finishes `buildPlan` clears the plan meta and
sets the real `node_id`s. The code of both features (`search_todos`/`search`,
`count_open_todos`/`count_open`) already ships in `desktop/src/tutorialProject.ts`, so those ids
resolve. The second diagram is always System context (C1). A `ScriptedClient` remembers unfinished
scenes and replays them when the terminal reconnects (React StrictMode remounts it in dev).

**Stage 5 (Pull requests)** starts from an empty canvas (no agents, no diagrams): a `gh-cli` note
(install the GitHub CLI and run `gh auth login`), then the real `PrRailButton` and `PrDialog`. While the
tutorial runs the dialog talks to `tutorialPr.ts`'s `tutorialPrClient` (one open PR, nothing imported)
and "Open on canvas" calls `finishTutorialPrOpen`, which sets `tutorialSimStore.pr`. The dialog's
"Build the impact diagram right away" box is a real feature too: ticked, `PrDialog` starts an agent in
the new review (`launchAgent(client, pr.id, null, IMPACT_DIAGRAM_TASK)`). In the lesson that box makes
`TutorialAgentMock` open the first agent window at once, a scripted session (`createImpactClient`) that receives the same `IMPACT_DIAGRAM_TASK` and then draws the project's prebuilt impact diagram; Run agent then starts the
scripted explain agent (`explainScript.ts`), and when it finishes `tutorialSplit.ts` splits the
`add_todo` block into three numbered steps (`meta.order`) through `patchCanvasDoc`.

`WikiGeneralNotice` also shows a general "Architecture wiki is ready" notice (text plus a check-mark
button, `wiki-ready-dismiss`) whenever a real generation finishes — not just in the tutorial — and it
stays until the check mark is clicked. The simulated wiki does not write a real wiki-general, so once
the tutorial's simulation is done the notice stays hidden for that session.
