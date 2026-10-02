# Epics & requirements view (`src/codechroma/requirements/`, `bridge/epics_resolver.py`) — the fourth view

⚠ **016-single-canvas-dashboard Stage 4 deleted `EpicsView.tsx`, `EpicBoxes.tsx`,
`EpicConnections.tsx`, `epicsGraph.ts` and `epicsLayout.ts`** (the pure id/label helpers
`SpecsFrame.tsx` needs moved to `canvas/epics/specStageHelpers.ts`). An epic item now renders as a
flat `CanvasNodeBox` (via `canvas/recipes.py`'s shared `reshape()`, 036), reached through the rail's
`RecipeMenu` ("Epics") rather than its own view — the box-graph/expand-per-item interaction this file
describes is gone. **`canvas/epics/brief/` (the AI brief) survived**, reachable by clicking an epic
element, which opens a small standalone `EpicBriefPanel` instead of the deleted view — see
[`single-canvas.md`](single-canvas.md). `epics_resolver.py`/`epic_brief_agent.py` are unchanged.

The `"epics"` member of the `CanvasView` union (see [`web-canvas-shell.md`](web-canvas-shell.md)): a
canvas showing **one chosen work item** at a time — its acceptance criteria, its stories, its
references and its delivery artifacts, each as its own connected box — read through swappable
source ports, entirely lazily, entirely deterministically, read-only. Opening the view never dumps
the whole requirements portfolio; the user names one epic (by id or by a path to its markdown file)
and only that epic's reachable graph ever renders. No `DiagramSpec`, no `SkillAgent`, no AI call
anywhere in this default ("From file") render path: everything here is derived from files on disk,
mirroring how `hierarchy/layout` sits outside `DIAGRAMS` (`routes/diagrams.py`) because there is
nothing to generate. A second, opt-in path exists alongside it — an "AI brief" toggle in the same
focus bar that renders a bespoke `SkillAgent`-authored document instead; see "AI brief
(008-epics-ai-brief)" below. Switching back to "From file" returns to the box graph above, unchanged.

## The two ports

`src/codechroma/requirements/source.py` defines the extension seam, mirroring
`AnalyzerRegistry.for_file()`:

- **`RequirementsSource`** — `list_items()` (cheap summaries only, never a body), `fetch_item(id)`
  (one fully-populated `WorkItem` or `None`), `fingerprint()` (cheap change signal). The split
  between the two methods is structural laziness: no method on this protocol accepts "give me
  everything."
- **`DeliverySource`** — `stages_for(item_id, expand=None)`: one `Stage` per artifact that exists,
  header fields always populated, `sections` empty unless `expand` names that exact stage's node id.
- **`SourceRegistry.for_uri("file://plan/epics", root)`** resolves a `file://` URI to
  `MarkdownRequirementsSource`; an unknown scheme returns `None`, never raises.
  `CompositeDeliverySource` concatenates several delivery sources so two delivery features can both
  attach to one work item (`FR-019`).

`src/codechroma/requirements/markdown/` is the one shipped adapter pair:

- `frontmatter.py` — hand-scans the leading `---`/`---` block and `yaml.safe_load`s only that (the
  body is prose, never parsed as YAML); `read_frontmatter_only(path)` reads in **binary** mode and
  stops at the closing `---`, so a bad byte anywhere in the body can never break a listing read.
  `find_section()` locates the criteria heading by *name* (numbering/parenthetical/case stripped),
  against a synonym set (`acceptance criteria` / `success criteria` / `key deliverables`).
  `parse_criteria()` tries three body parsers in order — checklist, Given/When/Then, plain
  bullets — first non-empty wins; a `**Illustrative` block is dropped, a trailing `— docs/… §x`
  citation is split into `source_ref`.
- `epic_source.py` — `MarkdownRequirementsSource`. An item's `id`/`title`/`status`/`kind`/`group`
  come from its frontmatter; `parent` names its parent's id (one tier of children per fetch);
  `depends_on`/`enables` (frontmatter lists of `{id, title}`) become `ItemLink`s. `references`
  (the frontmatter `references:` list), `context_file`, and `component` also surface on `fetch_item`
  for the exhaustive brief path to read. `fetch_item`
  degrades to id/title/status on any exception (a bad encoding, an unreadable file) — the blast
  radius is one box's interior (`FR-032`).
- `speckit_source.py` — `SpeckitDeliverySource`. A feature dir attaches to a work item by
  `epic:`/`epics:` frontmatter on its `spec.md` when present (wins outright, stops there); else by
  **membership**, not extraction — every id the widened `_ID_RE` (`(?:EP-)?[A-Z]+-\d+(?:-\d+)?`)
  finds across the `**Input**` **block** (the bold lead-in line plus its continuation lines, not
  just the first line) of `spec.md` **and** `plan.md`, unioned, is compared against the real item id
  `stages_for` was asked about. Because the comparison is against a real id, a wider regex is
  harmless — `FR-001`/`ADR-025` simply never equal any real item id — so the old "most specific
  (longest) id wins" precedence rule is gone; one feature can legitimately attach to two work items.
  `_attach_cache` (keyed by feature dir, invalidated on the `(mtime(spec.md), mtime(plan.md))`
  tuple — both files' mtimes, not their max, so editing the *older* of the two still invalidates;
  capped as an LRU at `_ATTACH_CACHE_MAX` entries so a long-lived bridge process never leaks)
  avoids re-walking every Input block on every `stages_for` call. Every artifact in the feature dir
  gets a stage, not just spec/plan/tasks: `_STAGE_FILES` adds `research.md`/`data-model.md`/
  `quickstart.md`, and `_STAGE_DIRS` (`contracts/`, `checklists/`) emits one stage per `*.md` file
  inside, `kind = f"{prefix}-{path.stem}"` (`contract-serving-units-api`, `checklist-requirements`) —
  folding the slug into `kind` keeps `stage_node_id` unique without adding a third id segment. A
  `tasks`/`checklist-*` stage's `done`/`total` counts are a cheap regex count on every call; every
  other kind's header carries a `**Status**` string instead. Sections parse only when `expand` names
  that stage, via the first non-empty of three extractors per `##` section — `_checklist_items`
  (`- [ ]`/`- [x]`), `_table_items` (markdown table rows, `id` = first cell), `_bullet_items` (`- `/
  `1. ` bullets and `**Bold**: value` lead-ins) — mirroring `frontmatter.parse_criteria`'s own
  "first parser to yield items wins" idiom. `StageSection.done`/`total` are computed from its own
  items (`None` when none carry a checkbox); `StageItem.story`/`parallel` are parsed off `[US1]`/
  `[P]`-shaped markers in the item's text (the marker still survives verbatim in `text` too).

`EpicsAssembler` (`assembler.py`) merges the two ports: `index()` never calls `fetch_item`/
`stages_for` on anything; `item(id, expand)` reads exactly that one item plus, cheaply, stage headers
for it and its immediate children. Caps (`RequirementsConfig.max_items` /
`max_requirements_per_item` / `max_stage_items`) are applied here, with the omitted count reported on
the index. A link's `in_index` flag (added by the assembler, not in data-model.md's original sketch)
tells the client whether a reference already has a box — see "Reference dedupe" below. Computing it
needs a full `list_items()` scan, so `item()` only pays that cost when the resolved item (or one of
its children) actually has a link to check — the common no-links case skips it entirely.

