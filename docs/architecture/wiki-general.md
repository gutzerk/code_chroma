# Wiki-general — the AI-generated semantic architecture map (C1→C2→C3→C4)

047-wiki-general's second, opt-in wiki: `.codechroma/wiki-general/`, a sibling of the plain
docstring wiki (`docs/architecture/wiki-generator.md`) that groups the same code by *meaning*
instead of by directory — System → Container → Component → Element. Never merged with the plain
wiki and never auto-bootstrapped; the first tree only ever comes from an explicit "Generate" click,
since it's a paid Claude call (`bridge/wiki_general_pipeline.py`, a deterministic Python pipeline of
worker calls, not a skill — see "Generation pipeline" below), unlike the plain wiki's
offline `generate_wiki()`. Once it exists, a commit marks it possibly stale and the canvas offers an
incremental **Update** (a second, narrower skill, `.claude/skills/codechroma-wiki-general-update/`,
that patches only affected pages) alongside the original full-rebuild **Generate** — see "Staying
current after a commit" below. Neither ever fires on its own; both are still click-only.

## Why it isn't a diagram type

`DiagramTypeDefinition`/`BUILTIN_TYPES` (`diagrams/registry.py`, see `diagram-skills.md`) assume a
flat `nodes[]`/`relations[]` shape a dagre layout resolves onto canvas boxes. wiki-general is a tree
of markdown pages the canvas never renders (v1 has no viewer at all — generation infrastructure
only); forcing it into the diagram registry for code reuse is exactly what
[[diagram-unification-scope-boundary]] warns against for epics-view, the same "different data
source, structured document, not node markers" boundary. What *is* reused is the `SkillAgent`
primitive itself (snapshot/restore/timeout/cancel/streaming) — `bridge/wiki_general_agent.py`
mirrors `content_generators.py::build_skill_agent_for`'s pattern one level down, as a standalone
function, not a `DIAGRAMS`/`BUILTIN_TYPES` entry.

## The manifest — bridging a markdown tree onto a JSON-artifact primitive

`SkillAgent.has_artifact()` (`bridge/skill_agent.py`) always `json.loads()`s the file `artifact()`
points to, unconditionally — there's no hook to swap that for a markdown reader. So the file this
runner snapshots/restores/validates is `.codechroma/wiki-general/manifest.json`
(`wiki_general_agent.py::wiki_general_manifest_path`), a small bookkeeping file the skill writes
*last*, after every page — never meant for a human to read, the same role `.hashtree.json` plays for
the plain wiki:

```json
{
  "generated_at": "2026-09-14T12:00:00Z",
  "containers": [
    {"id": "backend", "name": "Backend", "path": "c2/backend.md", "files": ["app/main.py"]}
  ],
  "components": [
    {
      "id": "auth",
      "name": "Authentication",
      "container": "backend",
      "path": "c3/auth.md",
      "files": ["app/auth/login.py", "app/auth/tokens.py"]
    }
  ],
  "edges": [{"from": "auth", "to": "billing", "count": 7}]
}
```

`_valid_manifest()`'s gate is deliberately light (non-empty `containers`/`components`, each entry a
dict with a string `id`) — `has_artifact()`/`_valid_manifest()` is `SkillAgent`'s own generic shape
check, not the real content check. That's `check_wiki_general.py`'s `run_checks()` job: called
in-process by `run_pipeline` itself on the generate path (058), and by `codechroma-wiki-general-update`
before it reports success on the update path — either way, before `_valid_manifest()` ever runs.
`files[]`/`edges[]` (057-wiki-general-redesign) are additive to this same light gate — a manifest
missing them (predating this feature) still passes; see "C2-join clustering" below for where they
come from and `specs/057-wiki-general-redesign/contracts/manifest-schema.md` for the full contract.

## Refusing to run on a repo with nothing to document (053-wiki-general-empty-repo-guard)

A brand-new or code-free repo (empty, or only `.md`/`.json`/`.yml`/etc.) used to still show a
Generate button, whose run always failed: `_valid_manifest()` above rejects empty
`containers`/`components`, so the model either honestly returned them empty (error) or invented
content with no real `File:`/`Class:`/`Function:` backing (caught as `HALLUCINATED` by
`check_wiki_general.py`) — either way, a wasted several-minute `claude -p` run every time.
`wiki_general_agent.has_documentable_content(ws) -> bool` now guards this before any run starts:
it walks `ws.engine.snapshot().symbols` and returns `True` on the first symbol whose `language` is
not `"yaml"` (the only analyzer -- `yaml_analyzer.py` -- that runs a generic structural fallback
rather than parsing real code) and whose file extension is not in `_NON_CODE_EXTENSIONS` (`graph/
builder.py`'s `DOC_EXTENSIONS` -- `.md`/`.rst`/`.txt`/`.adoc`, the same set `_compute_doc_only`
uses for `HierarchyNode.doc_only` -- plus `.json`/`.yml`/`.yaml`). A repo with zero qualifying
symbols falls back to `_has_unparsed_source_file(ws.root)`, a raw filesystem scan for any file
outside dotfiles/dotdirs, `_IGNORED_DIR_NAMES` (`node_modules`/`dist`/`build`/etc.) and
`_NON_CODE_EXTENSIONS` -- without it, a repo written entirely in a language with no registered
`LanguageAnalyzer` (zero symbols, same as an empty repo) would wrongly get the same "no code yet"
refusal as a genuinely empty one; the fallback is what tells the two apart, and is also why
`_NON_CODE_EXTENSIONS` is load-bearing now, not just a safety net for a future analyzer. The check
itself lives in
`prepare_new_run(agent, ws, *, guard_content=True)` -- the one function `generate_wiki_general` and
the interactive `set_wiki_general_status`'s `state: "generating"` branch already both funnel
through before `agent.start`/`agent.mark_generating` -- rather than being duplicated at each call
site: `set_wiki_general_status` passes `guard_content=kind == KIND` (the update kind's post-commit
trigger already implies a prior successful generate, so it opts out), `generate_wiki_general` takes
the default. A failed check returns `NO_DOCUMENTABLE_CONTENT_ERROR` (`"repository has no code yet --
nothing to document"`) the same way `_prepare_new_run`'s `sync_error` already did, so both callers'
existing `if sync_error is not None: agent.mark_done(...)` handling needed no change. `get_wiki_general_status`
also exposes `"empty": not has_documentable_content(ws)`, which `WikiGeneralNotice.tsx` folds into its
early `return null` (alongside the read-only and already-generated cases) — the canvas shows no
Generate button at all for a codeless repo, rather than a button that always fails. As soon as real
code appears, the next content-changed/status refetch flips `empty` back to `false` and the button
appears on its own.

