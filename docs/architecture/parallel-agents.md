# Parallel agents (`src/codechroma/bridge/agents/`) — one `claude` per git worktree, or attached

Several Claude sessions at once, each on its own branch in its own `git worktree` by default, each a
tab in the canvas's agents panel. `<main_root>/.codechroma/agents.json` is the registry (it spans every worktree,
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
    close button (the then-rail's only click action was retrying the same failing checkout). An agent's own
    worktree is untouched by whatever main has checked out either way, so there was no technical
    reason for the coupling. The agent tab never consults `isAgentOnBranch` for visibility — every agent
    is reachable regardless of branch (the floating `AgentWindow` this once guarded was replaced by the
    agents panel).
    `isAgentOnBranch`/`baseBranchOf` still exist, purely for the agents panel's dimmed off-branch tab
    (`agents-tab-off-branch`) and for `settleActiveWorkspace` (hands the canvas back to main when the *active
    workspace* it was drawing — a separate concept from window visibility — goes out of scope,
    including on a `branch-changed` ping from another browser window).
  - An out-of-scope agent keeps its tab in the agents panel, dimmed (`.agents-tab-off-branch`) purely
    as information; selecting it behaves exactly like any other tab, never a checkout. The old
    `on <base_branch>` caption and the per-row close button of the removed `AgentRail` card are gone;
    close is the `×` in `AgentHeader` (below).
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
  additive), surfaced via `to_payload` so the agents panel header can show which CLI actually launched. A
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
  (kind `"detect"`) and (for any bundled bridge) must be shipped next to it — otherwise it 404s there.
