---
name: codechroma-epic-brief
description: Generate a structured AI brief for one epic -- problem/value, scope (with tasks attached to the scope item they implement), dependencies & risks, acceptance criteria. Use when the user (typically running you in the canvas terminal panel) asks you to generate, regenerate, or refresh an epic's "AI brief" -- e.g. "generate the AI brief for LMP-65", "regenerate the brief", "the epic brief is stale".
---

Write one epic's brief: problem/value, scope items (each carrying the tasks that implement it,
never a separate top-level "tasks" tier), dependencies & risks, and acceptance criteria. You are
the only step in this run -- there is no deterministic half that ran before you, unlike
`codechroma-research`.

**The prompt that invoked you already carries two facts: the epic's id (`epic_id`) and this run's
`job_key`.** Use them exactly as given -- never guess a `job_key`, never rename the epic.

**All the data you need is already in this prompt as a JSON "brief context" bundle.** Do NOT curl
the bridge for the epic, the tasks stages, or the write path -- read the bundle verbatim instead.
Do not search `specs/` yourself or guess an attachment; which feature attaches is already decided
server-side, and the bundle lists only what's genuinely attached.

## Read the bundle

The bundle carries the epic's `WorkItem` under `"epic"`:

- `requirements[]` -- existing acceptance criteria, if any.
- `children[]` -- sub-stories.
- `links[]` -- `depends_on`/`enables` references.
- `stages[]` -- one entry per attached `specs/<slug>/{spec,plan,tasks}.md`, already `kind`-tagged;
  a `tasks` stage's real `sections` live in `tasks_by_stage`, not here.
- `references[]` -- the epic's `references:` frontmatter list (paths and/or bare ids of **linked
  epics**). Use these to ground `dependencies` in the real portfolio rather than inventing
  cross-links.
- `context_file` -- the relative path to this epic's context note under the repo root. Read it for
  rationale the summary omits (why the epic exists, decisions already made). Missing/`null` is
  fine -- skip it then.
- `component` -- the ownership area (e.g. `"application"`), useful when tagging tasks' `repo`.

`tasks_by_stage` holds every real task grouping: one entry per `tasks` stage found at either level
(the epic's own `stages[]` **and** every `children[]` entry's `stages[]`), each already expanded.
Each entry's `sections[].items[]` is one real task (`id`, `text`, `done`) grouped under a `## ...`
phase heading in `tasks.md` -- the heading itself is not your grouping, and neither is the story it
came from; you still decide which **scope item** each task belongs to, using the task's own wording
(a task mentioning "the proxy handler" belongs to the scope item describing the proxy, regardless of
which story's `tasks.md` it was filed under).

**Never retype a real task's `text` -- reference it by `id` only.** The bundle already carries every
real task's exact `text`; the server splices it back in after you write the brief, matched by `id`.
For a `tasks_source: "spec"` task, emit `{ "id": ..., "stage": ..., "repo": ... }` -- omit
`text`/`parallel` entirely. Getting the real `id` right (never inventing or renumbering one) is
what matters now, not retyping its text -- retyping punctuation-dense task lines is exactly how
they used to get mangled. Set `stage` to the `name` of the `tasks_by_stage` entry the task came
from (the spek slug, e.g. `"008-go-gateway"`); the server splices the real text back in keyed off
`(stage, id)`, and without `stage` a same-numbered task in another spec could overwrite this one's
text. A drafted task (`tasks_source: "draft"`, see below) has no real source to reference, so write
its `text` yourself there -- and you may omit `stage` there, since a draft has no spec to name.

`has_spec` tells you whether any `tasks` stage was found, and `write_path` is the absolute path to
write your brief to.

- When `has_spec` is `true`, attach the real `tasks_by_stage` tasks to your scope items and mark
  every `ScopeItem` you fill this way with `tasks_source: "spec"`.
- When `has_spec` is `false` (no spec resolves), draft a plausible task breakdown yourself from the
  epic's own requirements/summary, and mark every `ScopeItem` you fill this way with
  `tasks_source: "draft"` -- this is a guess, and the canvas renders it with a dashed border so it
  never looks like ground truth. Never write a drafted breakdown into `specs/`.

## Tag every task's repo/part

Each task carries a `repo` tag naming the repo, spoke, or part it belongs to. Decide it per task, not
per scope item alone:

- **Multi-repo/multi-spoke epic** (epic's `component`/`spokes` say so, e.g. `application` +
  `inference`): tag each task with the spoke that owns that piece of work -- use the spoke's short
  name (`"application"`, `"inference"`). When a scope item spans an edge between spokes (e.g. the
  first scope item is the seam), tag its tasks with the part that actually does the work, and say
  which part that is in the scope item's `description` -- the LMP-123 case of "the first scope says
  which part must be done, then each task is tagged with it."
- **Single-repo epic**: tag with the area it belongs to (`"backend"`, `"frontend"`, `"cli"`, …) when
  the task clearly touches one. Tasks that touch several areas at once stay `null` in `repo` rather
  than picking one arbitrarily -- `repo` names the single place the work lands.
- `repo` is `null`/omitted only when a task genuinely has no single owner (cross-cutting, plumbing).

## Mark test tasks for the Testing block

Each task carries an `is_test` flag. Set it `true` on any task whose wording is explicitly about
testing -- "test X", "write tests for Y", "unit/integration/e2e test", "cover with a test", "add a
test". Leave it `false`/omitted on tasks that only *use* testing incidentally or whose main point
is the feature itself. Don't let a task's `repo` tag or which scope item owns it change the flag --
`is_test` describes the task's own subject, nothing else.

Keep every test task attached to the scope item it implements (never move it to a different scope
item, and never invent a new scope item just for it). The canvas pools all `is_test: true` tasks
from across the scope into a labeled "Testing" subgroup inside Scope; it doesn't need a separate
scope item from you. `closes_scope_id` on an acceptance criterion should still name the feature
scope item the criterion closes, not "Testing".

## Where to write

Write the JSON to the absolute `write_path` from the bundle's filename (create parent directories
if missing).