## C2-join clustering — the fixed grouping the model no longer invents (057-wiki-general-redesign)

Before this change, Phase A (below) asked the model to decide which files form a component and which
components connect to each other, reasoning over `wiki-context` prose with no verified call-graph
signal — the actual complaint this feature fixes. `dependencies/clustering.py` now computes that
grouping deterministically from `GraphBuilder`'s real, resolved call/import edges (see
[`engine.md`](engine.md)'s C0 section) — no model call, callable from a live `reanalyze()` path
without violating Principle I, though nothing in this pipeline calls it there today.

**Infra-path pre-filter.** Before the chain below ever runs, `_is_infra_path` drops CI/tooling
clutter from the candidate file set entirely: `.github/`, `.specify/`, a root-level `*.yaml`/`*.yml`
(e.g. `.gremlins.yaml`), and anything under a `testdata/` directory. These files have real symbols
(the YAML analyzer parses them) but no architectural meaning and no import/call edges to app code, so
without this filter every one of them fell through the whole chain into `undetermined_files` and cost
a real-repo run (lm-panel-monorepo) 31 files' worth of `resolve-undetermined` LLM guessing — most of
it CI workflow/action/fixture yaml, not code. A real `.go`/`.py` file that is merely lone-in-its-folder
with no detected edges (e.g. a standalone `main.go` tool, a fixture-only test) is untouched by this
filter and still goes through the chain normally, landing in `undetermined_files` if nothing resolves
it — this filter is a path-based exclusion, not a catch-all for "isolated" files.

**The chain, in order, per level** (`build_component_clusters`/`build_container_clusters`, "Chain of
Responsibility" — `specs/057-wiki-general-redesign/plan.md`'s Pattern 2): a fixed, ordered sequence of
signals, each one tried in turn, stopping at the first that gives an answer:

1. **Folder default** — a folder shared by >=2 files (files) / a top-level directory shared by >=2
   components (containers) is a real default group; a lone file/component in its own folder falls
   through. A single-item repo skips the `>=2` threshold entirely (no ambiguity to resolve).
2. **Call-graph majority** — an unresolved item's cross-file call-graph neighbors vote for their own
   (already-resolved) group, weighted by call count; the strict top vote-getter wins, a tie falls
   through (`_plurality_winner`).
3. **Whole-group merge by aggregate traffic** — items still unresolved after steps 1-2 are connected
   via their mutual call-graph edges (ignoring edges to already-resolved groups, which step 2 already
   had a chance to use); each resulting connected cluster of >=2 items becomes one new group
   (`merged::<smallest member's id>`).
4. **Import fallback** (files only) — for a file only ever *imported*, never *called* (e.g. a bare
   `from x import CONST`, which produces no resolved call edge — `GraphBuilder`'s edges come from
   `Symbol.references`/`qualified_references`, not raw `Symbol.imports`), `_raw_import_edges` builds a
   second, independent file<->file edge set straight from every `Symbol.imports` value resolved via
   `analyzer.resolve_import`, and the same majority-vote step runs again against it. Container
   clustering (level 2) skips this step — `Symbol.imports` is a file-level concept only.
5. **Undetermined** — a file no signal could place lands in `ClusterResult.undetermined_files`; a
   *component* with no signal at the container level becomes its own solo container
   (`solo::<component-id>`) instead — research.md's undetermined-bucket escalation (below) is scoped
   to files only, so a component is never left without a container to report through the bridge.

🔵 The numeric thresholds above (`>=2`, strict-plurality-wins) are deliberately the plan's own
judgment call, not validated against a real large repo — `research.md #6` fixes the mechanism/order
on purpose and defers tuning; if empirical measurement (`docs/planning/wayfinder/
wiki-general-redesign/tickets/004-empirical-validation-out-of-scope.md`) later says otherwise, only
the constants inside each step should need to change, not the chain's shape or its tests' structure.

**Undetermined-bucket escalation.** `undetermined_candidates(file, result, weights)` gives each
undetermined file 2-3 real candidate components (id + already-assigned `files[]`, padded with
arbitrary components if the file has zero call-graph neighbors at all) — never code, never the full
graph. `GET /repos/{id}/wiki-general/clustering` (`bridge/wiki_general_agent.py::compute_clustering`,
`bridge/routes/wiki_general.py`) serializes the whole `ClusterResult` plus this per-file candidate map
for Phase A to call *before* inventing anything; SKILL.md's Phase A resolves every undetermined file
in one batched pass, picking only among the given candidates (never a new group) — the same
"restricted-choice, one model call" shape `research.md #7` specifies. Phase A's real remaining job is
naming each fixed group (`id`/`name`/one-line purpose from `wiki-context` prose) and this one
escalation — never deciding which files belong together. Tests:
`tests/unit/test_wiki_general_clustering.py` (one per chain step, the manifest shape, a
same-input-twice reproducibility check), `tests/unit/test_bridge_wiki_general_routes.py`'s clustering
route test.

## Page tree

```text
.codechroma/wiki-general/
├── manifest.json          # bookkeeping only, written last -- see above
├── index.md                # C1: system overview + links to every container
├── c2/
│   └── <container-id>.md   # one per container: description + links to its components
└── c3/
    └── <component-id>.md   # one per component: description + "## Elements" bullets (C4)
```

File count is `1 + len(containers) + len(components)` — a C4 element is a bullet inside its
component's page, never its own file (a component covers a lot of ground; splitting further was
judged to fragment it for no reader benefit). Each element carries zero, one, two, or three
sub-bullets naming a code reference — `File:`/`` Class: `<path>::<Name>` ``/
`` Function: `<path>::<name>` `` — or none at all when it's purely conceptual (a DB table, a queue).
Grounded through the existing wiki, not raw code: the skill walks `.codechroma/wiki/` breadth-first
via repeated `GET /repos/{id}/wiki-context?paths=...` calls (the same route
`codechroma-draw-diagram` uses, `docs/architecture/wiki-generator.md`'s "New consumer" section),
never reading source files itself.

### Generation pipeline (058-wiki-general-deterministic-fanout) — deterministic fan-out, not a prompt

🔴 **Superseded design, kept in git history for context.** Through 048/057, the whole generate run
was one self-orchestrating `claude -p` process: a five-phase `SKILL.md` (`codechroma-wiki-general`)
told the model to plan, fan out C3/C2 writes to `Task` subagents in waves, then self-check. On a
large repo (`lm-panel-monorepo`, 124 C3 components) that broke down: after two honest waves of 8, the
model stopped following the prose fan-out plan, spawned one giant subagent for the other 116
components, and two of *its* subagents recursively re-invoked the same skill (`Skill
(codechroma-wiki-general)`) — burning the whole 900s timeout before `manifest.json` was ever written.
Five consulted LLMs agreed on the same fix: fan-out/wave-barriers/self-check belong in deterministic
code, never in a prose instruction to a model. See
`docs/planning/058-wiki-general-deterministic-fanout/058-wiki-general-deterministic-fanout.md` for
the incident writeup and full design; `048-wiki-general-parallel-fanout.md`'s "Open items" is the
now-closed incident log this section used to carry.

**The pipeline, in order** (`bridge/wiki_general_pipeline.py::run_pipeline`, wired in as
`SkillAgent(..., run_body=run_pipeline)` — see "`run_body`: swapping the subprocess for a coroutine"
under Backend below):

1. **Clustering + deterministic ids** — `compute_clustering(ws)` (unchanged, see "C2-join clustering"
   above), then `wiki_general_naming.assign_ids()` (Python, no model call) picks every
   component/container's real `id`/display name from its heaviest folder/file, deduped against every
   other id already assigned at that level.
2. **`resolve-undetermined`** — 0 or 1 worker call (`wiki_general_worker.run_worker_job`, batched:
   every undetermined file in one call), given each file's own real candidate component ids. A pick
   outside that file's candidate set (the model didn't follow the "never invent an id" instruction) is
   silently corrected to the first real candidate — Python enforces the constraint the old prompt only
   asked for.
