# PR review workspaces (`src/codechroma/bridge/prs/`) — a pull request as a read-only workspace

Paste a GitHub PR URL into the rail's pull-request dialog and its head is fetched into a detached
worktree registered as a `Workspace` with id `pr-<number>`; from there every existing layer works
unchanged, because `App.tsx` already routes every canvas request through `repoId`.

- **Zero LLM calls, structurally.** `Workspace.read_only` short-circuits
  `bootstrap_diagrams.bootstrap_if_missing()` — the only path from a workspace to Claude — and `deps.py`'s
  `refuse_if_read_only` (reached via the `WritableWs` dependency) 409s `/diff/{node}/accept`, `/c1/generate` and `/impact-changes/generate`. On the
  **flag**, never on `repo_id.startswith("pr-")`: an agent the user titles "PR fixes" is still writable.
  🔴 **`canvas.json` is the one exception.** `PATCH /repos/{id}/canvas`
  (`routes/canvas.py`) and `POST /repos/{id}/recipes/{recipe}/run` (`routes/recipes.py`) take the
  bare `Ws` dependency, not `WritableWs` — they only rewrite this workspace's own layout file
  (add/remove/move a diagram's boxes) and never call Claude or touch the checkout, so a PR review can
  freely arrange the diagrams it inherited from main. Everything that *generates* a diagram
  (`routes/diagrams.py`, `routes/custom_diagrams.py`) still goes through `WritableWs` and stays
  blocked.
- **`Workspace.c1_source_root`** points a PR at *main's* `c1.json` and `c1-layout.json`. A PR changes
  the code, not the architecture, and a per-PR diagram would be a Claude call for something the user
  already has. Its `impact-changes.json` stays its own.
- 🔴 **Refs land in our own namespace**, `refs/codechroma/pr/<n>/{head,base}`, never
  `refs/remotes/origin/*` — writing the user's remote-tracking refs would silently change what their
  `git status` says about ahead/behind. One `git fetch` brings both down; the base ref is what makes
  `Workspace.diff_base()` (now `self.base_ref or worktree.main_branch(...)`) resolvable at all. No
  `--depth`: a shallow fetch into a full repo breaks `merge-base`.
- **Detached, but skills ARE installed.** No local branch to hold a checkout hostage. Skills are
  copied into the worktree (like an agent's, via `_install_skills` → `sync_all_skills`, excluded
  first so the detached checkout stays clean) because a read-only PR still runs diagram skills —
  e.g. impact's artifact lands in the worktree itself (`impact-path` → `…/worktrees/pr-<n>`), so the
  agent needs a local copy to start with. Reinstalled on worktree re-creation in `refresh_pr`.
- **An agent's `attach_to` can also be a `pr-<n>` id** — this now attaches straight to this detached
  worktree, the same as attaching to main or another agent (`AgentManager.create`, `agents/manager.py`):
  `branch`/`worktree` are the PR's own (`pr_target.head_ref`/`pr_target.worktree`), `base_branch` is
  the PR's `base_ref`, and `shares_workspace_with` is the PR id — so its `read_only` flag (this file's
  guard above) applies to the agent too, and `AgentManager.delete()`'s `_guard_shared_worktree`
  refuses to remove the PR's worktree/branch through it — see [`parallel-agents.md`](parallel-agents.md)
  for the full trade-off. `AgentRecord.source_pr` still
  records which PR it's attached to, purely so the canvas can hide `CreatePrButton`
  (`web/src/agents/AgentWindow.tsx`) for it — opening a second, unrelated PR from that shared worktree
  would contradict the user's "this agent is working on PR #282" mental model. `source_pr` is `None`
  for every other agent.
- **`git_long.py`** is the runner for the network commands `git_cmd` is wrong for: `run_git_raw` is
  capped at 10s and collapses "git isn't installed" and "git hung" into one `None`. `GitLongError`
  carries `not-runnable`/`timed-out`/`failed`, and 🔴 `non_interactive_env()` — not the longer timeout
  — is what stops a private-repo fetch sitting on a credential prompt. `publish.create_pr`'s `git push`
  now goes through it too; that was a latent bug.
