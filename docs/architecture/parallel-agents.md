# Parallel agents (`src/codechroma/bridge/agents/`) — one `claude` per git worktree, or attached

Several Claude sessions at once, each on its own branch in its own `git worktree` by default, each a
window on the canvas. `<main_root>/.codechroma/agents.json` is the registry (it spans every worktree,
so it lives in the main repo); an agent's own artifacts need no special handling — they already sit
in the `.codechroma/` of its worktree.

🔴 An agent can also be created with `attach_to` set to `"main"`, another agent's id, or a `pr-<n>`
id (a PR review workspace, see [`pr-workspaces.md`](pr-workspaces.md)) — this is what the canvas's
single "Run agent" button always sends, targeting whatever workspace the canvas is currently
showing. Every `attach_to` target, PR included, now shares that target's own `branch`/`worktree`
(`AgentManager.create`, via `WorktreeProvisioner.attach_to` for main/an agent, or `pr_target.worktree`
directly for a PR — `AgentManager._pr_target`, wired via `agent_manager.pr_lookup =
pr_manager.find_by_id` in `services.py`) — it skips `worktree.add`/`_install_skills`/`_seed_diagrams`
entirely, so its `claude` process runs in the *same directory* as another live one (or the PR's own
detached checkout). This is deliberate and explicitly requested: two agents attached to the same
worktree can genuinely edit the same files at the same time, with no locking — a later write can
silently clobber an earlier one's in-flight edit, and concurrent `git` commands there can race on
`.git/index.lock`. Nothing in this codebase mitigates that; it is a traded-off risk, not a bug to
fix. A PR's own worktree is a *detached* checkout (`worktree.add_detached`, "no local branch to hold
hostage") — an attached agent inherits that; a commit made there stays on a detached HEAD until
someone explicitly checks out a branch for it, and `AgentRecord.branch` is set to the PR's `head_ref`
as a label only, not a branch actually checked out in that worktree. `WorkspaceRegistry` (see
`graph-bridge-core.md`) aliases the agent id onto the target's (or the PR's) one shared `Workspace` so
the bridge itself doesn't double up file watchers/reanalyze over that directory — including its
`read_only` flag: a PR-attached agent's own interactive "regenerate"/"accept diff" routes stay 409
too, since they resolve to the same read-only `Workspace` instance the PR view uses (the agent's own
file edits, run directly by its `claude` process rather than through the bridge API, are unaffected).
`AgentManager.delete()` refuses to remove a worktree/branch still shared by another record, refuses
removing main's own worktree/branch through an attached agent, and refuses removing a PR's worktree/
branch through an agent attached to it (`_guard_shared_worktree`, keyed off `AgentRecord.source_pr`).

- `worktree.py` — `git worktree add/remove/move/prune` over `git_cmd`, the branch slug (`slugify`
  survives Cyrillic, emoji and 300-char titles, falling back to `agent-<n>`), and
  `worktrees_root(repo_root)`: `$codechroma_WORKSPACES_DIR` when set, else
  **`<repo>/.codechroma/worktrees/<agent-id>`** — deliberately *inside* the repo, so the directory
  that holds a branch hostage sits next to the code instead of in a home-dir path the user has no
  reason to know exists (which is how one worktree silently held a user branch for days). Nesting is
  safe because three separate exclusions already cover `.codechroma`: `live.py`'s `_IGNORED_DIRS`,
  `engine.py`'s `_IGNORED_DIRS`, and the repo's `info/exclude` — and `create()` now calls
  `ensure_excluded` **before** `worktree.add`, since between the two `GitSync` would read the fresh
  worktree as a few thousand untracked files. 🔴 The one hazard nesting adds and cannot remove:
  `git clean -xdf` in the main repo deletes ignored-and-untracked files, i.e. every agent worktree;
  `$codechroma_WORKSPACES_DIR` (which keeps the old `<root>/<repo-slug>/<id>` layout, since one
  external dir serves many repos) is the escape hatch. `legacy_worktrees_root()` exists only for the
  migration below and retires itself.
- `bootstrap.py` — why the feature works on a folder that isn't under git. `git worktree add` is
  impossible without a commit, and an *empty* first commit would hand the agent an empty directory,
  so initialization has to commit real code. `preflight()` returns `ready` / `no-git` / `not-a-repo`
  / `no-commits` / `nested`; `commit_plan()` reports what would land **in its default state** (every
  suspicious path pre-ticked for exclusion, `include=[...]` to keep one). 🔴 An existing `.gitignore`
  is never rewritten — the plan is computed against it and it is left alone.