## The routes (`bridge/routes/epics.py`)

| Route | Notes |
|---|---|
| `GET /repos/{id}/epics` | Summaries only; a missing source directory is `200` with `items: []`, never 4xx/5xx. The web client no longer calls this for a portfolio dump — kept for any other consumer and for the mock/test fixtures — see below |
| `GET /repos/{id}/epics/items/{item_id}` | One `WorkItem`; `404` on an unknown id; `?expand=<stage_node_id>` populates exactly one stage's sections |

⚠ **No `/epics/layout` route.** `bridge/routes/epics.py`'s own module docstring: "Its saved-layout
pair was dropped in 016 Stage 6 -- epic positions live on canvas.json now." An older revision of
this file described one; there isn't one.

`bridge/epics_resolver.py` builds one `EpicsAssembler` per workspace root (cached, D-12) from
`Settings.requirements` — no per-request URI re-parsing. `workspaces.py`'s `epics_layout_path` +
load/save mirror `hierarchy_layout_path` exactly. `Workspace._build_watchers` adds a `DirWatcher` per
configured source that resolves *outside* the workspace root (`epics_resolver.external_watch_paths`)
— the in-repo case (every default configuration) is already covered by the existing `RepoWatcher`.

## The `epic-*` node-id namespace

Every id in this view starts with `epic`; the client is the isolation mechanism, not the server.