- `transcripts.py` — the `claude --resume` session id. 🔴 The `~/.claude/projects/<escaped>` name is
  **not guessed**: a wrong escape would silently start a *fresh* conversation. Every transcript
  records its own `cwd`, so the id is read from the newest one whose `cwd` is this worktree.
  🔴 `cwd` alone can't tell two `attach_to` siblings apart (they share one worktree by design — see
  above), so `find_session_id` takes an `exclude` set and `AgentManager.capture_session_id`
  (`manager.py`'s `_sibling_session_ids`) feeds it every *other* record's already-claimed
  `session_id` for that same worktree. Without this, restarting/resuming the sibling that hasn't
  been touched most recently would silently resume the other one's live conversation instead of
  starting fresh — clicking that agent's card looked like "the wrong agent's session opened."
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
  (`agent-added`/`agent-removed`/`agent-status`) travel over the existing
  `WS /repos/{id}/events` — no new socket.
- 🔴 Agent processes start **from the bridge**, never the renderer: that is the only way they inherit
  the PATH the bridge's `RuntimeEnvironment` captures from the user's login shell (see [`runtime-environment.md`](runtime-environment.md)), without which a Finder-launched app can't find
  `/opt/homebrew/bin/claude`. `WS /ws/terminal?agent=claude&workspace=<id>` *attaches* to the managed
  session (resolved from `websocket.app.state.services.agent_sessions`, the per-app
  `AgentSessionRegistry`); with no `workspace`, it spawns a per-socket PTY exactly as the plain
  terminal panel always has.
  If creating an agent succeeds but starting its process fails (for example, `claude` is missing from
  the bridge's PATH), the canvas opens the agents panel on that agent and renders the launch error in its own
  terminal area; the unrelated app shell terminal is not opened.
- Canvas side: `web/src/agents/` and `web/src/shell/`. 🔴 **The floating agent windows, the rail
  cards, the left-docked terminal dock and the LED strip no longer exist** (`AgentWindow`, `AgentRail`,
  `AgentTerminalDock`, `AgentLedStrip`, `agentDockStore` and the Ctrl/Cmd+Shift+O dock shortcut were
  deleted in the shell redesign). Agents live in one right-hand **agents panel**, see below.
  `AgentWindowLayer` survived with a narrower job: it is the agent *sync and dialog* layer
  (`.agent-layer`, `data-active-workspace` for e2e) and renders no terminals. It fetches the agent
  list and branch on mount, applies `subscribeAgents` pings in place (`agent-added`/`agent-removed`/
  `agent-status`, `branch-changed`, `branch-removed`; a status flip must not rebuild the list and
  remount every terminal), fires desktop notifications (a notification click calls
  `shellStore.openAgent(id)`, which reopens the panel on that agent), and hosts `WorkspaceStatusBanner`,
  `GitInitDialog` and `CloseAgentDialog`. The LED colour map lives once in `styles.css` under
  `.agent-led-*`, and `App.tsx` passes `useActiveWorkspace()` as the engine client's `repoId`, so
  switching agents moves **every** canvas request at once. `HttpEngineClient` drops pings whose
  `workspace` isn't the one it is drawing (absent key = `main`).
- 🔴 **A window owns its active workspace.** `agentStore.workspaceChosen` is set by a `?workspace=` URL
  param or any `setActiveWorkspace` call, and once set `setList` ignores the bridge's
  `active_workspace` — otherwise a second window on the same project (a PR tab, a branch tab) would be
  dragged onto whatever the first one last opened. The bridge no longer pushes `workspace-activated`
  at all; the persisted value only seeds a window that names no workspace. The desktop shell always
  names one (`?workspace=main` for a repo tab), see [`desktop-app.md`](desktop-app.md).
- **Agents panel** (`web/src/shell/AgentsPanel.tsx`, one panel always on the right; geometry and mode
  in `shellStore.agents`, see [`web-canvas-shell.md`](web-canvas-shell.md) "Shell layout"):
  - `normal`: a tab per agent (`role="tab"`, `AgentLed` + title, `agents-tab-<id>`), the active agent's
    `AgentHeader`, then `AgentTerminalBody` for every agent (all stay mounted, only the active one is
    unhidden, so PTY scrollback and the attach survive tab switches). The active id is
    `shellStore.agents.activeId` if that agent still exists, else the first. With no agents the panel
    shows "No agents running." and a Run agent button (`RootCanvas.runAgent`). It is resizable from
    its left `EdgeHandle` (340-720px, persisted), which carries ‹ (full screen) and › (collapse).
  - `full` (`AgentsFullscreen.tsx`): every agent as an equal-width column (a `ceil(sqrt(n))`-column
    grid from four agents up), each with its title, `AgentHeader` and terminal; › (or Esc) returns to
    `normal`.
  - `collapsed` (`AgentsCollapsedStrip.tsx`, 44px): `a1..a5` buttons with a status LED that reopen the
    panel on that agent (`shellStore.openAgent`), a `+n` menu for agents past five, and a lone ‹ when
    there are no agents. The panel slot is only `hidden`, so terminals stay mounted.
  - `AgentTerminalBody.tsx` is the old window body: `AgentTerminal` (xterm carries the input line) or,
    for `worktree_lost`, the "worktree is gone. Close the agent and create a new one." notice.
  - Code overlay: `CodeOverlay` renders over the panel body (`.agents-panel-overlay`); the terminals
    underneath stay mounted and closing it leaves the agents state alone.
  - `AgentHeader.tsx` carries the controls of the old window title bar that still apply: the resolved
    CLI, the branch, a "worktree lost" warning with **Recreate** (`agentClient.recreateWorktree`), the
    Create PR button (`CreatePrButton`, hidden for lost worktrees and PR-forked agents) and **×**.
    There is no minimize or dock any more.
  - Launching (`launchAgent.ts`) still ends in `openAgentWindow(client, id)`, which persists
    `minimized: false` and a z to the bridge; the panel does not read either field, and the other
    geometry helpers in `windowActions.ts` (`minimizeAgentWindow`, `persist`) have no UI caller left.
    The bridge-side window fields stay.
- 🔴 The Diagrams tab moved: diagrams are listed and managed in the **left panel's Diagrams tab**
  (`shell/DiagramsTab.tsx`, see [`single-canvas.md`](single-canvas.md)), no longer in an `AgentRail`
  tab. Its row's eye toggles `shellStore.hiddenLayers` (hide, not the old collapse) and its delete
  action still goes through `deleteDiagramAndRefresh` behind `DeleteDiagramDialog`.
- ⚠ The `diagramsReady` badge (`agentStore.diagramsReady`, `agents/agentDiagramsReady.ts`, set on the
  working-to-idle transition of a "Draw a diagram" task forked from a read-only PR workspace) is still
  computed by `AgentWindowLayer`, but the `AgentRail` row that showed it (`diagram-ready-<id>`) is
  gone; no agents-panel UI renders it today.
- 🔴 `agents/windowActions.ts` still owns `restoreAgentWindow`'s workspace-switch rules (no UI caller
  now): switching the active workspace to an agent's id clears every workspace-scoped store, which is
  wrong for an agent that **shares** the current workspace (`AgentRecord.shares_workspace_with`, an
  `attach_to` agent) or was forked from the current PR (`source_pr === active`), so those skip the
  switch; a failed `activateWorkspace` reports through `agentStore.setLaunchError`. `launchAgent.ts`
  goes through `openAgentWindow`, which never touches the active workspace, so "Run agent" keeps
  whatever Epic focus was set.
- `WorkspaceStatusBanner` is a direct child of `.agent-layer`; ⚠ `.agent-layer > *` re-declares
  `pointer-events: auto` on it while the layer itself stays `pointer-events: none`.
- 🔴 `GitInitDialog` goes through `agents/ModalDialog.tsx`, which **portals it to `<body>`** , so
  it paints above the floating shell panels regardless of where `.agent-layer` sits; the fixed
  `z-index: 200` on `.agent-dialog-backdrop` only has to beat the other top-level overlays. The wrapper also makes it modal in behaviour, not just in looks:
  focus moves in and is restored on unmount, Tab is trapped, Escape cancels (suppressed while the
  request is in flight), and the backdrop absorbs every click aimed at what's underneath.
- ⚠ `AgentHeader`'s **×** (`closeAgentWindow`, `agents/windowActions.ts`; the old title bar's dock and minimize buttons are gone) closes the session, removes the tab, and calls
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
  `web/src/shell/Agents*.test.tsx`, `web/src/engine-client/workspacePings.test.ts`, `web/e2e/agents-panel.spec.ts`.

## Canvas questions (017)

Claude agents launch with the CodeChroma MCP server (`ask_user`) registered through `agent_cli`'s `mcp` parameter, plus the `codechroma_BRIDGE_URL`/`codechroma_QUESTION_TOKEN` env vars; see [`ai-questions.md`](ai-questions.md) "Agent wiring". A bridge restart invalidates old tokens, so agents are respawned with fresh ones.