- `manager.py` — `AgentRecord`/`AgentManager`: atomic (temp+rename) writes, the hard limit of
  **5** agents (`settings.agents.max_agents`, [`config.py`](config-and-prompts.md); a sixth is a
  409), skill install into each new worktree, and startup reconciliation
  (prune, clear dead pids, mark a vanished directory `worktree_lost` rather than dropping the card).
  🔴 `reconcile()` re-runs `install_skills` into every *existing*, present worktree: skills are
  installed once at `create()`, and the launcher's sync (`app.py`) only reaches the *main* repo, so a
  skill added to `SKILL_NAMES` after an agent was made would otherwise never reach that agent's
  worktree. `install_skills` replaces stale copies, so the re-sync is a no-op until a new skill
  appears.
  🔴 No `base_commit` field — see `diff_base()` above.
  `reconcile()` also runs two self-retiring repairs before the prune. `migrate_worktrees()` relocates
  anything still under `legacy_worktrees_root()` into `<repo>/.codechroma/worktrees/`; it iterates
  **git's own `worktree list`, not `agents.json`**, because a worktree can outlive its record (a test
  run left nine of them orphaned), and `worktree.move` falls back to `shutil.move` +
  `git worktree repair` for the cases `git worktree move` refuses (locked, submodules). It is a no-op
  the moment `$codechroma_WORKSPACES_DIR` is set. `_rename_shadowing_ids()` fixes an agent whose id is
  `workspaces.MAIN_ID`: 🔴 `set_active_workspace("main")` passes its guard as *the main repo*, so
  such an agent is unselectable on the canvas and its worktree becomes untraceable — which is exactly
  how the hostage branch above went unnoticed. `_unique_id` now treats `MAIN_ID` as taken, and also
  a leftover worktree or branch from a "×"-closed agent (see "Nothing prunes those" below) — it only
  picks the record's own id, not whether it will share a directory.
- **Runtime skill availability** — `terminal/agents.py` adds the bundled CodeChroma plugin directory
  to Claude Code launches with `--plugin-dir`; this applies equally to provisioned worktrees,
  `attach_to` workspaces, and nested/PR project roots. The plugin points at the same packaged skills
  as `skill_sync`, so the existing copy/reconcile behavior is unchanged. It writes no files into a
  launched project, adds no prompt text, and is not installed in Claude's global plugin directory.
  Plugin skill invocation names combine the plugin name with the skill's declared name, e.g.
  `/codechroma:codechroma-draw-diagram`, leaving project skills and their precedence intact.
  The separate headless `claude -p` pipeline continues to use the unnamespaced, project-synced
  skill commands from its prompts; those prompts are not sent through the runtime plugin.
  Non-Claude providers receive no Claude-specific flags, and a Claude adapter is recognized by the
  resolved provider rather than its executable filename. Frozen desktop builds include the
  manifest beside their bundled skill copies.