- **A PR inherits main's authored diagrams.** `_import_pr_record` calls
  `pr_import_seed.seed_diagrams_from_main(pr_root, main_root)` after the worktree is fetched and
  before it's registered. The bare checkout's `.codechroma/` is empty, so without this a PR would show
  "you don't have any" for Patterns/Custom (and an empty Epics view) even though main has them. The
  seed *copies* — never reads through — every diagram kind main authored (`patterns.json`, the whole
  `.codechroma/custom/` dir, `c1.json`, plus the configured requirements/delivery source dir) into the
  PR worktree, only when the PR lacks the file, and is best-effort like `bootstrap_if_missing` (a
  missing main artifact or I/O error is skipped, never a failed import). C1 additionally keeps its
  read-through borrow via `c1_source_root`; the copy makes the PR self-contained and stable if main's
  diagrams change while it stays open. Main is never written to. 🔴 The seed also handles
  `canvas.json` itself, not just the diagram artifact files, and it is the **only** thing that can:
  a read-only workspace refuses every write through `refuse_if_read_only`, so a PR that arrived
  without a root block would render nothing at all, forever. `seed_canvas_doc` copies main's file
  when there is one and then calls `canvas.document.ensure_seeded` either way — main may have no
  `canvas.json` of its own. That helper is the single definition of the invariant for every
  workspace kind (see [`single-canvas.md`](single-canvas.md)'s "The seeded root block"); nothing on
  the client seeds anymore, and `get_canvas` no longer has a `read_only` branch synthesizing one.
  🔴 `PrManager.reconcile()` backfills a PR fetched before this seeding existed, so it self-heals on
  the bridge's next restart instead of staying blank forever — but it calls **`seed_canvas_doc` and
  nothing wider**. The full `seed_diagrams_from_main` belongs to *import* only: unlike every other
  copy in that module, its `_copy_requirements_source` step is a `copytree(dirs_exist_ok=True)`, i.e.
  an overwrite, so re-running the whole seed each boot restored main's requirements/epics files over
  whatever the PR itself had changed — a PR that edits `plan/epics/*.md` would show main's version of
  them after every restart.
- **`prs.json` is a sibling of `agents.json`**, not more rows in it: `AgentRecord.from_json` requires
  title+branch+worktree and drops unknown keys, so a shared file would leave an older bridge showing a
  broken agent card with a Start button. `MAX_PR_WORKSPACES = 3` (`settings.pr_workspaces` in
  [`config.py`](config-and-prompts.md)) is its own cap (memory, not
  subscription spend). ⚠ `agents/manager.py` refuses an agent id matching `pr-<digits>` — and matches
  *only* digits, because anything wider makes `_unique_id`'s own `-2` suffix shadow in turn and loop
  forever. `set_active_workspace` gained a `workspace_guard` so a PR id can be active, and `_load`
  defers an unknown `active_workspace` for `revalidate_active_workspace()` instead of discarding it.
  `AgentManager` (`agents/manager.py`) is split internally — `ActiveWorkspace` owns the active id /
  `workspace_guard` / deferred revalidate state, and `WorktreeProvisioner` owns create/attach/
  recreate/migrate + skill install + diagram seeding — with every public name still delegating on
  `AgentManager` so routes and tests never moved. `_agents` mutations run under an `RLock`, since
  `create`/`reconcile` run on both the event loop and worktree threads.
- 🔴 **Re-registered at boot** (`services.py`'s `BridgeServices.create`, after the agent loop). Without it `registry.get("pr-12")`
  silently returns *main* and the canvas draws the main repo's graph under the PR's name.
  `registry.root_for` also replaced `BridgeServices.workspace_cwd`'s `agent_manager` lookup — a registered non-agent
  workspace used to open its terminal in main.
- `registry.drop_live` joins a pending bring-up before unloading, and the delete route calls it before
  removing the worktree: an analyze still writing `graph.db` into a directory being deleted fails.
- Canvas side: `web/src/pr/` (`prUrl`, `prStore`, `PrRailButton`, `PrDialog`) plus
  `agents/workspaceStore.ts`. Read-only travels in `WorkspaceStatus.read_only` (absent = writable, so
  an older bridge is unaffected), OR'd with `prStore` membership; it is fed by the responses
  `activateWorkspace` and `WorkspaceStatusBanner`'s poll already return, so nothing costs a request.
  It suppresses the Accept button (`NodePanels`, `DeletedDiffOverlay`) and `useC1ChangeReview`'s third
  argument `canGenerate` — the deterministic badges still land, the `claude -p` run doesn't.
- Routes: `GET /prs`, `GET /prs/preflight`, `POST /prs`, `POST /prs/{n}/refresh`, `DELETE /prs/{n}`,
  plus `read_only` on `GET /workspaces/{id}/status`. Preflight uses `publish`'s disabled-with-reason
  pattern; an already-open PR is a 200 linking to it, not a second fetch.
- `prs/github.py` resolves repository identity with `gh repo view --json nameWithOwner`, not by
  parsing `origin`'s URL. This lets GitHub CLI handle HTTPS/SSH URLs, a GitHub `upstream` remote,
  SSH aliases and Git worktrees/nested working directories. The picker distinguishes a missing
  `gh`, failed authentication, an unresolved GitHub checkout and a failed PR-list command; an empty
  successful list means there are no open PRs. A pasted PR URL is checked against the resolved
  owner/repo, while a bare number means the current repository.
- Out of scope on purpose: no review *prose* (no new skill or artifact), only the current
  repository's own PRs (forks work via `refs/pull/<n>/head`), and refresh is a button — nothing
  polls GitHub.
- 🔴 **Refresh states its outcome** (`pr-dialog-row-notice`), from the `updated` flag `refresh_pr`
  already returns — the route's own "the head moved" answer, the same one that decides whether the
  workspace was dropped and re-seeded, not a guess from diffing payloads. The row renders *none* of
  the fields a refresh can change (`fetched_at`, `head_sha`, `changed_files`, `additions`,
  `deletions`), so before this "pulled new commits" and "already up to date" were both completely
  silent and the button read as broken. It carries `role="status"` (an implicit
  `aria-live="polite"`): that "nothing visibly changed" problem is the entire reason the line exists,
  and it is strictly worse without sight of the row, so announcing it isn't decoration.
  ⚠ Two related gaps remain: the bridge broadcasts
  `{"type": "pr-updated", ...}` but **nothing in `web/src` subscribes to it**, so a refresh
  triggered elsewhere never reaches the dialog (only the sibling `changed` ping moves the canvas);
  and `mockAgentClient.refreshPr` only bumps `fetched_at` and always answers `updated: false`, so
  the mock can never exercise the moved-head branch.
- Tests: `tests/unit/test_{git_long,pr_reference,pr_manager,pr_import,change_cards}.py`,
  `tests/unit/test_bridge_{change_cards_route,pr_routes,pr_boot}.py`,
  `web/src/pr/*.test.{ts,tsx}`, `web/src/agents/workspaceStore.test.ts`,
  `web/src/state/{changeCardStore,refreshDiffs}.test.ts`, `web/src/canvas/ChangeCardsPanel.test.tsx`,
  `web/e2e/{pr-review,change-cards}.spec.ts`. Tests that hand-build an `AgentClient` spread
  `PR_CLIENT_STUB` (`web/src/agents/stubAgentClient.ts`), the `C1_CHANGES_STUB` precedent.