| Id form | Block |
|---|---|
| `epic::<id>` | a work item box, at any tier |
| `epic-group::<id>::requirements` / `::stories` | the criteria / children row inside a box |
| `epic-req::<id>::<reqId>` | one acceptance criterion |
| `epic-stage::<featureId>::<kind>` | a delivery artifact block — `kind` is `spec`/`plan`/`tasks`/`research`/`data-model`/`quickstart`, or `contract-<slug>`/`checklist-<slug>` for a `contracts/`/`checklists/` file |
| `epic-stage-section::<featureId>::<kind>::<index>` | one phase/heading inside an expanded stage (e.g. a `tasks.md` phase) |
| `epic-stage-item::<featureId>::<kind>::<itemId>` | one item inside an expanded section |
| `epic-ref::<id>` | a stub for a referenced, unfetched item |

`web/src/engine-client/epicsDiagramClient.ts` (`EpicsDiagramClient extends DelegatingEngineClient`)
is the Decorator + Virtual Proxy: it caches `WorkItem`s by id, dedupes an in-flight fetch by promise
so two rapid expansions of the same id issue one request, and — 🔴 the one rule every other guard in
this feature exists to protect — `getChildren`/`getNode` return `[]`/`null` for any unrecognised
`epic-`-prefixed id rather than delegating to `inner`. No `epic-*` id can ever resolve against the
real hierarchy (`FR-035`). `setIndex` still exists (exercised by `epicsDiagramClient.test.ts`) but
nothing in production calls it since `EpicsView.tsx` (the portfolio-index client) was deleted in
016-single-canvas-dashboard Stage 4 — an epic item now reaches the canvas through
`canvas/recipes.py`'s `reshape()`, not a client-side index at all.

**Reference dedupe (D-14).** `link.in_index` is computed server-side against the *full* requirements
source (`EpicsAssembler._index_ids_if_linked`, a `list_items()` scan over the whole configured
`plan/epics` tree) regardless of which one epic the canvas currently has focused — so it stays an
accurate "does this id have a source file anywhere in the portfolio" signal even though the client
itself no longer loads that portfolio. `registerStub(link)` is a no-op when `link.in_index` is true
or when the id has already been fetched; otherwise it becomes an `epic-ref::` stub. Clicking a stub
calls the same `fetchItem` as any regular expansion — promotion isn't a special code path, just a
fetch whose id happens not to have a box yet.

## AI brief (008-epics-ai-brief)

A second, opt-in rendering of the same focused epic: an LLM-authored structured document —
problem/value, scope (in-scope items as cards in **one single, horizontally scrollable row that
never wraps to a second row** regardless of item count, each card's own tasks **in a column
inside it**, out-of-scope items dimmed, task-less, and in their own single scrollable row below),
dependencies & risks, acceptance
criteria (each carrying a colored badge naming the scope item that closes it, or a red "gap" badge
when nothing does). Below the scope cards sits a labeled **Testing** subgroup pooling every
`is_test: true` task from across the scope (see the data model below) — test work gets its own home
instead of mixing into the feature cards, while still being attributed to no single feature scope
item. Rendered as plain scrollable DOM flow, not a dagre graph — the shape (frame → card →
tasks-inside-the-card) is inherently nested, not a set of independently-positioned boxes
needing drag/pan, so `EpicBriefView` uses none of `useSavedLayoutAndFitLoop`/the
collision system.