## Schema

```json
{
  "epic_id": "LMP-65",
  "generated_at": "2026-08-12T10:00:00Z",
  "problem": ["One or two short sentences on why this epic exists."],
  "component": "application",
  "spokes": [
    { "spoke": "application", "role": "Leading half — Go control-plane core." },
    { "spoke": "inference", "role": "Model-placement half." }
  ],
  "scope": [
    {
      "id": "scope-proxy",
      "title": "Proxy /v1/chat/completions",
      "description": "One sentence on what this scope item covers.",
      "in_scope": true,
      "tasks_source": "spec",
      "tasks": [
        { "id": "T003", "stage": "008-go-gateway", "repo": "backend" },
        { "id": "T005", "stage": "008-go-gateway", "repo": "backend", "is_test": true }
      ]
    },
    {
      "id": "scope-quickstart",
      "title": "Host-aware quickstart links",
      "description": "Why this is explicitly out of scope.",
      "in_scope": false,
      "out_of_scope_ref": "LMP-105"
    },
    {
      "id": "scope-draft-example",
      "title": "A scope item with no real tasks.md to reference",
      "description": "Drafted because has_spec is false, or no real tasks matched this item.",
      "in_scope": true,
      "tasks_source": "draft",
      "tasks": [{ "id": "T-D01", "text": "scaffold the drafted piece", "repo": "backend" }]
    }
  ],
  "prep_tasks": [{ "id": "T001", "stage": "008-go-gateway", "repo": "backend" }],
  "dependencies": [
    { "kind": "depends_on", "text": "session/auth floor", "ids": ["LMP-67"] },
    { "kind": "risk", "text": "LiteLLM rate limits under load", "ids": [] }
  ],
  "acceptance": [
    { "id": "AC-01", "text": "/v1 returns 401 without a valid bearer token", "done": true, "closes_scope_id": "scope-proxy" },
    { "id": "AC-05", "text": "a disabled gateway returns 404", "done": false, "closes_scope_id": null }
  ]
}
```

Rules:
- Every `id` (scope items, tasks, acceptance criteria) must be unique across the whole brief.
- `tasks` only ever appears on an `in_scope: true` `ScopeItem` -- an out-of-scope item never carries
  tasks, and never appears in `prep_tasks` either.
- Every task's `repo` names the spoke/part that owns it (see "Tag every task's repo/part"); it is
  `null`/omitted only for cross-cutting tasks with no single owner. `component`/`spokes` at the top
  describe the epic's repo split and should agree with the `repo` values.