- `autostart.py` — `auto_start_agents()`, called from `app.py`'s `lifespan()` right after
  `registry.start_all()`, undoes what `reconcile()` just did: every record `reconcile()` left
  `stopped`/`pid=None` gets its `claude` respawned, so closing and reopening the app (or the desktop
  shell) brings every agent back up instead of leaving a card nothing can start. 🔴 Has to run inside
  `lifespan()`, not `reconcile()` itself: `PtySession.__init__` calls
  `asyncio.get_running_loop().add_reader(...)`, and `reconcile()` runs synchronously inside
  `BridgeServices.create()`, called from `create_app()` — before any event loop exists. Resumes the
  last chat when `AgentManager.capture_session_id()` still has a session id (safe to call
  unconditionally: it only *upgrades* the stored id when a newer transcript exists, never clears it),
  starts fresh otherwise. Skips a `worktree_lost` record (no `cwd` to spawn into) and swallows
  `AgentStartError`/any exception per record (logged, not raised) so one agent missing its worktree or
  `claude` binary never blocks the rest from coming up. No broadcast on success: no websocket is
  attached this early in boot, so a freshly-connecting client just reads live status off `GET /agents`,
  and the status poller (`app.py`'s `_poll_agent_statuses`, started right after) covers every change
  from here on.
- **Branch scope** — which agents belong to the branch main currently has checked out, and the reason
  the branch switcher no longer refuses to work while an agent is focused.
  - `AgentRecord.base_branch` (persisted, `manager._base_branch_for`) is the branch main was on when
    the agent was created; an `attach_to` agent inherits its target's, except a `pr-<n>` `attach_to`,
    which instead gets that PR's `base_ref` (`AgentManager.create`, bypassing `_base_branch_for`
    entirely — a PR's target branch is rarely whatever main happens to have checked out right now).
    This is *not* `record.branch`,
    which for an own-worktree agent is its technical `agent/<id>` and never equals anything main has
    out — so several agents can belong to one feature branch, each still isolated in its own worktree.
    🔴 `None` is the "written before this field" case and means **visible on every branch**; the web
    side folds an absent key into the same thing (`branchScope.baseBranchOf`) — an `undefined` compared
    against a branch name matched none of them, which hid every agent served by an older bridge.
  - `main_branch.switchable_branches()` is what `GET|POST /agents/branch` reports: `list_branches`
    minus every branch a *non-main* worktree holds. Git refuses a second checkout of such a branch, so
    offering one could only ever produce `already used by worktree at ...`; the filter is by held-ness,
    not by the `agent/` prefix, so a hand-made worktree is covered too.
  - `main_branch.checkout()` no longer pre-checks the tree for *any* uncommitted or untracked file —
    it just runs `git checkout <branch>` and lets git decide. Git itself carries forward any change
    (tracked or untracked) that doesn't collide with what the target branch tracks, PyCharm-style; it
    only refuses — and `checkout()` only raises `DirtyWorkingTreeError` — when git's own stderr ends
    in `"before you switch branches"` (its wording for both "would be overwritten" and "would be
    removed"), i.e. a real conflict. `POST /agents/branch` passes that stderr straight through as the
    409's `detail`.
  - Update (PyCharm's Update Project): `POST /agents/branch/update` fast-forwards main's current
    branch from its upstream via `main_branch.update_branch()` (`git pull --ff-only`, run with the
    bridge's long network timeout courtesy of `git_long`) — no merge or rebase commit is ever
    invented, and a diverged branch or missing upstream surfaces git's stderr as a 409 via the
    `GitLongError` table entry. The same 🔴 live-agent-in-main guard as the checkout route applies.
    Because a fast-forward only moves the branch tip (it never changes *which* branch is checked
    out), nothing has to be settled back to main, and only a `branch-changed` ping is broadcast. The
    canvas `BranchSwitcher` gains an `Update` action (→ `updateCurrentBranch` in `branchActions.ts`)
    above the branch list.
  - 🔴 `POST /agents/branch` 409s while a **live** agent's `worktree` is main's own root (an
    `attach_to: "main"` agent): a checkout swaps the files under its running `claude`. Liveness comes
    off `agent_sessions`, not `record.status`, which is stale until `agent_payload` refreshes it. An
    agent in its own worktree is unaffected by main's checkout — that is the whole point of worktrees —
    and is deliberately not guarded.
  - Canvas side: `BranchSwitcher.tsx` re-fetches `GET /agents/branch` every time it *opens*, not just
    at `AgentWindowLayer`'s mount — a branch created or deleted from a terminal (or another window)
    between opens must not leave the dropdown showing a stale list. The fetch runs in the click
    handler, not inside the `setOpen` updater, so an open always triggers it exactly once. A
    `branch-changed` ping (an external checkout in another window) also re-reads the full list, not
    just the ping's current branch — the ping names the branch, not the branches, so it can't rebuild
    the list on its own. `branchScope.ts` owns the single
    predicate (`isAgentOnBranch`), `branchActions.ts`'s `switchBranch` the single manual-checkout path
    (only `BranchSwitcher.tsx` calls it now), and the last failure lives in `branchStore` so the
    switcher's own modal is the one place a checkout failure ever surfaces.
    🔴 **Opening an agent's window is no longer coupled to a checkout at all.** It used to be
    (`openAgentOnItsBranch`: check the agent's `base_branch` out on main first, *then* restore the
    window) — removed after an incident where a dirty main tree made that checkout fail, and keep
    failing on every retry, permanently trapping the window behind `display: none` with no reachable
    close button (the rail's only click action was retrying the same failing checkout). An agent's own
    worktree is untouched by whatever main has checked out either way, so there was no technical
    reason for the coupling. `AgentWindow` no longer ORs `isAgentOnBranch` into its `hidden` check at
    all — visibility is `minimized`, full stop, for every agent regardless of branch.
    `isAgentOnBranch`/`baseBranchOf` still exist, purely for the rail's own dimmed/`on <base_branch>`
    display (below) and for `settleActiveWorkspace` (hands the canvas back to main when the *active
    workspace* it was drawing — a separate concept from window visibility — goes out of scope,
    including on a `branch-changed` ping from another browser window).
  - An out-of-scope agent keeps its rail row, dimmed (`.agent-rail-item-off-branch`) and labelled
    `on <base_branch>` purely as information; clicking it minimizes/restores its window exactly like
    any other agent's row, never a checkout. ⚠ A hidden agent whose row disappeared too would be
    unreachable and easy to forget while it still runs — that's still true, it just no longer needs a
    branch match to reach the window itself. An off-branch row also carries its own close button
    (`.agent-rail-close`, `AgentRail.tsx`) beside the card — a quick way to remove such an agent
    without opening its window first, kept from the incident fix above even though every window is
    reachable again now.
- `diagram_seed.py` — copies main's `.codechroma/{c1,patterns}.json` (+ their `-layout.json` siblings)
  into a new agent's worktree once, at `create()` time (`_seed_diagrams`, right after
  `_install_skills`), so a fresh agent opens with main's last diagrams instead of the canvas seeing
  `has_diagram: false` and auto-firing a background `claude -p` regeneration the moment its Patterns/
  C1 view mounts. Reads paths off `diagram_registry.DIAGRAMS`' own `artifact_path`/`layout_path`
  callables rather than re-deriving them, so a new `DiagramSpec` entry is seeded for free. 🔴 Not the
  same mechanism as `workspaces.py`'s `c1_source_root`: a PR workspace *permanently borrows* main's
  C1 because a PR never diverges from what it reviews, while an agent branch is meant to diverge, so
  this seeds a real, independent copy the agent then owns — the existing stale/fingerprint check
  already used for post-generation edits is what later tells the agent's own diagram apart from
  main's.
- `sessions.py` — `AgentSessionRegistry`, the long-lived PTYs. A session outlives any one WebSocket,
  so reloading the page never kills an agent. 🔴 **A reattach is a redraw, not a replay.** There is
  deliberately no scrollback buffer: any bounded byte buffer is truncated at an arbitrary offset, so
  the replay can start mid-CSI, and the sequences that *establish* screen state (alt-screen enter,
  scroll region, bracketed paste, the opening SGR) are the oldest bytes and the first evicted — the
  new xterm then sits in default mode while the agent believes it is on the alt screen. `attach()`
  instead queues `ScreenTap.render()`, an escape-sequence redraw of the `pyte` screen the status
  detector already maintains, and `resync()` repeats it once the client reports its own geometry
  (`terminal/server.py`'s `_bridge_managed_session`). Trade-off, on purpose: a reattach shows the
  current screen, not history above the fold. 🔴 Entirely separate from `skill_agent`'s registry: if
  the two touched, regenerating a C1 diagram would kill the user's sessions. `atexit` + the lifespan
  kill leave no orphans. `agent_run_env(agent_id)` injects `codechroma_WORKSPACE_ID=<agent id>` into
  the PTY env (both `routes/agents.py`'s `start` and `autostart.py` pass it via
  `AgentSessionRegistry.start(..., env=...)` → `PtySession(env=...)`). Without it the diagram skills
  fall back to the `default` (main) workspace and write `.codechroma/*.json` into main while the agent
  works in its own worktree — a change the canvas never reads, and the agent's own workspace can't
  either.
- **Provider-routed windows (`agent` kind, 061).** A record created as `kind="agent"` resolves its
  CLI at launch through the LLM provider mechanism instead of the fixed `effective_cli`. `launchAgent.ts`
  (and `attachAgent.ts`, which forwards into it) always requests this kind now — the one-click "Run
  agent" button, PR-review attach, and the diagram task flow all go through it; there is no UI path
  left that creates a plain `claude` record (only direct API use still can, since the backend still
  defaults `kind` to `"claude"` when a caller omits it). Both
  `routes/agents.py`'s `start` and `autostart.py` now call `agent_cli(record.kind, …)`
  (`terminal/agents.py`), which routes `kind="agent"` through `llm/resolve_cli` under the
  `parallel_agents` call site's `agents` group and folds resume/initial-prompt into the argv (so a
  `"task"` context first message still reaches an `agent` window). The caller merges the resolver's
  env overrides under `agent_run_env`'s `codechroma_WORKSPACE_ID`, so the workspace id wins any
  collision. The resolved binary is stored back on the record as `resolved_cli` (persisted,
  additive), surfaced via `to_payload` so the window/rail can show which CLI actually launched. A
  plain `claude` record (FR-012) is untouched: it takes the assistant's `effective_cli` directly and
  leaves `resolved_cli` empty, which the front end maps back to the `claude` label. The status
  detector for an `agent` window holds (no `detect/agent.toml`) — never wrong, just never classifies;
  a future `detect/<adapter>.toml` can be added per-adapter.
- **Current-view context on launch.** A user-launched agent (the canvas's single "Run agent" button,
  always attached to the active workspace) gets a short acknowledge-only line telling it what the
  user is currently looking at — active view and the
  focused item (e.g. the epic open in the AI brief plus its `source_ref`, the C1 system name +
  description, the patterns count, or the custom-diagram title). It is built on the frontend from
  state already loaded at click time (`web/src/agents/viewContext.ts::buildViewContext`), kept in the
  workspace-scoped `viewContextStore`, and carried to the bridge as `POST /agents`' `context` field,
  which `AgentManager.create(..., context=...)` persists on the `AgentRecord`.
  🔴 **Delivered once, only on a fresh start, only via the route.** `POST /agents/{id}/start` calls
  `AgentManager.consume_context()` (which clears the field so a resume/restart never re-injects) and,
  on a fresh (non-resume) start, calls `session.inject_when_idle(text)` — a public `AgentSession` /
  `AgentSessionPort` method that spawns a background task polling the session's own rendered
  `ScreenTap` tail for the Claude idle prompt (the `❯` line, the same rule `detect/claude.toml` uses)
  and then types the line as a normal user message, giving up quietly (never typing into a
  `working`/`blocked` agent) if it never idles. Because injection is wired only in the route,
  `autostart.py` (which spawns via `agent_sessions.start` directly) never
  injects — correct, since there's no live view at boot. Tunables: `agents_routes`
  `context_inject_attempts` / `context_inject_interval_seconds`.
  🔵 **`context_kind` now splits both the wrapping and the delivery.** `AgentRecord.context_kind`
  (`"view"` default, or `"task"`) rides alongside `context`; `consume_context()` returns both as a
  `(text, kind)` pair, called up front in `post_agent_start` (before argv is even built) rather than
  after the PTY comes up. `"view"` keeps the acknowledge-only `inject_when_idle` path above. `"task"`
  skips PTY injection entirely: its text is passed straight to `agent_cli(..., initial_prompt=text)`
  (`terminal/agents.py`), which appends it as a positional argv entry for the `claude` binary — so the
  CLI process starts already answering it, and the window the user opens already shows the agent's
  question instead of an empty prompt waiting on idle-detection. `DrawDiagramButton`'s "Draw…" button
  (see `single-canvas.md`) is the one caller today: `attachAgent`/`launchAgent` accept an optional `task`
  string that, when given, takes priority over `context` and is sent with `contextKind: "task"`.
  🔴 **`context` is control-character-free by construction** (`manager._clean_context`, applied in
  both `create()` and `AgentRecord.from_json`, so a record persisted by an older build is cleaned on
  load too) — this still matters for `"view"`, whose text is typed into a **live PTY**: every C0 char
  (CR, LF, ESC), DEL and C1 is a real keystroke, so a newline would submit the message early and an
  ESC would drive the TUI itself. They're replaced with a space (not dropped — "a\nb" must stay two
  words) and the result is whitespace-collapsed to one line, leaving an empty string as `None`.
  `"task"` text no longer passes through a PTY at all — it's an OS argv entry, not keystrokes — but
  stays just as clean since the same `_clean_context` runs on every `context` regardless of kind.
- `status.py` + `detect/claude.toml` — the LED. Three sources, first rule wins: the foreground
  process (not the agent → `foreign`, hold the last value), OSC title/`9;4` progress, then the bottom
  N lines of the **rendered** screen (`terminal/screen_tap.py`, a `pyte` screen the PTY feeds).
  Rules live in TOML so a Claude TUI change is a data fix. 250 ms hysteresis, ≤4 pushes/second.
  🔴 Unknown means *hold*, never `idle`; a malformed manifest degrades to "always hold".
  ⚠ The manifest is a runtime data file, so it is read through `resources.py`'s `resource_path`
  (kind `"detect"`) and shipped by `packaging/bridge.spec` — otherwise it 404s in the frozen app.
- `transcripts.py` — the `claude --resume` session id. 🔴 The `~/.claude/projects/<escaped>` name is
  **not guessed**: a wrong escape would silently start a *fresh* conversation. Every transcript
  records its own `cwd`, so the id is read from the newest one whose `cwd` is this worktree.
  🔴 `cwd` alone can't tell two `attach_to` siblings apart (they share one worktree by design — see
  above), so `find_session_id` takes an `exclude` set and `AgentManager.capture_session_id`
  (`manager.py`'s `_sibling_session_ids`) feeds it every *other* record's already-claimed
  `session_id` for that same worktree. Without this, restarting/resuming the sibling that hasn't
  been touched most recently would silently resume the other one's live conversation instead of
  starting fresh — clicking that agent's rail card looked like "the wrong agent's session opened."
- `publish.py` — "Create PR": `git push -u origin <branch>` then `gh pr create --fill`. Every
  blocker is a preflight reason the button renders **as its disabled label**, never a post-click
  error. Uncommitted files are not a blocker but a forced choice (commit them, or publish without).
  `gh` runs in its own process group so a timeout kills what it spawned too. There is deliberately
  **no local merge** — that would be the first time the app wrote into the user's working copy.
- Lazy bring-up: an agent workspace is built on **first access**, not at creation. `Workspace.analyze`
  seeds the new engine from the main checkout's parse (`GraphEngine.seed`) and `reanalyze()`s only the
  divergent files, so switching a 50k-line repo takes seconds. No cache (main not analyzed yet) → an
  honest full analyze with `state: "analyzing"` reported, never a silent wait. Idle workspaces unload
  after 10 minutes, keeping `.codechroma/graph.db`.
- ⚠ The bridge writes `.codechroma/` and its three installed skills into the repository's
  `info/exclude` (`git_cmd.ensure_excluded`). `--git-path` resolves to the **common** git dir even
  from a linked worktree, so this covers every checkout — deliberate: without it every agent worktree
  is permanently dirty, its diff layer opens full of our own files, and `git worktree remove` always
  needs `--force`. It is untracked and local, never committed or shared.
- Routes: `GET|POST /agents`, `DELETE /agents/{id}?worktree=&branch=&force=`,
  `POST /agents/{id}/{start,stop,recreate-worktree,pr}`, `PATCH /agents/{id}/window`,
  `GET /agents/{id}/pr-preflight`, `GET /agents/git-preflight`, `POST /agents/git-init`,
  `POST /workspaces/{id}/activate`, `GET /workspaces/{id}/status`. Lifecycle pings
  (`agent-added`/`agent-removed`/`agent-status`/`workspace-activated`) travel over the existing
  `WS /repos/{id}/events` — no new socket.
- 🔴 Agent processes start **from the bridge**, never the renderer: that is the only way they inherit
  the PATH `desktop/src/shellPath.ts` repairs, without which a Finder-launched app can't find
  `/opt/homebrew/bin/claude`. `WS /ws/terminal?agent=claude&workspace=<id>` *attaches* to the managed
  session (resolved from `websocket.app.state.services.agent_sessions`, the per-app
  `AgentSessionRegistry`); with no `workspace`, it spawns a per-socket PTY exactly as the plain
  terminal panel always has.
  If creating an agent succeeds but starting its process fails (for example, `claude` is missing from
  the bridge's PATH), the canvas opens that agent's window and renders the launch error in its own
  terminal area; the unrelated app shell terminal is not opened.
- Canvas side: `web/src/agents/`. `AgentWindowLayer` is `position: fixed` **above** `.canvas-stage` —
  screen coordinates on purpose, so a window never scales with zoom. ⚠ Not registered with feature
  002's `collisionStore`: different coordinate space, explicitly out of scope there. 🔴 Minimizing
  uses `display: none` and the layer renders **every** agent, minimized or not — it used to filter
  them out before rendering, which unmounted the xterm and made each restore a full reattach; the
  CSS, the comment in `AgentWindow.tsx` and `AgentWindow.test.tsx` all assumed otherwise, and only
  `AgentWindowLayer.test.tsx` + `e2e/agent-windows.spec.ts` now pin it. The LED colour map lives once
  in `styles.css` under `.agent-led-*`, and `App.tsx` passes `useActiveWorkspace()` as the engine
  client's `repoId`, so switching agents moves **every** canvas request at once. `HttpEngineClient`
  drops pings whose `workspace` isn't the one it is drawing (absent key = `main`). The layer also
  carries `data-active-workspace` for the e2e specs: once a workspace is `ready` nothing on screen says
  which one it is, and the spec used to infer it from the branch switcher being disabled — a proxy that
  stopped existing when the switcher became usable everywhere.
- A window can be docked into the resizable left-side `AgentTerminalDock` in `.canvas-main-row`.
  `agentDockStore` keeps a session-local ordered list of attached agent ids and the selected tab;
  every docked terminal stays mounted while switching tabs. Docking hides the floating window without
  persisting `minimized`, so after reload it naturally returns as a window. Detach removes that tab
  and opens the agent window; the tab's close action follows the normal `closeAgentWindow` flow.
- `AgentRail` renders its own full-height panel (`.agent-task-rail`, header "AGENT TASKS" + a count
  chip) beside `.canvas-stage` inside `.canvas-main-row` — a sibling of the canvas, not a rail/toolbar
  item, so cards have room for more than an icon. It is the **only** always-visible list of agents:
  one two-line card per agent for its whole lifetime (bold title, then a status/branch caption), so
  the list's shape never changes — clicking toggles minimize/restore (`minimizeAgentWindow` /
  `restoreAgentWindow`, uniformly, never a checkout — see "Branch scope" above) and `aria-pressed`
  means a floating window is open or the agent is docked. Clicking a docked row switches the selected
  terminal tab. An agent belonging to another branch reads as dimmed here
  (`.agent-rail-item-off-branch`) and captioned `on <base_branch>` instead of its status, purely as
  information; its click behaves exactly like any other row's. 🔴 A row can also carry a small accent
  dot (`.agent-rail-diagram-badge`, test id `diagram-ready-<id>`, from `agentStore.diagramsReady`):
  a "Draw a diagram" task launched from a **read-only PR workspace** is forked into its own worktree,
  so its artifact lands where the canvas is not looking and the agent finishes with nothing on
  screen. `agents/agentDiagramsReady.ts` checks that agent's *own* workspace on the working→idle
  transition and badges the row; the click clears it and activates that workspace, where
  `DrawDiagramButton`'s watcher adds the diagram by itself. It is skipped when the agent already shares the
  active workspace. See [`diagram-skills.md`](diagram-skills.md). Minimizing
  therefore adds **nothing** to the screen; there used to be a second widget, `AgentDock`, a
  readable-title strip of the minimized ones in the bottom-left corner, and it was removed as a
  redundant duplicate of the rail card (`AgentWindowLayer.test.tsx` and `e2e/agent-windows.spec.ts`
  both assert the corner stays empty on minimize). ⚠ The card's status dot is a bare
  `<span class="agent-led …">`, **not** `<AgentLed>`: that component sets a native `title`, which
  would raise a second OS tooltip inside a button whose whole point is `.rail-tooltip` — which, since
  the panel sits at the viewport's right edge, opens downward (`.agent-task-rail .rail-tooltip`)
  rather than flying right off-screen. `.agent-rail-item` is a plain unscoped rule now (the panel is
  its only parent), and the pressed rule outranks `:hover` so an open agent keeps its accent. 🔴 The
  tooltip only drops to `top: calc(100% + 6px)` on `:hover`/`:focus-visible`, the same rule that flips
  it visible — parked there permanently (even while `visibility: hidden`) it still occupies layout
  space past the last card, which inflated `.agent-task-rail-body`'s `scrollHeight` and forced a
  scrollbar even with a single agent; at rest it now sits at `top: 0`, inside the button's own box.
  `.agent-task-rail-body` also carries its own thin, dark `::-webkit-scrollbar`/`scrollbar-color`
  styling rather than the browser default.
- 🔴 **`AgentRail`'s "Diagrams" tab is the one place a diagram is shown and managed** — the
  diagram-management unification retired the old "Add a picture" dropdown's (`RecipeMenu.tsx`, now
  `canvas/doc/DrawDiagramButton.tsx`) listing/toggle job onto this tab; that button now only launches
  a drawing agent (see `single-canvas.md`'s `RecipeMenu.tsx`/`DrawDiagramButton.tsx` section). Two
  sections (`.agent-task-rail-tabs`, ad hoc `role="tablist"` local state — same pattern as
  `LlmSettingsPanel`'s section tabs, no shared `Tabs` component exists in this repo):
  - **On canvas** — one row per diagram layer currently placed (`listActiveDiagramLayers(doc)`,
    `canvas/doc/diagramCatalog.ts` — shared with `DrawDiagramButton`'s `BUILTIN_RECIPES`/label lookup
    so both agree on what counts as a diagram and what it's called). Clicking a row toggles
    `collapsedLayersStore.toggle(layer)` (`canvas/doc/collapsedLayersStore.ts`) instead of opening a
    window: collapsed hides that layer's elements/edges from `CanvasDocView` without deleting anything
    from `CanvasDoc`, so re-expanding is instant and keeps whatever position the diagram was laid out
    or dragged to. Each row also carries one button: a hard delete (`deleteDiagramAndRefresh`, behind
    `DeleteDiagramDialog`'s confirm — also deletes the on-disk artifact). Collapse hides, delete
    destroys the artifact — both reachable from one row.

  🔴 The mount guard covers both lists: `AgentRail` returns `null` only when `agents.length === 0 &&
  diagramLayers.length === 0`, so a workspace with an on-canvas diagram and no agents still shows the
  panel (defaulting to the Diagrams tab).
- 🔴 Minimize/restore lives in `agents/windowActions.ts`, not at the call sites. Restore used to be
  store-only in the panel while minimize persisted through `PATCH /agents/{id}/window`, so reopening a
  window and reloading brought it back minimized. All three call sites (window title bar, rail, panel)
  now go through `minimizeAgentWindow` / `restoreAgentWindow`, and restore folds in `bringToFront` so
  a reopened window lands on top.
- 🔴 `restoreAgentWindow` also switches `agentStore`'s active workspace (see `App.tsx`'s
  `resetWorkspaceStores` call above), which clears every workspace-scoped store — `epicsFocusStore`
  included — on the assumption that a new active workspace means genuinely different underlying data.
  That's wrong for an attached agent: per the `attach_to` note above, it's aliased onto the *same*
  `Workspace` as whatever it attached to, so switching to its id and resetting the canvas was pure
  churn, and visibly broke the "Run agent" button's always-attach launch — it silently dropped
  whatever the Epics view (or any other workspace-scoped view) was focused on. `launchAgent.ts` now
  always goes through the new `openAgentWindow` (`windowActions.ts`) after creation, which
  unminimizes/raises the window without touching the active workspace; every remaining caller
  supplies an explicit `attachTo`, so the workspace-switching `restoreAgentWindow` is never reached
  from launch. Rail clicks (`AgentRail.tsx`, restoring a minimized
  agent directly, no checkout in between) are unaffected — clicking an existing agent in the rail is a
  deliberate "go look at this one" and still follows through `restoreAgentWindow`. `restoreAgentWindow` itself now also
  skips the workspace switch when the restored agent **shares** the current workspace (an attached
  agent reads the frontend's `AgentRecord.shares_workspace_with`): restoring such a minimized
  window renders the same data, so re-activating its id would again trip `resetWorkspaceStores` and
  drop the Epic focus — the same bug the `launchAgent` change fixed, hit from the rail/notification
  restore path instead. The same skip now also covers an agent forked from the current PR
  (`AgentRecord.source_pr === active`): it shares nothing with the PR worktree (its own branch/worktree,
  per `pr-workspaces.md`), yet reopening it is still a child-of-the-PR action, so the canvas must stay
  on the PR being reviewed rather than yanking away to the agent's id. `restoreAgentWindow`'s own
  `client.activateWorkspace` failure used to be swallowed silently ("best effort"); it now reports
  through `agentStore.setLaunchError`, since a failed activation with no feedback reads to the user as
  a rail click that did nothing.
- There is no more `AgentPanel`/`.agent-corner` wrapper — it was removed as a redundant duplicate of
  the rail card (see `AgentRail` above). Each `AgentWindow` (and `WorkspaceStatusBanner`) is now a
  direct child of `.agent-layer` itself, not of an inner flow box. ⚠ `.agent-layer > *` re-declares
  `pointer-events: auto` on exactly those direct children while the layer itself stays
  `pointer-events: none`, so the canvas underneath keeps receiving clicks everywhere no window covers
  it. (`GitInitDialog` doesn't need this: `ModalDialog` portals it to `<body>`, outside `.agent-layer`
  entirely — see below.)
- 🔴 `GitInitDialog` goes through `agents/ModalDialog.tsx`, which **portals it to `<body>`** — a
  window's `zIndex` is `agentStore.bringToFront`'s ever-growing counter, so a dialog rendered inside
  `.agent-layer` would eventually lose the numbers race and paint *behind* the window it belongs to;
  the fixed `z-index: 200` on `.agent-dialog-backdrop` only has to beat the other top-level overlays
  (`.code-popup-backdrop` is 100). The wrapper also makes it modal in behaviour, not just in looks:
  focus moves in and is restored on unmount, Tab is trapped, Escape cancels (suppressed while the
  request is in flight), and the backdrop absorbs every click aimed at what's underneath.
- ⚠ An agent window's title bar has **three** controls: "⇤" (dock on the canvas), "–"
  (`minimizeAgentWindow`) and "×"
  (`closeAgentWindow`, `agents/windowActions.ts`). "×" closes the session, removes the card, and calls
  `DELETE /agents/{id}` with **no** query flags by default — the worktree directory and the `agent/<id>`
  branch are left exactly as they are, so the work can be picked back up by attaching a new agent to
  that surviving branch (`attachAgent.ts`). The one exception: when the closing agent is the **last
  one on its own worktree** (own directory, not shared via `attach_to`/PR, not already `worktree_lost`),
  "×" instead opens `CloseAgentDialog` (`AgentWindowLayer`), a confirmation whose "delete worktree"
  checkbox is **off by default** — only on an explicit tick does it send `worktree=true` to the endpoint
  and remove that now-orphaned directory. The `agent/<id>` branch is **never** deletable from the UI:
  the dialog has no branch checkbox. A stopped agent is closed, not revived. ⚠ Not via `BranchSwitcher`:
  a leftover (non-deleted) worktree still holds that `agent/<id>` branch, so `switchable_branches`
  filters it out of the list (it only reappears once that directory is removed). 🔴 Deliberately not
  auto-pruned: branches and directories the user chose to keep accumulate until cleaned by hand
  (`git worktree remove` / `git branch -d`) — the non-deleted close still leaves them, that is the
  deliberate trade for "× deletes nothing by default". `_unique_id` (`manager.py`) checks
  `worktree.list_worktrees`/`list_agent_branches` before handing out a slug, so a same-titled agent
  created after a "×" close gets `<slug>-2` instead of colliding with the leftover `agent/<slug>` branch
  or worktree — this is what used to surface as
  `fatal: '<branch>' is already used by worktree at '<path>'` from `worktree.add`.
- Tests: `tests/unit/test_{workspaces,agent_worktree,agent_manager,agent_bootstrap,agent_status,
  agent_publish,agent_transcripts,screen_tap,git_diff_base,diagram_seed}.py`,
  `tests/unit/test_bridge_{agents,workspace}_route.py`, `tests/unit/test_bridge_agents_autostart.py`,
  `tests/integration/test_{workspace_switch,nested_worktree_excluded}.py`,
  `web/src/agents/*.test.{ts,tsx}`,
  `web/src/engine-client/workspacePings.test.ts`, `web/e2e/agent-windows.spec.ts`.