**One artifact per epic, not per repo.** `bridge/epic_brief_agent.py` mirrors
`bridge/research_agent.py`'s per-question keying, not `diagram_registry.DIAGRAMS`'s per-repo one:
`job_key(workspace_id, epic_id)` = `f"{workspace_id}:{epic_id}"`, and
`epic_brief_path(repo_root, key)` writes to `.codechroma/epics/briefs/<epic_id>.json` — one file per
epic, keyed off the id half of `job_key` exactly like `research_agent.research_answer_path`. Not a
`DiagramSpec`: that shape assumes one artifact per `Workspace` (`root_for`/`artifact_path` take a
`Workspace`, not an item id) and unconditionally wires a repo-wide generate/status/output/layout
route quartet — the same reason 007 ruled out `DIAGRAMS` for the box-graph half of this view.

**Data model** (`src/codechroma/requirements/brief_models.py`): `BriefTask`, `ScopeItem`,
`AcceptanceCriterion`, `Dependency`, `EpicBrief` — frozen dataclasses with `to_dict`/`from_dict`,
mirroring `research/models.py`'s style rather than `requirements/models.py`'s (which has no
serialization methods, since it's never round-tripped through JSON on disk). `ScopeItem.tasks_source`
is `"spec"` | `"draft"` | `None` — `"draft"` renders the card with a dashed border (same honesty
convention as Patterns' `confirmed: null`), `None` means the item is out of scope and carries no
tasks at all. `EpicBrief` also carries `component` (`str | None`) and `spokes` (a `BriefSpoke` list,
each `{spoke, role}`) describing the epic's repo split, and each `BriefTask` carries a `repo` tag
(`str | None`) naming the spoke/part that owns that task — `null` only for cross-cutting tasks. This
mirrors the shape the skill already wrote into `LMP-123.json` (which used to be silently dropped as
unknown keys; it's first-class now). `BriefTask.is_test` (default `False`) marks a task whose wording
is explicitly about testing ("test X", "write tests", "unit/integration/e2e", "coverage"); the
canvas pools every `is_test` task across the scope into a labeled **Testing** subgroup inside Scope
(`EpicBriefView.tsx` builds `testingTasks` in its grouping memo, `ScopeItemCard.tsx` filters
`is_test` tasks out of the feature card so the card's count matches what it renders). The test task
still stays attached to the scope item it implements — the pool is a render concern, not a move — so
`closes_scope_id` continues to name the feature scope item.

**The skill** (`.claude/skills/codechroma-epic-brief/SKILL.md`, prompt in
`prompts/epic_brief_agent.yaml`) is the only step in the run — unlike `codechroma-research`, there is
no deterministic half that ran before it. Every datum it needs is **injected into the prompt** by
`epic_brief_agent.build_brief_bundle()` (`bridge/epic_brief_agent.py`) before the run starts, so the
agent does one data step instead of five: it used to curl the bridge for each datum (the epic, each
`tasks` stage via `?expand=`, the write path), and every curl was a full LLM round-trip. The bundle
is the same data the curls returned, assembled server-side from `epics_resolver.epics_item()` — the
reads are milliseconds of file parsing, not model turns. The bundle carries the epic's
`WorkItem` under `"epic"` (its summary, requirements, `references[]`, `context_file`, `stages`,
`component`), a real task breakdown under `"tasks_by_stage"`, `has_spec`, and the absolute
`"write_path"`.

Resolving the task breakdown mirrors the old skill's rule: ⚠ a spec's `tasks.md` almost always
attaches to a **story**, not the epic itself (its `spec.md`/`plan.md` **Input** line names the story
id), so `_tasks_stage_node_ids()` collects every `kind: "tasks"` stage from the epic's own `stages[]`
**and** every child's — the epic's top-level `stages[]` is empty far more often than not — and the
bundler expands each via `epics_item(expand=epic-stage::{name}::tasks)` to fill that stage's real
`sections[].items[]`. `has_spec` is true when any tasks stage was found; the skill attaches those
real tasks and marks `tasks_source: "spec"`, else it drafts and marks `"draft"`. Beyond the summary,
the skill still reads the bundle's `references[]` and `context_file` (the epic's linked epics and
its context note) to ground `dependencies` in the portfolio, and tags every task's `repo` with the
spoke/part that owns it, mirroring the epic's `component` onto the top level. Self-checked by
`.claude/skills/codechroma-epic-brief/scripts/check_brief.py` (unique ids across the whole brief,
every `closes_scope_id` null-or-real, no out-of-scope item carrying tasks) before it reports success
— reads the bridge's own `GET .../brief` response, not the raw file, so it checks what the canvas
will actually render; when the brief names spokes it also prints a non-blocking `SPOKE-MISSING`
advisory for any in-scope task that still carries no `repo`.

⚠ **The model never retypes a real task's `text`.** It used to be told to copy each real task's
`id`/`text` verbatim into its output, and punctuation-dense lines (nested backticks/parens)
occasionally got mangled mid-retype. Now the skill emits only `{ "id": ..., "stage": ...,
"repo": ... }` for a `tasks_source: "spec"` task, and `bridge/epic_brief_resolver.py`'s
`resolve_brief()` splices the real `text`/`parallel` back in at read time — mirroring
`patterns_resolver.py`'s `_merge()` (deterministic-fresh-data-plus-authored-overlay). The splice is
keyed off **(stage, id)**, not id alone: `_task_index()` rebuilds the `{(stage_name, task_id):
{text, parallel}}` map `build_brief_bundle()` fed the model, fresh from `tasks.md` every read, where
`stage_name` is the spek slug of the tasks stage. A task id is only unique *within* one spec — two
specs attached to the same epic (008-... and 009-...) both have a T004 — so an id-only key would let
the later spec silently overwrite the earlier one's text. `resolve_brief()` overwrites every
scope-item and `prep_tasks` task's `text`/`parallel` whose `(stage, id)` is found there; a task that
declares no `stage`, or whose `(stage, id)` is duplicated within one spec (ambiguous — the resolver
can't tell which text is authoritative), is left untangled so it never "speaks with a stranger's
voice." A `tasks_source: "draft"` task's id never matches a real one, so it passes through untouched
— the model still writes its `text` itself, since there's nothing to look up. `_read_brief()`
(`bridge/routes/epics.py`) calls this before `EpicBrief.from_dict`
on every read (start/poll/cancel); the on-disk artifact stays exactly what the skill wrote, only the
API response is resolved — same "never mutate the file, merge at read time" precedent as
`resolve_patterns`/`resolve_c1`.

**Routes** (`bridge/routes/epics.py`, alongside the index/item/resolve trio above):

| Route | Notes |
|---|---|
| `POST /repos/{id}/epics/{item_id}/brief` | Starts the skill, or returns a cached brief inline without re-running it; `404` on an unknown `item_id`. Checks the skill's *live* state first — an in-flight run (e.g. another tab) wins over a cached brief on disk, so the client's generate guard can't be bypassed into a second `claude` process. `?force=true` (the canvas "Regenerate" button) skips the cached-brief shortcut and runs the skill fresh — the bundle is rebuilt and injected exactly like a first run |
| `POST /repos/{id}/epics/{item_id}/brief/cancel` | Cancels an in-flight brief run for this epic (`SkillAgent.stop(job_key)`, resetting the job to idle) and emits an `epic-brief-status` ping. `stop()` awaits the cancelled task, whose `_run` now restores the pre-run brief on `CancelledError` — so the half-written fragment rolls back before `stop()` returns |
| `GET /repos/{id}/epics/{item_id}/brief` | `{"state", "brief": EpicBrief \| null, ...}` — mirrors `GET /repos/{id}/research/{job_key}`'s "not gated on `state == "done"`" shape, except the success state here is always `"idle"` (no degraded/inline path exists for a brief) |
| `GET /repos/{id}/epics/{item_id}/brief/output` | Progress lines while generating |
| `GET /repos/{id}/epics/{item_id}/brief/path` | Absolute path the skill writes to — mirrors research's own `/path` route |

`services.py`'s `_build_skill_agents()` registers `agents["epic-brief"]`; `skill_sync.SKILL_NAMES`
installs `codechroma-epic-brief` into the analyzed repo alongside the other five skills
(`codechroma-{plan,draw-diagram,review-diagram,research,diagram-type}`);
`SkillAgentTimeoutsConfig.timeout_seconds["epic-brief"]` defaults to 300s.

**Frontend** (`web/src/canvas/epics/brief/`): `EpicBriefView.tsx` (the problem frame plus a
"Spokes / parts" frame when the brief has `spokes`, then the scope, dependencies, and acceptance
frames), `ScopeItemCard` (client-assigned color from a fixed palette by scope-item index — never
stored in the brief JSON, so the schema stays stable if the palette changes; takes its accent via an
inline `--scope-item` CSS variable), `TaskChip` (renders the task's `[P]` parallel flag, its `repo`
tag — see below — id, and text), `AcceptanceCriterionBlock` (the trace/gap badge). `web/src/state/useEpicBrief.ts` is
its while-generating poll of job state + output lines is the shared `state/usePolledJob.ts` hook
(the diagram-type interview's own `useDiagramTypeInterview` consumer is retired), and the overall
shape stays modeled on `useResearch.ts` (poll while `state === "generating"`, no websocket push — generating a
brief is a one-off action, not a status watched continuously), except it's bound to one `itemId` and
bootstraps its current state on mount/id change (a brief from an earlier session, or a job another
tab already started), since — unlike an ad-hoc research question — a brief view always has exactly
one epic in view; `generate(force?)` — the bare `Generate` (empty state) or a `force`-ed
"Regenerate" (an existing brief) — skips the POST while `job.state === "generating"` so a second
generate (e.g. switching back to an epic whose brief is still running) re-attaches to the in-flight
run instead of risking a second `claude` process — the same client-side guard `useDiagramGeneration`'s
`trigger()` carries for C1/Patterns, on top of the server-side `SkillAgent.start()` dedupe that refuses
a second run while one is in flight. `useEpicBrief.stop()` handles the generating panel's **Stop**
button — it calls `POST .../brief/cancel` (the poll loop still ticking on `generating` picks up the
idle reset, so the panel drops back to the Generate state). ⚠ **The old "From file"/"AI brief"
toggle inside `EpicsView.tsx`'s focus bar is gone with that view** (016-single-canvas-dashboard
Stage 4) — clicking an epic element now always opens `EpicBriefPanel`/`EpicBriefView` directly (see
below), there is no box-graph alternative to toggle to any more. No auto-generate-on-view-open — C1
and Patterns both dropped the `useAutoGenerate` effect they used to share (it's deleted; see
`c1-diagram.md`), so no diagram/brief kind auto-starts a run anymore: the empty state shows a plain
"Generate" button, and there is no regeneration on file change either — each run is a real Claude
call, so it's opt-in and explicit by design.

Both `Generate` and `Regenerate` are disabled (with a `title` hint) when `useGroupAvailability`
("planning")'s check reports the group's effective CLI (assigned provider, or the default `claude`)
is not on PATH — see [`llm-settings.md`](llm-settings.md#web)'s `cli_available` field. A brief has
no offline/degraded path (unlike research's keyword fallback), so this is the one place a missing
provider is worth blocking proactively instead of letting the click fail. Also: a failed `Regenerate`
on top of an existing brief now renders `job.error` next to the button
(`epic-brief-regenerate-error`) — it used to be silently swallowed once `brief` was non-null, since
only the empty-state branch checked `job.error`.

**The Specs frame (010-epic-specs-on-canvas).** A sixth, additive frame — "Спецификация
(SpecKit)" — sits between Scope and Dependencies, reading the same deterministic `stages` the
epic's own `WorkItem` carries: no AI, no change to the brief's own generated content. `SpecsFrame.tsx`
(`web/src/canvas/epics/brief/`) renders one chip per stage (`stageHeader`/`stageLabel`, now in
`canvas/epics/specStageHelpers.ts` rather than duplicated) and renders nothing when the focused item
has no stages, whether or not a brief has been generated yet. `EpicBriefView` gets the
`EpicsDiagramClient` instance `EpicBriefPanel` builds fresh per panel open — `SpecsFrame` only ever
reads `client.getItem(itemId)?.stages` from that client's cache, and its own stage-expand click calls
`client.fetchItem(itemId, stageNodeId)` through that same client. Expand state lives in
`SpecsFrame`'s own local `expandedStageIds`/`expandedSectionIds` (`useState`) — it doesn't persist
across closing and reopening the panel. Section expansion is fetch-free: the stage's one `?expand=`
response already carries every section with its items (`EpicsDiagramClient.mergeStages`).

## Laziness gotchas

- `list_items()`/every parent/child lookup reads **only** `read_frontmatter_only` — verified by a
  test that monkeypatches `parse_criteria` to raise and asserts it's never called during listing.
- An epic item's requirements/stories/stages are still fetched lazily today: `EpicsDiagramClient`
  only calls `fetchItem`/`GET /epics/items/{id}` for an id the canvas actually expands, and only
  requests one stage's `sections` at a time via `?expand=` (FR-007/FR-008) — the box-graph view this
  used to be phrased around (`EpicsView.tsx`, `EpicConnections.tsx`) is gone, but the same laziness
  now lives in the generic canvas-doc expand path instead.
- A delivery artifact's `sections` come back empty on every server response except the one whose
  `expand` query parameter names that exact stage (D-05: one canonical `WorkItem` shape, not two).
  `EpicsDiagramClient.fetchItem`'s `mergeStages` keeps this a server-side-only property: a stage
  whose freshly-fetched `sections` is empty is patched back in from whatever the client had cached
  for that stage already, so expanding a second stage never erases the first one's — the cache holds
  the union of every stage expanded so far, not just the most recent response.

## Tests

`tests/unit/test_markdown_epic_source.py`, `test_markdown_heading_variants.py`,
`test_requirements_registry.py`, `test_epics_assembler.py`, `test_speckit_delivery_source.py`
(every artifact kind appearing/disappearing with its file, unique `contract-*`/`checklist-*` ids,
the widened-regex continuation-line attach, frontmatter-wins-over-Input, a widened-regex false
positive not spuriously attaching, the table/bullet extractors, section `done`/`total`, `[P]`/
`[US1]` marker parsing), `test_bridge_epics_route.py`, `test_epics_resolver.py` ·
`web/src/engine-client/epicsDiagramClient.test.ts`,
`web/src/canvas/epics/brief/SpecsFrame.test.tsx` (absent for a stage-less item, stage-chip-expands-
to-sections with the right `fetchItem`/`expand` call, section-expands-to-items with no extra fetch,
`[P]`/story rendering). Fixture: `tests/fixtures/requirements_repo/specs/001-first-story-feature/`
(every artifact kind, including `contracts/`/`checklists/`), plus two more feature dirs proving the
widened-regex continuation-line attach and the `epic:` frontmatter attach.
⚠ This list once also named `test_bridge_epics_layout_route.py`, `EpicsView.test.tsx` (the deleted
box-graph view) and `web/e2e/epics-view.spec.ts` — none exist anymore; only the AI-brief slice
(`epics/brief/`) still renders as its own component today, the rest reaches the canvas generically.

AI brief: `tests/unit/test_epic_brief_agent.py` (`EpicBrief` round-trip incl. `repo`/`spokes`/
`component`, `job_key`/`epic_brief_path`
shape, plus `build_brief_bundle` on the `requirements_repo` fixture — a story-owned `tasks` stage
yields `has_spec: true` and real tasks, a stage-less epic yields `has_spec: false`),
`tests/unit/test_bridge_epic_brief_route.py` (start/poll/404/cached-without-rerun/read-only
guard/path route, plus the bundle being injected into the agent prompt, and a `tasks_source: "spec"`
task with no `text` in the cached file coming back from `GET .../brief` with the real `tasks.md`
text spliced in) · `tests/unit/test_epic_brief_resolver.py` (`resolve_brief`: a real id gets its
`text`/`parallel` overwritten from the fresh index regardless of what's on disk, a drafted/unknown
id passes through untouched, an out-of-scope item with no `tasks` key doesn't crash) ·
`src/codechroma/requirements` source/assembler tests now cover
`references`/`context_file`/`component` surfacing on the item · `web/src/state/useEpicBrief.test.ts`,
`web/src/canvas/epics/brief/EpicBriefView.test.tsx` (scope cards in a row, tasks in a column, the
gap badge, the dashed-draft treatment, the spokes banner, the per-task repo tag, and — 010 — the
Specs frame's absence for a stage-less item in both the empty and generated states).