- `tasks_source` is `"spec"` when every one of that item's tasks came from a real `tasks.md`,
  `"draft"` when you wrote them yourself, `null` for an out-of-scope item (no tasks at all). Never
  mix real and drafted tasks under the same `tasks_source` -- if a scope item has no matching real
  tasks, draft all of its tasks and mark it `"draft"`.
- For a `tasks_source: "spec"` item, never write `text`/`parallel` on its tasks -- the server
  overwrites both from `tasks.md` regardless of what you write there, matched by `(stage, id)`.
  Only `id` (get it right), `stage` (the owning `tasks_by_stage` name, so a same-numbered task in
  another spec isn't spliced in its place), `repo` (your judgment call), and `is_test` (your
  judgment call, per "Mark test tasks for the Testing block") matter for these.
  `prep_tasks` follows the same rule whenever its `id` names a real task -- and `prep_tasks` also
  carries `stage`. A `"draft"` task has no real source, so write its `text` (and `parallel`, if
  relevant) yourself -- it will not be overwritten.
- `prep_tasks` holds tasks not tied to any one scope item (e.g. scaffolding) -- keep this list short;
  most tasks belong to a scope item.
- `closes_scope_id` on an `AcceptanceCriterion` names the `ScopeItem.id` whose work satisfies that
  criterion, or `null` if nothing does yet -- the canvas renders `null` as a red "gap" badge. Don't
  default to `null` to avoid a decision; only use it when you genuinely can't attribute the
  criterion to one scope item.
- `dependencies[].kind` is one of `"depends_on"`, `"enables"`, `"risk"`, `"check"`. `ids` holds other
  work-item ids when the dependency names one (e.g. `depends_on`); leave it `[]` for a risk/check
  that isn't tied to another item.
- `generated_at` is an ISO-8601 timestamp for when you wrote the file.
- Never invent a scope item's color, badge, or layout -- the canvas assigns those client-side from
  a fixed palette by scope-item index; your job is only the content.

## Procedure

1. Read the bundle's `epic` (its `requirements`, `summary`, `links`, and `stages`, plus
   `references[]`, `context_file` (open it relative to the repo root if present), and `component`)
   and its `tasks_by_stage` -- these ground the brief in the surrounding portfolio.
2. If `has_spec` is true, use the real tasks from `tasks_by_stage` (previous section). Otherwise
   plan to draft a breakdown.
3. Write 1-2 sentences of `problem` from the epic's own summary/requirements -- don't pad with
   generic filler the source doesn't support.
4. Decide the scope items: what's actually being built (`in_scope: true`) and what's explicitly
   deferred (`in_scope: false`, with `out_of_scope_ref` naming the item it was deferred to, if the
   epic's own text names one). Mirror the epic's `references`/`component`/`spokes` into the top-level
   `references`-grounded `dependencies`, `component`, and `spokes`.
5. Attach every real or drafted task to exactly one scope item (or `prep_tasks` if it truly isn't
   tied to one), and tag each task's `repo` per "Tag every task's repo/part".
6. Write `dependencies` from the epic's `links[]` and `references[]` (`depends_on`/`enables`) plus
   any risk you can support from the epic's own text -- don't invent a risk the source gives no basis
   for.
7. Write `acceptance` from the epic's `requirements[]` if it has any, plus anything else the text
   implies must hold true; set `closes_scope_id` per the rule above.
8. Self-check -- never report success on a run that didn't print `OK`:

   ```bash
   python3 .claude/skills/codechroma-epic-brief/scripts/check_brief.py --repo default --item {epic_id}
   ```

   | Line | Means | Fix |
   |---|---|---|
   | `DUPLICATE <id>` | the same id is used by more than one scope item, task, or criterion | rename one -- ids must be unique across the whole brief |
   | `DANGLING <id>` | an `AcceptanceCriterion.closes_scope_id` names a scope item id that doesn't exist | fix the id, or set it to `null` |
   | `TASKS-ON-OUT-OF-SCOPE <id>` | an `in_scope: false` item carries tasks | drop them -- out-of-scope items never carry tasks |
   | `SPOKE-MISSING <id>` (advisory) | an in-scope task carries no `repo`, but the brief names spokes | add the `repo` tag -- advisory only, does **not** fail the run |

   Confirm the JSON you wrote parses back as valid JSON with a non-empty `scope` list before
   finishing -- an unparseable or empty-scope write is treated as a failed run and the previous
   brief (if any) is restored.
