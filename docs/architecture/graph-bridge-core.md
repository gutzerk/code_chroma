# Graph bridge core (`src/codechroma/bridge/`) — the live HTTP+WS front door to `GraphEngine`

The web canvas's real data source: the node/children/connections/diff endpoints the canvas fetches,
plus `WS /repos/{id}/events` for live pushes.

🔴 **`app.py`'s `create_app(repo_root)` is the entry point, and nothing happens at import.** The app
used to be `server.py`: 1058 lines of routes over module globals assembled at *module import*, which
made "point the bridge at another repo" mean `importlib.reload`. Now `BridgeServices.create`
(`services.py`) builds the registry/agent-manager/PR-manager bundle, `create_app` hangs it on
`app.state.services`, and each route reads it through the `Services`/`Ws` dependencies in `deps.py`.
Routes live in `routes/{graph,diffs,diagrams,custom_diagrams,epics,traces,
workspaces,prs,agents,events}.py`, one `APIRouter` each, included in that order by
`routes/__init__.py`'s `ROUTERS`. `server.py` survives as
a 22-line shim (`app = create_app()`) because `launch.py`'s uvicorn command line and
`packaging/bridge_main.py` name it. Adding an endpoint group is a new router file, not more lines in
one module — and two apps over two repos can coexist in one process, which is what
`tests/conftest.py`'s `make_bridge` uses instead of a reload. `tests/conftest.py` is the shared
bridge-test harness: `BridgeHarness` (re-exposes `app.state.services` internals under the old
`server.<global>` names so tests didn't need renaming when `server.py` collapsed), fixtures
`make_repo`/`bridge_repo`/`bridge` (fresh repo copy per test), and module-scoped
`shared_bridge`/`shared_client` (reused across a whole test module — safe only for read-only route
tests).
The terminal socket (mounted from `src/codechroma/terminal/server.py`'s `router`) resolves the same
per-app services: it reads `websocket.app.state.services` for `workspace_cwd` and `agent_sessions`
instead of module globals, so two apps alive in one process each serve their own workspace/session
lookups.

🔴 **Every headless skill runner is owned by `BridgeServices`, never by a module.**
`services.skill_agents` is a dict keyed by skill-run kind (`"c1"`, `"patterns"`, `"impact-changes"`,
`"epic-brief"`, `"wiki-general"`, `"wiki-general-update"`), built by `_build_skill_agents()` from three sources — `DIAGRAMS`
(`diagram_registry.py`, the generate-side closures, still built from `diagrams/registry.py`'s
`BUILTIN_TYPES`), `COMPOSITE_SPECS` (`skill_spec.py`), and each built-in's own `review.agent_factory`
looked up in `bridge/review.py`'s `REVIEW_AGENT_FACTORIES` (037-total-diagram-unification, US3 —
`impact-changes` is the only one registered today, moved there from `c1-changes` in the 038
follow-up; C1's judgmental review was removed rather than left half-wired in that same pass, so `c1`
has no `review` config at all).
⚠ Three composite kinds this section used to list here — `custom` (removed in 034), `diagram-type`
(removed in the diagram-management unification), and `research` (removed wholesale) — are gone; only
`epic-brief` remains. It subclasses one `CompositeKeyAgentSpec`
(`composite_agent.py`), which owns `job_key()`, the key→artifact path, and `build_agent()`; each
subclass keeps only its prompt/validate/artifact-dir/names. The per-kind modules hold no instances —
each `build_agent()` is one call to `skill_agent.build_skill_agent(kind, ...)`, which owns the
settings-derived model/timeout plumbing, and the composite-key modules share
`skill_agent.item_from_key` for the `key.rsplit(":", 1)` trick. Routes resolve the runner via
`services.skill_agents[kind]` per request, shutdown is `services.cancel_skill_agents()`
(`app.py`'s lifespan), and deleting an agent/PR workspace calls `services.forget_workspace_runs(id)`
— so two apps in one process never share job state, and `cancel` in one can't kill the other's run.
🔴 `SkillAgent.forget(repo_id)` has prefix semantics: it also drops every composite
`f"{repo_id}:..."` job key (epic briefs), or those entries would outlive the
deleted workspace for the process lifetime.
The `{kind}-status`/`{kind}-output` callback pair and the cancel-then-ping body are written once in
`routes/_skill_jobs.py` (`job_callbacks`, `stop_and_notify`, accepting both `ws.emit` and the async
`connections.broadcast`); the diagram and epics routes wire through it (the custom-diagram
generate/status/output/cancel trio this used to include is gone -- see custom-diagrams.md), and the
byte-identical `{kind}/output` GET is registered generically by `routes/skill_runs.py`
(`register_output_route`).
The canvas's **Stop** affordance maps to `SkillAgent.stop(repo_id)`: it kills the in-flight `claude`
process, awaits the run task (so a half-written artifact is rolled back to its pre-run snapshot, the
same guard `_run_claude` applies on any failed run), and resets the job to `idle` — so a follow-up
generate starts fresh instead of re-attaching. It's wired through the generic `POST
/repos/{id}/{kind}/cancel` route in `routes/diagrams.py` (broadcasting a `{kind}-status` idle ping)
and the per-epic `POST /repos/{id}/epics/{item_id}/brief/cancel` route<!-- (see
`epics-view.md`) -->.
🔵 **Debug-only raw-stream logging.** `SkillAgent`'s progress buffer (`self.output`, above) is
in-memory only and bounded (`output_lines`/`output_tail_chars`) — nothing about a run persists past
the process lifetime or the buffer's own eviction, by design. Setting `codechroma_SKILL_LOG_DIR` to a
directory makes every `SkillAgent` run (any kind — c1/patterns/wiki-general/etc., they all
go through `skill_agent.py`'s `_run_cli`) also write its raw, unbounded stdout/stderr stream to
`<dir>/<name>-<repo_id>-<timestamp>.log`, closed when the run ends. Unset by default; a
misconfigured/unwritable dir logs a warning and disables itself for that run rather than failing it.
Tests: `test_skill_agent_stream.py`'s `test_debug_log_dir_writes_the_raw_stream_to_disk`/
`test_without_the_env_var_nothing_is_written_to_disk`.
Skill-agent timeouts live in one `config.py` dict (`skill_agent_timeouts.seconds_for(kind)`,
unknown kinds get `default_timeout_seconds`), not one field per kind. Generic file IO
(`write_json`/`load_json`/
`read_text`/`slice_lines`) lives in core `codechroma/io.py` — the old `bridge/atomic_write.py` and
`bridge/source_text.py` are gone, and nothing under the core packages imports `bridge/` anymore
(the engine is importable as a plain library).

⚠ It is no longer "one process = one repository". `repo_id` in `/repos/{repo_id}/...` selects a
**`Workspace`** (`workspaces.py`): one analyzed root with its own `GraphEngine` (offline summarizer —
never calls Claude), `GitSync`, `.codechroma/*` paths and watchers. Its diagram API is
keyed by kind throughout — `diagram_artifact_path(kind_or_type)`, `load_diagram(kind)`,
`layout_store(kind)`,
`on_diagram_change(kind)` and a
`diagram_watchers` dict — with no per-kind aliases and no `setattr(f"{kind}_watcher")`;
`impact_changes_path` is the one exception, since a review is written per workspace and never borrowed
from main. 🔴 `DIAGRAMS` is a runtime `DiagramRegistry` (`dict` subclass): `get(kind)` resolves a
built-in spec or **synthesizes one from the home library** for a `custom/<type_id>` key, so a custom
type needs no registry edit at import time. `diagram_artifact_path` is the **one** spelling for any
kind (the old `Workspace.custom_diagram_path` method is gone — the module-level
`custom_diagram_agent.custom_diagram_path(root, type_id)` helper remains, but callers use
`workspace.diagram_artifact_path(kind)`). Custom-types stay out of the build-time iteration
(`for kind in DIAGRAMS` → bootstrap/seed/watchers touch only c1/patterns); a single registry-owned
dir watcher (`DIAGRAMS.custom_dir(root)`) covers every custom artifact.

🔴 **Per-diagram storage (`docs/planning/wayfinder/diagram-per-file-storage/`, terms in
`CONTEXT.md`).** Every path template above moved from a flat `.codechroma/<kind>.json` to
`.codechroma/diagrams/<kind>/<kind-basename>.json`, e.g. `custom/<id>` → `diagrams/custom/<id>/
<id>.json`, `feature-plan/<slug>` → `diagrams/feature-plan/<slug>/<slug>.json`. `diagram_artifact_path`
itself didn't change shape — only what its per-kind `artifact_path`/`custom_dir`/`feature_plan_dir`
callables in `diagram_registry.py` and `diagrams/registry.py`'s `BUILTIN_TYPES[...].artifact` return.
New sibling: `WorkspaceArtifacts.diagram_projection_path(kind)` = `diagrams_root / kind /
"projection.json"` — that diagram's own canvas-layer content (no position; see
[`single-canvas.md`](single-canvas.md)'s banner). Deliberately **not** built through
`diagram_artifact_path(kind).parent` like the artifact is: the artifact follows a kind's borrowed
root (C1 in a PR workspace reads main's), but canvas content is always the workspace's own — an
engineering-review pass caught the projection watcher pointing at main's file for a PR's C1 before
this split. `Workspace.canvas_path` is gone, replaced by `canvas_core_path`
(`.codechroma/canvas-core.json`) + `diagrams_root` (`.codechroma/diagrams/`).

**A second synthesized prefix, `feature-plan/<slug>` (055-diagram-feature-plan), mirrors `custom/
<type_id>` but is keyed by task identity, not a saved type.** `DiagramRegistry._synthesize_feature_plan`
returns a spec for *any* filename-safe slug (`diagrams.library.valid_type_id` rejects an unsafe one
before it ever reaches disk) — there's no library definition to look up first, since "find or create
this feature's own diagram" needs none. Its artifact lives at `feature_plan_dir(root)/<slug>/<slug>.json`
(`.codechroma/diagrams/feature-plan/<slug>/<slug>.json` per the per-file-storage banner above, a
sibling of `diagrams/custom/`), resolves through the same
`resolve_diagram()`, and gets its own `WorkspaceWatchers.feature_plan_watcher`
(a `DirWatcher` over that dir) emitting `{"type": "feature-plan"}` — deliberately never `"custom"`'s
ping, since "features with a plan" and "saved custom types" are different lists with different
lifecycles. Also stays out of the build-time iteration and `layout_kinds()`/`EXTRA_LAYOUT_KINDS`
(no drag-layout persistence yet for a feature-plan diagram — a gap, not a decision, left for a later
ticket if dragging one turns out to matter).

⚠ **Ticket 02 needed no route change; tickets 03/04 (the actual skill mode) did.** `DIAGRAMS.get(kind)`
resolving generically is not the same as an HTTP route existing for it — `_register_diagram_routes`
(`routes/diagrams.py`) only ever runs over the three specs literally in the `DIAGRAMS` dict literal at
import time, so a lazily-synthesized kind like `feature-plan/<slug>` (same as `custom/<type_id>`)
never gets one for free. `routes/feature_plans.py` adds the missing pair —
`GET /repos/{id}/feature-plan/{slug}-path` and `GET /repos/{id}/feature-plan/{slug}` — mirroring
`custom_diagrams.py`'s per-repo diagram routes (no interview/list/save trio, no generate/status/output
trio: a Feature-plan diagram never auto-generates). `canvas/recipes.py`'s `recipe_for()` also needed
its own `feature-plan/` branch (same shape as its existing `custom/` one) so
`POST /repos/{id}/recipes/feature-plan/<slug>/run` resolves instead of 404ing — this is how the skill
delivers a drawn plan onto the canvas live, since a dynamic per-feature kind has no "Draw" menu entry
to trigger it automatically the way `c1`/`patterns`/`custom` do.

🔴 **`custom_diagrams`/`feature_plans` must be registered before `diagrams` in `routes/__init__.py`'s
`ROUTERS`.** `diagrams.router` registers two truly generic routes, `GET /repos/{id}/{kind}/context`
and `/review`, where `{kind}` matches any single path segment — so a slug/type_id of exactly
`"context"` or `"review"` has the identical URL shape (`kind="custom"` or `"feature-plan"`, literal
third segment) and, in whichever registration order loses, gets permanently shadowed: the request
hits the generic route with `kind="custom"`/`"feature-plan"` (no matching `DiagramTypeDefinition`)
and 404s with a misleading "unknown diagram kind"/"has no review flow" instead of ever reaching the
intended feature/type. Caught by review during 055 tickets 03/04, since `feature-plan/<slug>`
doubled the pre-existing `custom/<type_id>` exposure to this — `custom_diagrams.router` had the same
bug from its own introduction, just never registered before `diagrams.router` either. Regression
tests: `test_feature_plan_routes.py`/`test_custom_diagram_routes.py`'s
`..._is_not_shadowed_by_the_generic_context_or_review_route`. See
`docs/planning/055-diagram-feature-plan/` for the
**Planned block** (`meta.plan_kind`) concept this artifact carries — a diagram-shape/self-check
concern, not a `Workspace`/registry one; covered below and in `diagram-skills.md`.

**Saved drag layouts all go through one seam**: `layout_store(kind)` returns a
`LayoutStore` (`bridge/layout_store.py`, owns `sanitize_layout` + atomic write), resolving a
`DIAGRAMS` kind's own path or falling back to `.codechroma/{kind}-layout.json` for derived views.
`routes/diagrams.py`'s `_register_layout_routes` factory registers the `GET`/`POST
/repos/{id}/{kind}/layout` pair once per kind in `diagram_registry.layout_kinds()` — the `DIAGRAMS`
kinds plus `EXTRA_LAYOUT_KINDS = ("hierarchy", "epics")`; there are no hand-rolled layout route
pairs left (tested in `tests/unit/test_bridge_{c1,patterns,hierarchy,epics}_layout_route.py`). 🔴 The startup bootstrap that *generates* a missing diagram is **not** on `Workspace`:
it lives in `bridge/bootstrap_diagrams.py`, so "what in the bridge can spend money?" is a 50-line
module rather than a method buried in a class that otherwise only reads files and runs git. Its
offline counterpart, `bridge/bootstrap_wiki.py::bootstrap_wiki_if_missing`, generates the
docstring wiki once on first bring-up (never on a read-only workspace) — kept in its own module
rather than folded into `bootstrap_diagrams.py` precisely because it never reaches Anthropic; see
`docs/architecture/wiki-generator.md`. Reading
traces moved out too (`bridge/trace_archive.py`'s `TraceArchive`). Since then `Workspace`
(`workspaces.py`) has been split four ways, all reachable from the one dataclass so callers and
tests never moved: `Workspace` keeps identity/engine/state/`emit` + the lifecycle glue and a
delegating alias for every public accessor; `WorkspaceArtifacts` holds the `.codechroma/*` path
properties and `load_*`/`layout_store` reads (pure path/IO, no engine); `WorkspaceWatchers` owns
`build`/`start`/`stop` and the callbacks, iterating `DIAGRAMS` for the diagram watchers and
`DIAGRAMS.custom_dir(root)` for the custom watcher so a new diagram kind needs no edit there;
`WorkspaceGit` is the thin `sync`/`diff_base`/`divergent_files` shim over `GitSync` + `git_cmd`.
`WorkspaceRegistry` maps an id onto one; `"main"` is `create_app`'s `repo_root` (defaulting to
`codechroma_BRIDGE_REPO_PATH`) and is analyzed **as the app is built**, so the graph is ready on the
first request — and since uvicorn runs the lifespan before it binds the socket, `launch.py`'s
port-wait and the desktop's `/health` poll still mean "the analyze finished". An unknown id
(including the `"default"` older clients send) resolves to `main` and never creates a workspace.
⚠ Idle workspaces are actually unloaded now: `app.py`'s lifespan runs `_unload_idle_workspaces`
(every `IDLE_SWEEP_SECONDS`, threshold `settings.workspaces.idle_unload_seconds`), calling
`WorkspaceRegistry.unload_idle()` off the loop — an untouched agent/PR workspace drops its in-memory
engine and watchers; `.codechroma/graph.db` keeps its work, so the next access re-analyzes cheaply.
🔴 `register(..., shares_workspace_with=id)` aliases a second id onto an already-registered one's
`_live`/`_states`/`_threads` entry instead of building a second `Workspace` over the same directory
— what an attach-created agent (see `parallel-agents.md`) needs, since two ids there really do point
at one physical worktree. `get`/`ensure_async`/`state`/`is_live`/`drop_live` all resolve to the
canonical id first via `self._canonical`; `unregister` only tears the shared `Workspace` down once
`self._aliases[canonical]` empties, so unregistering one alias never stops the other's watchers.
Supporting modules:

- `live.py` — `RepoWatcher` (watchfiles thread, `.gitignore`-noise-filtered, ~1s debounce) and
  `ConnectionManager` (WS fan-out; `broadcast_threadsafe` schedules onto the app loop from the
  watcher thread). On each settled change batch the watcher calls back into the server, which runs
  `GitSync` then broadcasts a `{"type":"changed","paths":[...]}` ping. Broadcasts go out
  **concurrently with a per-socket timeout** (`SEND_TIMEOUT_SECONDS`), so one stuck client can't
  stall every other canvas; a socket that fails or times out is dropped. Watcher threads are
  **supervised**: a `watchfiles` crash (inotify limit, dir replaced) restarts the loop with
  exponential backoff instead of silently ending live updates for the process lifetime.
  🔴 The events socket is **keyed by repo**: `routes/events.py` registers each
  `WS /repos/{id}/events` under `key=repo_id` (same mechanism as the trace socket), and
  `WorkspaceRegistry` wraps each workspace's `on_event` so `Workspace.emit` broadcasts under its own
  id — a workspace-scoped ping only reaches that repo's canvases, while unkeyed broadcasts
  (agent/PR lifecycle, `workspace-activated`) still reach every socket.
- `git_sync.py` — `git status --porcelain` diff (mtime-keyed, `.codechroma` db excluded so it can't
  self-loop); `sync()` reanalyzes changed files and returns them (or `None` when nothing changed).
  Also invoked lazily on every HTTP request, so request-path reads stay fresh even without the watcher.
  Git runs through `git_cmd.run_git` (the shared `settings.git.short_timeout_seconds`, not a private
  2s cap), and a failed/timed-out status is **logged** ("live update skipped") instead of going
  silent. Porcelain path parsing is `git_cmd.porcelain_paths`, shared with
  `Workspace.divergent_files` and `agents/publish.dirty_files`.
- `git_diff.py` — `compute_function_diffs`: every FUNCTION added/modified/**deleted** vs a
  comparison `base`, each tagged with `status` (deletions carry empty `proposed_source` + the old
  `name`, and render as blurred floating panels in the canvas since their node is gone). A present,
  changed file additionally emits one whole-file **`modified` entry keyed at its
  `component::<path>` node** so a file's canvas box (an impact diagram's merged `component::` block,
  or any file node under Diff) carries a diff of its own text — otherwise only function-level
  entries existed and the file box itself never matched a diff by node_id. 🔴 `base`
  is an **argument**, not `HEAD`: `"HEAD"` (uncommitted-only) for `main`, and
  `Workspace.diff_base()` = `git merge-base <main> HEAD` for an agent worktree — without that, an
  agent's change layer empties out the moment it commits. `git_cmd.working_tree_status` takes the
  same argument and keeps the `"HEAD"` path byte-for-byte identical to the original single
  `git status`; any other base is `git diff --name-status <base>` plus `status` for untracked files.
  `overlays.resolve_impact_changes` threads it too, so the review's **fingerprint** is computed from
  the same base and an agent's review isn't permanently stale.
- `plan_resolver.py` — `resolve_target`: maps a `(file, symbol)` target to the **nearest existing
  node** (walk function→class→file→dir→system), tagged `resolution` (`exact`/`parent`/`ancestor`).
  Shared by `change_cards.py` (git-derived changes) and `impact_context.py` (feature-spec seeds,
  below); never copy this ladder. 🔴 Historical: this module used to also serve a `codechroma-plan`
  skill/`.codechroma/plan.json`/canvas "Plan" toggle ("the Plan overlay") that pinned steps as badges
  — that mechanism has been retired; only the shared resolver ladder survives.
- `impact.py` — `resolve_impact`: a deterministic slice of the hierarchy around a change's node_ids
  (the seeds plus their one-hop neighbours in the dependency graph, `dependents_of`/`dependencies_of`,
  only the edges fully inside that slice) — nothing AI-authored, cheap like `change_cards`. It is the
  **context source** for the `codechroma-draw-diagram` skill's impact type, never a canvas preview:
  the unified `GET /repos/{id}/impact/context?source=diff|plan` route (and, for a plan,
  `&feature=<dir>` naming the feature directory whose spec files seed the slice —
  `impact_context.py::build_impact_context`, registered as the `"impact"` `ContextProvider` in
  `bridge/context_providers.py`; the old dedicated `GET /repos/{id}/impact-context` route is 🔴
  deleted, 037-total-diagram-unification US4) wraps the deterministic slice with per-node evidence
  (path, level, git-status/reason, ancestor anchors) and a slice fingerprint so an authored diagram
  can be flagged stale. The **diff** source
  seeds from `change_cards` (git status, reason = `modified`/`added`/…); the **plan** source seeds
  from the code paths mined out of a feature dir's `plan.md`/`tasks.md`, each resolved via
  `plan_resolver.resolve_target` to its nearest existing node (`impact_context.py::_feature_spec_seeds`)
  — unrelated to `.codechroma/plan.json` (the now-retired Plan overlay's file; see `plan_resolver.py`
  above). `impact` is a **conventional skill kind** in the `DIAGRAMS` registry: its
  `DiagramSpec` (`impact_resolver.py::resolve_impact_diagram` serves `.codechroma/impact.json` with
  `has_diagram`/`stale`, keyed by both `source` and the authored `feature`; 🔴 `impact_agent.py` is
  deleted, 037 — `content_generators.py::build_skill_agent_for` builds the same runner generically
  from `diagrams/registry.py`'s `BUILTIN_TYPES["impact"]`) rides the shared
  get/generate/status/output/layout pipeline under the bare
  `/repos/{id}/impact` — the skill reads the context and authors the final boxes, the only thing the
  canvas draws. `impact_resolver.py` also passes through each node's optional `status` (`new`/
  `modified`/`context`, a plan role the skill judges from the spec files — an unknown value is
  dropped, never mis-colours a box) and each relation's optional `label` (an arrow caption like C1's);
  the canvas colours a plan seed by `status` and renders the `label` on the edge. `hop`/`max_nodes`
  bound the slice; a seed
  naming a node missing from the graph is dropped silently because the caller asked for a slice, not
  a change report.
- 🔴 **The Impact judgmental review was removed (038 follow-up), not just left unused; the
  explanatory review then moved onto `impact` from `c1` (later follow-up).** `routes/impact.py` (the
  `GET /repos/{id}/impact-review`/`impact-review-path` routes),
  `overlays.py::resolve_impact_review`/`_ReviewOverlayProvider` (the `"review"` named overlay
  provider), `Workspace.impact_review_path`/`load_impact_review`/`impact_review_watcher`, and the
  `impact` type's `review=ReviewConfig(axis="judgmental", ...)` are all gone for good — that axis has
  no successor. What replaced it: `impact`'s `DiagramTypeDefinition.review` is now
  `ReviewConfig(axis="explanatory", agent_factory="impact-changes")` (moved from `c1`, whose own
  `review` is `None` today), so `GET /repos/{id}/impact/review` resolves through
  `bridge/review.py::resolve_review` while `GET /repos/{id}/c1/review` 404s, same as any other type
  with no review flow. The Impact *diagram* itself (`bridge/impact.py`, `impact_context.py`,
  `impact_resolver.py`) is unaffected by either review-axis change — only which review sidecar sits
  on top of it changed. See [`docs/architecture/diagram-skills.md`](diagram-skills.md) for what
  `codechroma-review-diagram` covers today.
- `launch.py` — the `python -m codechroma.bridge.launch --repo-path X` one-command launcher (see the
  root `CLAUDE.md`'s Commands section). 🔴 Skill install is an **`app.py::create_app` step**, not a
  `launch.py`-only one: `create_app` calls `skill_sync.sync_all_skills(root)` right after resolving
  `root`, so every entry point that builds an app over a repo — the packaged desktop bridge
  (`packaging/bridge_main.py`), a plain `uvicorn codechroma.bridge.server:app`, and `launch.py` itself
  — installs/refreshes every skill in `skill_sync.SKILL_NAMES` into the target repo's
  `.claude/skills/` (source of truth: this repo's own `.claude/skills/`) so agents running inside
  that repo write plans, diagrams, change reviews, pattern diagrams and epic briefs in the
  current format; skipped when the target is this repo itself. 🔴 `SKILL_NAMES` is the **single**
  per-skill list — `sync_skill(root, name)` is generic, `SKILL_EXCLUDE_PATTERNS` is derived from it,
  and `launch.py`'s "installed X at Y" print lines loop over it; a new skill is one name in that
  tuple plus its directory, never a new `sync_*_skill` function. `packaging/bridge.spec` **imports**
  the same tuple rather than re-typing it — the hand-kept copy it used to hold is what silently
  dropped `codechroma-impact`/`codechroma-impact-review` from every frozen build.
  🔴 **Removing a name is not enough to uninstall a skill.** `sync_skill` only `rmtree`s a target
  whose name is still in `SKILL_NAMES`, so a dropped name stays installed forever in every
  already-analyzed repo. `RETIRED_SKILL_NAMES` + `prune_retired_skills()` (called from
  `sync_all_skills`) exist for that; retired names stay in `SKILL_EXCLUDE_PATTERNS` so a leftover
  never reads as the user's own work while it is being removed. See
  [`diagram-skills.md`](diagram-skills.md) for the four-skill merge that needed it. Without this install, a headless
  `claude -p` skill-agent run (`skill_agent.py`) has no `SKILL.md` to follow in the analyzed repo,
  exits 0 having written nothing, and surfaces as e.g. `"generation produced no valid
  patterns.json"`; before `create_app` owned it, only the `launch.py` entry point worked, so the
  desktop app or a bare `uvicorn` command silently produced that error on every diagram generation.
  🔴 Those copies land in the user's working tree, so anything that judges the tree "dirty" must
  exempt them or the bridge blocks on its own output — the branch switcher did exactly that ("commit
  or stash your changes before switching branches" over two untracked `codechroma-patterns` files).
  `codechroma.skills.is_synced_skill_path` (core, so `GraphEngine`'s file walk can use it without
  importing the bridge; re-exported by `skill_sync`) is the shared test for "we wrote this" (any
  depth under `.claude/skills/codechroma-*`); `main_branch._is_ours` combines it with the
  `.codechroma/*` exemption. Use both in any new dirty check.

See [`c1-diagram.md`](c1-diagram.md) for the C1 system-context view and
[`patterns-diagram.md`](patterns-diagram.md) for the Design Patterns view — both are built on top of
this core.

`reanalyze` only re-summarizes nodes whose source file changed (reuses cached summaries otherwise),
so live saves are cheap. Exercised by
`tests/unit/test_bridge_{diff_route,events_route,live,impact_route}.py`,
`tests/unit/test_plan_resolver.py`, `tests/unit/test_impact.py`, `tests/unit/test_skill_sync.py`,
`tests/unit/test_main_branch.py`, and
`tests/integration/test_summary_reuse.py`.
