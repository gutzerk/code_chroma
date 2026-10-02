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