3. **`write-c3`** — one worker call per component, all launched concurrently, bounded by
   `asyncio.Semaphore(settings.wiki_general_pipeline.worker_concurrency)` (default 6) instead of a
   model-managed "wave of 8". Each call is zero-tool and schema-constrained
   (`--output-format json --json-schema ... --safe-mode --strict-mcp-config --tools ""` —
   `ClaudeAdapter.build_worker_argv()`): the model answers one `{summary, description}` JSON object
   and nothing else, with no `Task`/`Skill`/`Agent` tool available to recurse into anything with. A
   failed job retries up to `max_retries_per_job` (default 2) times before the whole pipeline aborts.
   `elements[]` is **not** part of that call — `_deterministic_elements()` builds it in plain Python
   from `group_by_file()`'s already-parsed classes/methods/functions (`digest.py`, the same data the
   plain wiki renders from), each description cut to its first sentence
   (`wiki_general_job_context.first_sentence`). The model previously wrote `elements[]` itself, reading
   only docstrings it had no more information than `_deterministic_elements` does — asking it to
   restate that as JSON bought no accuracy, only a slower, larger response. `_is_test_file()` drops
   `_test.go`/`test_*.py`/`*.test.ts`/`Test*.java`-style files from the element list (an LM-panel-
   monorepo `vllm` component's list went from an LLM-curated 11 to a raw 74 with tests included, to 28
   with them filtered — matching the density the model's own curation used to produce).
4. **`write-c2`** — same shape, one call per container, barriered on every `write-c3` above finishing
   — a container prompt is given its members' already-written `summary` fields directly (no re-read).
5. **`system-narrative`** — one call for `index.md`'s opening paragraph, barriered on every `write-c2`
   above.
6. **Deterministic write** — `index.md`/`c2/*.md`/`c3/*.md`/`manifest.json` are rendered and written
   by Python from the worker responses collected above; `## Connections` sections are rendered
   straight from `clustering`'s real `component_edges[]`/`container_edges[]` (translated to real ids),
   **never asked of the model** — the old design's `CONNECTS-INVALID` failure class doesn't exist for
   a fresh generate anymore. Nothing is written to `.codechroma/wiki-general/` before this step: a
   failed worker call (after retries) or an unsupported adapter (below) aborts with `state: "error"`
   and zero pages on disk, same as the old design's Phase-A-fails-writes-nothing behavior.
7. **Self-check** — `check_wiki_general.py`'s `run_checks()`, called in-process (not a subprocess):
   the pipeline builds a `fetch_gaps` closure from `build_wiki_context()` directly instead of an HTTP
   round trip to itself. See "Self-check" below for where the script itself now lives.

**Provider capability gate.** `wiki_general_worker.require_minimal_context_support(adapter, binary)`
checks `llm.cli_adapters.supports_minimal_context_workers()` (structural: does the adapter implement
`build_worker_argv`/`parse_structured_output`?) before a single job runs. Only `ClaudeAdapter` does
today — `codex`/`kimi-cli` (`llm/cli_adapters.py`) don't, by design of that separate, parallel effort
(058's own scope note); picking one of them for the "planning" provider group makes `run_pipeline`
return `{"state": "error", "error": "adapter '<name>' does not support minimal-context workers"}`
immediately, never a silent fallback to a full-context call.

**Timeouts.** `job_timeout_seconds` (default 120s, `WikiGeneralPipelineConfig`) bounds one worker
call; `SkillAgentTimeoutsConfig.timeout_seconds["wiki-general"]` (now 3600s, was 900s) is no longer
the primary time limit — jobs are already individually bounded — it's a safety net against the
pipeline's own logic hanging (e.g. a barrier never releasing), not against slow jobs.

## Self-check (`.claude/skills/codechroma-wiki-general-update/scripts/check_wiki_general.py`)

🔴 Moved here from the now-retired `codechroma-wiki-general` skill (058) — this is the one skill left
that still needs a synced, standalone copy of the script (its own `claude -p` run shells out to it
exactly as before; see its `SKILL.md`'s Phase B). The generate pipeline above no longer shells out to
it at all: `run_checks(wiki_dir, fetch_gaps)` is a plain importable function now, loaded via
`importlib` from the same file (`wiki_general_pipeline._load_check_module()`) and called with an
in-process `fetch_gaps` built from `build_wiki_context()` — `main()` is a thin CLI wrapper around the
same function, building its `fetch_gaps` from a real HTTP call instead
(`_http_gap_fetcher(url, repo)`). One validation implementation, two ways to resolve a wiki-context
gap.

Reads the tree from disk directly (there is no resolved HTTP GET to read instead — this is a
full-replace markdown tree, not a server-merged artifact the way a diagram is). Checks: unique
container/component ids, every component's `container` names a real container, every container owns
at least one component, every manifest-listed page actually exists on disk. One live HTTP call: every
declared `File:`/`Class:`/`Function:` reference's path (stripped of any `::Symbol` suffix) is checked
against `GET /repos/{id}/wiki-context` — a path the real wiki has no page for comes back in the
response's `gaps[]` and fails the run as `HALLUCINATED`. A page that exists but isn't linked from its
parent prints `LINK-MISSING`, advisory only. Exit codes: `0` OK, `1` FAILED, `2` ERROR (couldn't read
the manifest, a page, or reach the bridge at all) — simpler than `check_diagram.py`'s four-tier
density/shape system, since there's no dagre density concept for a markdown page.

**`Connects:` grounding (057-wiki-general-redesign).** A component or container page states which
others it connects to with a top-level bullet, same style as `File:`/`Class:`/`Function:` but with no
code path:

```markdown
## Connections

- Connects: `billing`
```

`_CONNECTS_RE` parses it; `_check_connects(wiki_dir, containers + components, edges, report)` (no
live HTTP call — `edges[]` is already in the local manifest) builds a symmetric adjacency map from
`manifest["edges"]` and flags `CONNECTS-INVALID '<id>' claims a connection to '<target>'` for any
claimed target with no matching entry. One-way, same asymmetric shape as `HALLUCINATED`: a real
connection the page never mentions is never a violation, only a false claim is (research.md #9).
`edges[]` missing entirely (a manifest predating this feature) is treated as no known edges — every
`Connects:` line fails, same as `gaps[]` from an unreachable page.

**Batched fixup, not a script-level loop.** `check_wiki_general.py` never calls a model and never
retries itself — one static analysis pass, same as every other check. 🔴 A `CONNECTS-INVALID` line
can't actually happen on the **generate** path anymore (058): `run_pipeline` renders every
`## Connections` section itself, straight from `clustering`'s real edges, never asking the model — so
this failure class, and the whole fixup loop below, is scoped to the **update** skill only, whose own
`SKILL.md` still fans component/container writes out to subagents that state their own `Connects:`
lines. Resolving one there is `codechroma-wiki-general-update/SKILL.md`'s Phase B job: one batched
retry subagent covering every flagged `{owner, claimed target}` pair across all pages, then a re-run
of the plain check. A line still invalid after that one pass is mechanically removed —
`python3 check_wiki_general.py --dir . --strip-connects <page-path> <target-id>` (`_strip_connects_line`,
a second, unrelated CLI mode: regex-deletes the one matching bullet, `0` removed / `2` no match, never
touches the manifest) — and the **run still ends in failure** (`{"state": "error", ...}`) even though a
fresh check now passes cleanly, since a page that lost a claimed connection it couldn't ground isn't a
clean run. On the generate path, a self-check failure of any kind is just a flat pipeline error —
`run_pipeline` has no fixup loop; the pages it already wrote are left on disk for debugging, only
`manifest.json` (the `SkillAgent` artifact) is snapshotted/restored automatically.
Tests: `tests/unit/test_wiki_general_check_script.py`'s grounded/invented/omitted-is-fine/strip cases.

## Staying current after a commit (050-wiki-general-auto-refresh)

A commit landing in a workspace (main or an agent's own worktree — see `parallel-agents.md`) can
make an existing wiki-general tree stale. The bridge only ever **notifies** the canvas of that —
nothing regenerates on its own; the user still clicks a button, same philosophy as the first
generation. What changed is *what* that button does: a second, narrower skill patches only the
pages a commit actually touched, instead of the first skill's full wipe-and-rebuild.

**Detecting a commit.** `GitSync.head_changed()` (`bridge/git_sync.py`) tracks `git rev-parse HEAD`
separately from its existing working-tree-diff signature, seeded eagerly at construction so a
workspace coming up never reads as a spurious "commit". It fires on any HEAD move — commit,
checkout, merge, rebase, reset, pull — not literally `git commit` only; isolating that further would
need reflog parsing, which isn't worth it here. `WorkspaceWatchers.on_repo_change()` (already firing
on every debounced filesystem batch, `.git/` included) checks it and, if true, emits the existing
`{"type": "wiki-general"}` ping — no new ping type, no new thread-crossing machinery: `Workspace.emit`
already crosses from the watcher thread to the app loop for the `"changed"` ping right above it.

**Staleness.** `.codechroma/wiki-general/manifest.json` gains one field, `generated_at_commit` (the
HEAD sha the tree currently reflects), stamped by the **backend** — never the skill — right after a
run finishes cleanly (`wiki_general_agent.stamp_generated_commit`, wrapped around both the generate
and update routes' `on_status_change`). `wiki_general_agent.is_stale(ws)` compares that field against
current HEAD; `GET /repos/{id}/wiki-general/status` folds the result into a new `stale: bool` field.
An unstamped manifest (predates this feature, or a page edited by hand outside a run) reads as stale
by construction — there's nothing to compare it against that would ever call it fresh.

**The incremental skill — `.claude/skills/codechroma-wiki-general-update/`.** Sibling to
`codechroma-wiki-general`, its own `KIND_UPDATE = "wiki-general-update"` `SkillAgent` (registered in
`services.py` alongside the full-rebuild one; `SkillAgentTimeoutsConfig.timeout_seconds
["wiki-general-update"]` defaults to a shorter 300s, since it touches far fewer pages).

🔴 **Full recompute, not a path-grep (057-wiki-general-redesign).** `update_wiki_general`
(`routes/wiki_general.py`) no longer matches changed paths against existing pages' text — it forces
the graph current (`ws.git_sync.sync(ws.engine)`, since the background watcher may not have caught up
yet inside one synchronous request) then calls `wiki_general_agent.compute_update_delta(ws)`, which
recomputes the **entire** C2-join clustering (`dependencies/clustering.py`, same code the full-rebuild
skill's `GET .../wiki-general/clustering` route calls) and diffs it against the manifest's stored
`files[]`/`edges[]` — `_diff_manifest`/`_diff_level` implement data-model.md's Unaffected/Rewritten/
Created/Deleted state machine exactly: an id whose fresh group has the same files and the same real
neighbors stays `Unaffected` (no model call); a match with a changed file set or neighbor set becomes
`Rewritten`; a fresh group with no old-id file overlap becomes `Created`; an old id nothing fresh
group matches becomes `Deleted`. Matching a fresh group to an old id is majority file-overlap (a tie
counts as no match, favoring `Created`/`Deleted` over a guess), not exact-set equality — this is what
lets "one file moved from component A to component B" mark *both* A and B `Rewritten` instead of
deleting and recreating either one. A files[]-less old id (a manifest predating this feature) counts
as unmatchable by construction, so an upgrade's first Update treats everything as `Created`/`Deleted`
— matching contracts/manifest-schema.md's "no backward-compatibility layer" note.

`apply_update_delta(ws, delta)` then applies the **mechanical, model-free** half before the skill ever
runs: every `Deleted` id's page is unlinked, its link stripped from the parent page
(`_strip_link_to`, a regex over markdown link syntax), and its manifest entry dropped; every `Created`
id gets a deterministic name — `_deterministic_name(files, top_level=...)`, the group's heaviest
folder (or file, if no folder repeats) — **no model call**, matching research.md §11's Update-only
auto-naming decision; every id's `files[]` is refreshed in the manifest; and `edges[]` is fully
recomputed from the fresh clustering's `component_edges[]`/`container_edges[]`, translated from
internal to real ids (`_translate_edges`). Only *then* does the route render
`prompts/wiki_general_update_agent.yaml` with four JSON lists — `created_components_json`/
`rewritten_components_json`/`created_containers_json`/`rewritten_containers_json` — and start the
skill: the skill's whole job is writing/patching exactly those pages, nothing else, no replanning.
There is no more `gaps` list — every real file lands in some component or the small undetermined
bucket the full-rebuild skill's own escalation call owns (Update does not run that escalation itself;
an undetermined file just doesn't appear in any component's `files[]` until a future Generate or a
call that resolves it).

`find_affected_components`/`changed_paths_since_last_run` still exist (their own tests still cover
the old path-grep matching behavior) but the update route no longer calls either — full recompute
replaced them as the mechanism, per research.md §10's "diffing a freshly-recomputed manifest against
the stored one gives an exact, correct answer... in one mechanism instead of separate detection logic
per case." Tests: `tests/unit/test_wiki_general_affected.py`'s `_diff_manifest` cases (a moved file
marks both components `Rewritten`, an emptied component `Deleted`, an unrelated one `Unaffected`),
`tests/unit/test_bridge_wiki_general_update_route.py` (the real create/rewrite/delete sequence
against `sample_repo`, deterministic naming, `edges[]`/`generated_at_commit` recomputed together).

🔴 `stamp_generated_commit`'s own staleness plumbing is unchanged by the above: the changed-paths
concept `changed_paths_since_last_run(ws, manifest)` used to feed `find_affected_components` came from
`WorkspaceGit.changed_since(base_commit)` (`manifest["generated_at_commit"]` vs. what's on disk now),
never from `WorkspaceGit.divergent_files()` (which is hard-coded to diff against `"HEAD"` for the main
workspace, so it only ever sees *uncommitted* edits) — that fix (2026-09-16) still matters for
`is_stale()`/`head_changed()` below, independent of which mechanism decides *what to patch*.

**Concurrency.** Both skills write the same `manifest.json`, so `routes/wiki_general.py`'s
`_refuse_if_other_running` 409s a `/generate` while `/update` is mid-run and vice versa — running
both at once would let one's snapshot/restore clobber the other's fresh output. 🔴 That check alone is
a TOCTOU race: `generate`'s own `prepare_new_run()` yields the event loop (`asyncio.to_thread`)
between the check and its state actually flipping to `"generating"`, so a request landing in that gap
used to see both kinds as "idle" and start anyway. Every route that can start a run now holds
`wiki_general_agent.run_lock(ws.id)` (one `asyncio.Lock` per workspace) across the whole
check-then-flip sequence, closing the gap; regression test:
`test_bridge_wiki_general_update_route.py::test_generate_and_update_cannot_both_start_from_overlapping_requests`.
The interactive `POST .../status` route also gained an optional `"kind"` body field (defaulting to
`KIND`, so the older full-rebuild skill's unmodified prompt keeps working) — before this it always
reported through the full-rebuild `SkillAgent` regardless of which skill was actually running
interactively, so an interactive update run's progress silently mutated the wrong job's bookkeeping
and skipped the mutual-exclusion check entirely. Status/output/cancel are merged across both
`SkillAgent` instances (whichever is `"generating"` wins) so the canvas sees one job regardless of
which kind is actually in flight, and the update route's callbacks ride the same `"wiki-general"`-
flavored ping names (`job_callbacks(KIND, ...)`, not `KIND_UPDATE`) so the frontend needs no second
subscription.

## Backend

- `Workspace.wiki_general_index_path` (`bridge/workspaces.py`) — `.codechroma/wiki-general/index.md`,
  a `WorkspaceArtifacts` property mirroring `wiki_index_path` exactly. A `FileWatcher` on that same
  path (`WorkspaceWatchers.wiki_general_watcher`) pings `{"type": "wiki-general"}` on save — the
  content-changed signal, distinct from the job-status ping below (and reused, per the section above,
  as the post-commit staleness signal too).
- `services.py`'s `_build_skill_agents()` registers `agents["wiki-general"]` from
  `wiki_general_agent.build_wiki_general_agent()`, and `agents["wiki-general-update"]` from
  `build_wiki_general_update_agent()` — neither through `DIAGRAMS`/`BUILTIN_TYPES`, the two lines that
  make "not a diagram type" a checked property rather than a description.
- **Provider routing.** Both `SkillAgent`s are built with `name="wiki_general_agent"`/
  `name="wiki_general_update_agent"` (see above), and `SkillAgent.resolve_cli()`
  (`bridge/skill_agent.py`, public since 058 — `wiki_general_pipeline.run_pipeline` calls it too)
  looks up that exact name via `load_assignment(self.name)` — so both are registered as `agentic`
  `CallSite`s in `llm/call_sites.py`, in the `planning` group alongside `epic_brief_agent`. Picking a
  provider for "Planning" on the Model routing tab now also governs which CLI drives the generate
  pipeline's worker pool / the update skill; see [`llm-settings.md`](llm-settings.md).
  `SkillAgentTimeoutsConfig.timeout_seconds["wiki-general"]` is now 3600s (058: a safety net for the
  pipeline's own logic, not the primary time limit — see "Timeouts" above); `["wiki-general-update"]`
  is unchanged at 300s.
- **`run_body`: swapping the subprocess for a coroutine (058).** `SkillAgent.__init__` takes an
  optional `run_body: RunBody | None` (`Callable[[SkillAgent, Workspace | None, str, OnOutput |
  None], Awaitable[dict]]`); `build_wiki_general_agent()` is the only caller that sets one
  (`run_body=wiki_general_pipeline.run_pipeline`, deferred-imported to dodge a cycle — the pipeline
  itself imports `compute_clustering`/`wiki_general_dir` from `wiki_general_agent.py`). When set,
  `_run()` dispatches to `_run_pipeline_body()` instead of `_run_cli()` — same snapshot/timeout/
  restore/`has_artifact()` shape as the subprocess path, just wrapping `self.run_body(...)` instead of
  spawning one `claude` process. `SkillAgent.start()` grew an optional `workspace: Workspace | None`
  parameter threaded through to `run_body` for this reason — every other call site (c1/patterns/
  research/epic-brief/custom/diagram-type/canvas-chat) still omits it and is unaffected.
  `SkillAgent.job_procs: dict[str, set[Process]]` (alongside the existing single-process-per-repo
  `self.procs`) lets a `run_body` register many concurrent worker subprocesses per repo id
  (`register_job_proc`/`unregister_job_proc`); `stop()`/`cancel()` kill everything in both dicts, so
  `POST /cancel` during a generate run kills every in-flight worker, not just one.
- **`codechroma_SKILL_LOG_DIR` debug logging now also covers the pipeline (058 follow-up).**
  `skill_agent.open_debug_log`/`debug_write` were made public (dropped their `_` prefix) so callers
  outside `_run_cli` can reuse them. Two layers, both no-ops unless the env var is set: `run_pipeline`
  opens one whole-run file (same `<name>-<repo_id>-<timestamp>.log` shape `_run_cli` always used) and
  writes a `START`/`END`/`CANCELLED` line per job — component id, duration, ok/error, and the current
  `in_flight` count against `worker_concurrency` — the answer to "how many ran in parallel and when".
  `wiki_general_worker._run_once` separately opens one file per job (`<name>-<repo_id>:<job_label>-
  <timestamp>.log`, `job_label` e.g. `c3:auth`/`c2:gateway`/`resolve-undetermined`/`system-narrative`)
  and writes that job's raw `claude -p` argv/stdout/stderr, appending across `run_worker_job`'s
  retries so one file holds every attempt.
- `bridge/routes/wiki_general.py` — its own router (not `routes/diagrams.py`), registered in
  `routes/__init__.py`'s `ROUTERS`:

  | Route | Notes |
  |---|---|
  | `GET /repos/{id}/wiki-general/status` | `{state, error, has_wiki_general, stale, empty}` — job state (whichever of the two `SkillAgent`s is generating, else the full-rebuild one's) merged with `agent.has_artifact()`, `wiki_general_agent.is_stale(ws)`, and `not has_documentable_content(ws)` |
  | `POST /repos/{id}/wiki-general/status` | Interactive-run counterpart (`agent.mark_generating`/`mark_done`) — a terminal-panel agent running the skill directly, not via the button, reports its own progress the same way, mirroring `diagram-skills.md`'s "Reporting generation status from an interactive run"; a `state: "generating"` body calls `prepare_new_run(agent, ws, guard_content=kind == KIND)`, which refuses codeless-repo runs for the full-rebuild `kind` only, then clears/syncs unless a run is already generating; a clean finish stamps `generated_at_commit` |
  | `POST /repos/{id}/wiki-general/generate` | `WritableWs` — the **first** agent-driven generate route a canvas button calls directly (no live C1/Patterns "Retry" button exists to copy from), so it needed the read-only guard those never picked up; `prepare_new_run` refuses with `NO_DOCUMENTABLE_CONTENT_ERROR` (no skill launched) on a codeless repo, otherwise clears/syncs unless a run is already generating, refuses if an update run is; stamps `generated_at_commit` on success |
  | `POST /repos/{id}/wiki-general/update` | `WritableWs` — the incremental skill's route; never clears the tree, refuses if a generate run is in flight, stamps `generated_at_commit` on success |
  | `GET /repos/{id}/wiki-general/clustering` | The fixed C2-join grouping (`compute_clustering`) — 🔵 `run_pipeline` calls the function directly, not this route; nothing in the frontend calls it either since 058 retired the skill that used to `curl` it from inside a run. Left in place (harmless, exercised by its own route test) rather than removed as part of this change. See "C2-join clustering" above |
  | `GET /repos/{id}/wiki-general/output` | Progress lines for whichever kind is active |
  | `POST /repos/{id}/wiki-general/cancel` | `WritableWs`; cancels whichever kind is active via `stop_and_notify` (`routes/_skill_jobs.py`) |

- 🔴 **`codechroma-wiki-general` is retired (058).** The generate pipeline no longer calls the skill
  at all (it uses `run_body`/`wiki_general_agent.py`'s own `wiki_general_job_*.yaml` prompts
  directly), so `.claude/skills/codechroma-wiki-general/` and `src/codechroma/prompts/
  wiki_general_agent.yaml` are deleted, and `"codechroma-wiki-general"` moved from
  `skill_sync.SKILL_NAMES` to `RETIRED_SKILL_NAMES` — `prune_retired_skills()` removes the stale
  directory from a repo an older version had already installed it into (same mechanism already used
  for `codechroma-c1`/`codechroma-patterns` after their merge). `.claude/skills/
  codechroma-wiki-general-update/` is unchanged and still in `SKILL_NAMES` — its own generation
  mechanism is out of scope for 058 (see "Staying current after a commit" below); it now also carries
  `scripts/check_wiki_general.py` (moved there, see "Self-check" above).

## Consumed by `codechroma-draw-diagram` (049-wiki-general-diagram-context)

The mirror image of "Grounded through the existing wiki" above: wiki-general reads the older wiki
while generating, and once it exists itself, the diagram-drawing skill reads *it* first, ahead of
the older wiki, when authoring c1/patterns/custom. `GET /repos/{repo_id}/wiki-general-context`
(`bridge/wiki_general_context.py::build_wiki_general_context` +
`bridge/routes/diagrams.py::get_wiki_general_context`) reads the manifest, reusing this file's own
`_valid_manifest()` gate. See `docs/architecture/diagram-skills.md`'s "Wiki-first fetch order — Step
0" for the route's shape, its no-`paths=`/no-sync/no-auto-trigger design choices, and how `c1`/`impact`
each treat it differently.

## Frontend

- `SkillRunKind` (`engine-client/EngineClient.ts`) carries `"wiki-general"` — generate/cancel/output
  (and the content-changed `subscribeDiagram`) are the existing generic per-kind methods, unchanged;
  no new dedicated methods needed for those (the update route's callbacks ride the same kind's ping
  names, per "Staying current after a commit" above). `getWikiGeneralStatus()` and `updateWikiGeneral()`
  are the two dedicated methods: the former because its response (`WikiGeneralStatus`, `state/types.ts`
  — now also carrying `stale: boolean`) is wider than plain `DiagramGenerationStatus`, the latter
  because it hits its own `/wiki-general/update` route rather than the generic `/generate`.
- `useWikiGeneralStatus` (`state/useWikiGeneralStatus.ts`) is its own hook, not
  `useDiagramGeneration` — same trigger/stop shape, plus `update()` (mirrors `trigger()`'s optimistic
  flip, calling `updateWikiGeneral()` instead of `generateDiagram()`). It also owns `has_wiki_general`
  and `stale`: an "idle" job-status ping refetches both (a run just finished, check what it produced
  and whether it's still behind HEAD) and the content-changed ping refetches them too (covers an
  out-of-band change, e.g. another tab, or the commit-detected ping from "Staying current after a
  commit" above).
  🔴 Both of those refetches (`refetchArtifact`) merge in only `has_wiki_general`/`stale`, never
  `state`/`error` — a real bug fixed 2026-09-14: `prepare_new_run()`'s `clear_wiki_general()` deletes
  `index.md` *before* the backend job flips to "generating" (`routes/wiki_general.py`'s
  `generate_wiki_general`/`set_wiki_general_status` both call `prepare_new_run` first, `agent.start`/
  `mark_generating` after), so that delete fires the content-changed watcher ping while the job's own
  `get_state()` still reads whatever it was before (usually "idle"). The old code's shared `refetch`
  did a bare `.then(setStatus)` full-object overwrite, so this ping's response could land after
  `trigger()`'s optimistic `state: "generating"` flip and stomp it back to "idle" for the couple of
  seconds until the real "generating" job-state ping arrived — the Generate button briefly
  re-appearing mid-run. The one full-object fetch left is the hook's very first mount fetch, before
  anything else has set `state`/`error`/`has_wiki_general`/`stale`. Regression test:
  `useWikiGeneralStatus.test.ts`'s "a content ping mid-generate never clobbers the generating state
  back to idle".
- `WikiGeneralNotice.tsx` (`canvas/`) — its Generate and Update buttons are both disabled
  (`useGroupAvailability("planning")`, `llm-settings/useGroupAvailability.ts`) with an inline
  `NO_PROVIDER_HINT` title when the planning group's effective CLI isn't on PATH, the same pattern
  `EpicBriefView.tsx` already uses for that group — see "Provider routing" above. `null` for a
  read-only workspace, once `has_wiki_general` is true and it's neither stale nor generating, **or**
  once `status.empty` is true and it's not
  generating (053-wiki-general-empty-repo-guard: a codeless repo gets no Generate button at all, not
  a button that always fails); otherwise one of three bodies: "Architecture wiki not created yet" +
  Generate (nothing on disk yet, but there's real code to document), "Architecture wiki may be out
  of date" + Update (`data-testid="wiki-general-update"`, exists but stale — the canvas's first
  actionable staleness affordance, deliberately a click, never automatic), or a status line + Stop
  while either kind is generating (this last one still shows even if `empty` is true, e.g. an
  interactive terminal-run started directly). Mounted in `RootCanvas.tsx` beside
  `SidecarSummaryCard`/`DiagramHealthNote`, third in the bottom-left column (`left: 1rem;
  bottom: 7rem` — the bottom-right progress-bar zone is reserved for non-agent-driven background
  jobs, see 035's own plan). This is the canvas's first real "Generate" button —
  `DiagramHealthNote`/`SidecarSummaryCard` only ever read `useDiagramGeneration` status, neither
  renders one.

## Tests

`tests/unit/test_wiki_general_check_script.py` (structural checks, the hallucinated-path failure,
the advisory link check, `Class`/`Function` symbol-stripping — now loaded from
`codechroma-wiki-general-update/scripts/`) · `tests/unit/test_wiki_general_naming.py`
(`slugify`/`dedupe_id`/`deterministic_name`/`assign_ids`, 058) · `tests/unit/test_wiki_general_worker.py`
(`require_minimal_context_support`'s Claude-yes/Codex-no gate, `run_worker_job`'s retry-then-succeed
and give-up-after-max-retries paths, via `tests/unit/fake_worker_claude.py`) ·
`tests/unit/test_wiki_general_pipeline.py` (the deterministic page/index renderers, the
undetermined-assignment fallback, and one full `run_pipeline()` run against a monkeypatched
clustering + faked worker subprocess) · `tests/unit/test_skill_agent_run_body.py` (`run_body`
dispatch, snapshot/restore/validate parity with `_run_cli`, `stop()` killing every registered
`job_proc`) · `tests/unit/test_wiki_general_agent.py`
(`has_documentable_content()` — false on no symbols, false on `yaml`-only symbols, false on doc/config
extensions even under a spoofed non-yaml language, true as soon as one real-code symbol exists) ·
`tests/unit/test_bridge_wiki_general_routes.py`
(status/generate/output/cancel, the interactive status route, read-only rejection, the events-socket
broadcast, `clear_wiki_general()` wiping a stale page and `sync_plain_wiki()` bootstrapping a missing
plain wiki/reporting a sync failure as an error, on both the button and interactive routes, leaving an
in-flight run's pages alone, `"empty"` in the status response, and `/generate`/interactive
`/status{"state":"generating"}` refusing on a codeless repo without ever launching `claude`) ·
`tests/integration/test_wiki_general_end_to_end.py` (a real bridge + real `sample_repo` analyze, a
faked worker subprocess via `fake_worker_claude.py`, through to `has_wiki_general: true`; a worker job
that keeps failing; regenerating over a previously-invalid manifest) ·
`web/src/state/useWikiGeneralStatus.test.ts` (now also: `empty` merges
through the content-changed refetch the same as `has_wiki_general`/`stale`) ·
`web/src/canvas/WikiGeneralNotice.test.tsx` (now also: silent on `empty: true` unless generating,
still shows the generating UI when both `empty` and `state: "generating"` are true, Generate/Update
both disabled when `useGroupAvailability("planning")` is false) ·
`web/src/state/useSkillOutput.test.ts` (the catch-up
read merging with, not duplicating, lines the live subscription already appended).

**Staying current after a commit:** `tests/unit/test_git_sync.py` (`head_changed()` — false right
after construction, true once per commit, false for an uncommitted edit, the unborn-HEAD first-commit
edge case) · `tests/unit/test_workspaces.py` (`on_repo_change()` pings `"wiki-general"` after a real
commit, not after a plain edit) · `tests/unit/test_wiki_general_affected.py`
(`find_affected_components()`'s own still-covered path-grep behavior, plus `_diff_manifest()`'s
Update state machine — a moved file marks both its old and new component `Rewritten`, an emptied
component `Deleted`, an unrelated one `Unaffected`) · `tests/unit/test_bridge_wiki_general_update_route.py`
(`/update` never wipes existing pages, the two kinds refuse to run concurrently in either direction,
the real create/rewrite/delete sequence against `sample_repo` including a deterministically-named
`Created` component, `edges[]`/`generated_at_commit` recomputed together on a clean finish) ·
the `stale` field's extra cases folded into the existing `test_bridge_wiki_general_routes.py` and
`test_wiki_general_end_to_end.py` status assertions.
