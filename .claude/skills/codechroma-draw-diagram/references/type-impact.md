# type: impact — the change-impact diagram

Read `references/drawing-rules.md` first — bridge contract, path honesty, density budgets, the
per-box and per-arrow `style` rule, arrow labels and the self-check contract live there and are not
repeated here.
⚠ Impact's budget is the tightest of the four (25 nodes / 40 relations) — the slice is one-hop by
construction, so a big impact diagram means you dumped the repo instead of judging it.

Write the project's Impact diagram: the boxes a change (git diff) or a plan (spec/plan.json)
actually touches, plus the one-hop callers/callees that matter, with the untouched background
collapsed — never a whole-repo dump.

**The bridge already computed the slice for you** (`impact/context`). It is the deterministic answer
to "what changed and who is one hop away from it". Your job is judgment on top: which of those
one-hop neighbours deserve their own box vs. which to fold into a collapsed "context" box, and how
to label each so the reader sees *why* it's on the canvas (changed by the diff, target of the plan,
or just adjacent).

## Gather context efficiently — one endpoint, not a grep

`impact` opts out of `drawing-rules.md`'s Wiki-first fetch order (Step 0 wiki-general, Step 1 the
older wiki) entirely — the slice is one-hop by construction, not the whole architecture, so a
system-wide narrative doesn't help judge it. `impact/context` below is the one context call this
type needs:

```bash
curl -s "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/impact/context?source=diff"
# or, when working from a feature's spec files, the plan slice (name the feature directory):
curl -s ".../impact/context?source=plan&feature=specs/006-graph-research-endpoint"
```

Returns the rich slice: `nodes` each with `id`/`name`/`node_id` (a **real** hierarchy node id you
must copy verbatim whenever you render it), `seed` (true = touched directly by the change/plan),
`path`, `level` (`function`/`class`/`file`/`dir`), `reason` (for a seed: the git status word like
`modified`, or the spec line naming the path), and `anchors` (the System→… path it lives under —
copy ancestors' names from here to label a collapsed background box). Also `relations` (one-hop
edges inside the slice), `seed_count`, `node_count`, and `fingerprint` (copy it into `impact.json`
so staleness works). A plan slice's `feature` echoes the directory you named; pass it back when
writing `impact.json`.

⚠ Copy every `node_id`/`id` verbatim from `impact/context`. A box whose id doesn't resolve renders
as a broken node.

## Where the file goes

```bash
curl -s "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/impact-path"
# -> {"repo_root":"/abs/path/to/repo","impact_path":"/abs/path/to/repo/.codechroma/diagrams/impact/impact.json"}
```

Write the JSON to the returned `impact_path`. Fallback order and the live-update note: see
`drawing-rules.md`.

## Schema

Same shared shape as every type (`drawing-rules.md`), with `type: "impact"` and these impact-only
fields at the top level plus in each node's `meta`:

```json
{
  "type": "impact",
  "generated_at": "2026-01-01T00:00:00Z",
  "source": "plan",
  "feature": "specs/006-graph-research-endpoint",
  "fingerprint": "<copy verbatim from impact/context>",
  "nodes": [
    { "id": "server/internal/fit/rank.go::class::RankRequest", "name": "RankRequest", "node_id": "server/internal/fit/rank.go::class::RankRequest", "seed": true, "description": "New struct the plan adds: DeployTargetRef field.", "meta": { "status": "new" } },
    { "id": "server/api/handlers.go::function::Recommend", "name": "Recommend", "node_id": "server/api/handlers.go::function::Recommend", "seed": true, "description": "Existing handler the plan changes to accept DeployTargetRef.", "meta": { "status": "modified" } },
    { "id": "collapsed::auth", "name": "Auth (unchanged)", "node_id": "dir::server", "seed": false, "description": "Unchanged background the change passes through.", "meta": { "status": "context" } },
    { "id": "server/internal/fit/wire.go::class::Wire", "name": "Wire (fragile)", "node_id": "server/internal/fit/wire.go::class::Wire", "seed": false, "style": { "background": "rgba(230, 80, 110, 0.15)", "border-color": "#e06c75" }, "meta": { "status": "context" } }
  ],
  "relations": [
    { "from": "server/api/handlers.go::function::Recommend", "to": "server/internal/fit/rank.go::class::RankRequest", "label": "builds RankRequest", "hero": true }
  ]
}
```

Rules:
- `source` — set to the sponsor you generated from (`"diff"` or `"plan"`, matching the
  `impact/context?source=` you fetched). The canvas uses it to compute staleness against the *same*
  source, so a plan-authored diagram goes stale when the plan changes, not when an unrelated diff
  does.
- `feature` — set for a `plan` diagram to the feature directory the slice was seeded from (echo the
  `feature` from `impact/context`). Omit it for `diff`. Staleness weighs it with `source`: a plan
  diagram goes stale only when that same feature's spec seeds move.
- `nodes[]` — the final boxes. A `seed` node (changed by the diff, or a plan step's target) keeps
  its real `node_id`, **or** is merged with its same-file siblings into one file-level seed box (see
  Procedure step 3) — don't make one box per changed symbol. Non-seed one-hop neighbours can stay as
  real boxes when they carry the story (a key caller), or be collapsed: give a collapsed box the
  closest real ancestor `node_id` (e.g. a directory) as its primary id, plus `"seed": false` and a
  `description` naming what it collapses ("unchanged background").
- 🔴 **`nodes[].node_id` is required, unlike c1/custom.** Impact never resolves a `path` itself — a
  box with no `node_id` you already resolved yourself is dropped outright, not kept.
- `nodes[].style` (optional) — see `drawing-rules.md`. Use it when a box needs a colour beyond the
  seed/status accent — e.g. to flag a caller that's a regression risk, or to keep a collapsed
  "housekeeping" box visually muted.
- `nodes[].meta.status` — **give every box one, for both `source` values**, same four-value
  vocabulary; the canvas shows it as an `ADD`/`MODIFY`/`DELETE` chip plus an accent left-edge
  (`"context"` gets neither — it stays muted). Where the value comes from differs by source:
  - **`source == "diff"`**: read it straight off `impact/context`'s own `reason` for that seed — it's
    already the git status word. `reason == "added"` → `"new"`; `reason == "modified"` → `"modified"`;
    `reason == "deleted"` → `"deleted"`. Note a deleted symbol's own node never appears in the slice —
    its `"deleted"` reason is already re-pinned by the bridge onto a surviving ancestor box (the
    containing file or directory), so this is normal, not a bug to work around.
    A seed box merged from several same-file changes (Procedure step 3) still gets a status:
    `"deleted"` only if every merged change was itself a delete; otherwise `"new"` only if every
    merged change was itself an add; otherwise `"modified"` (touching even one existing line, or
    mixing a delete in with surviving code, makes the box "an existing thing that changed", not
    "brand new" or "gone"). Never guess past what `reason` says — don't invent add/modify/delete from
    the description text.
  - **`source == "plan"`**: judge from the feature's spec files (there is no diff yet):
    - `"new"` — the plan **creates** this entity (a brand-new struct/file/endpoint the spec names).
    - `"modified"` — an **existing** entity the plan changes (adds a field, changes a signature,
      re-wires a call). How you know: the spec's Input/context already contains that symbol, and the
      tasks describe changing it.
    - `"deleted"` — the plan **removes** this entity (the spec explicitly calls for deleting a
      struct/file/endpoint). Rare — most plan slices only add or change things.
  - **Both sources**: `"context"` — an entity that does **not** change (an unchanged neighbour/caller
    pulled into the slice, or a collapsed background box). Default when a box isn't a change target.
- `relations[].label` (optional) — a short caption on an arrow describing the call/relationship:
  `"builds RankRequest"`, `"calls Rank()"`, `"writes submission"`. Add it on the arrows that matter
  to the story, not on every edge.
- `relations[].hero` (optional, boolean) — mark **at most 1-2** relations `true`: the edge(s) that
  most directly explain what this PR's change does architecturally (the new call into a payment
  provider, not every incidental wiring edge). Rendered visually emphasized on the canvas; everything
  else stays a normal edge. 3+ hero relations trips the self-check's `TOOMANYHERO` advisory — you
  picked too many, not enough of a story.
- `relations[]` — only edges fully inside the final box set. Direction is who initiates (a caller
  `from` → a callee `to`), matching what `impact/context`'s `relations` already spells.
- **Every id must be unique** across `nodes[]`. Copy `node_id`/`id` from `impact/context` for any
  real node; never invent a class/function that isn't in the context.
- `meta.order`/`meta.lane` (`drawing-rules.md`) are almost never needed here — impact shows what a
  change touches, not a process, so there's no "after" or "who performs this step" to record.

## Procedure

1. Resolve `impact_path` from the bridge.
2. Fetch `impact/context?source=diff` (or `?source=plan&feature=<dir>` if the user is working from a
   feature's spec files; the canvas passes the feature path). This is the slice — don't re-derive it
   by grep.
3. Decide the final `nodes[]`:
   - **merge same-file seeds**: every group of seed functions (or tests) inside one source file is
     one box addressed at that file's component node — not a box per changed symbol. Give the merged
     box the file's `component::<path>` id (e.g. `component::application/backend/cmd/server/main.go`)
     — this prefix is what the self-check allows free, so you needn't find it in the slice's own
     node list — `"seed": true`, and a `description` like `"<n> functions changed"` (or the status
     word, e.g. `"Added: TestStatusHTTP*"`). Add `relations` from it the way the slice spells the
     function edges it aggregates;
   - ⚠ **`component::<path>` only applies to one real file — never a directory.** If the change
     touches several files inside one package (a description like "5 files changed: recommend.go,
     deploy.go, handlers_test.go, …"), the box addresses the package, not any single file, so its id
     must be `dir::<path-to-the-package>` (e.g. `dir::gateway-orchestration/internal/api/blueprint`)
     — the same prefix used for a collapsed context box. A `component::` id built from a directory
     path resolves to nothing; the self-check catches this (a `BROKEN … does not exist` line), but
     get it right the first time;
   - a seed at file/dir level, or a single changed symbol that carries the story on its own, stays
     as a real box at its real `node_id`;
   - keep the one-hop neighbours that matter to the story (a caller you can name) as real boxes;
   - fold the rest into a few collapsed context boxes with real ancestor `node_id`s — the slice can
     be small; that's the point;
   - **every box must connect** — the self-check fails on an `ORPHAN`, and a cluster of 2+ boxes
     wired only to each other is an `ISLAND`. After merging, keep the edges the slice spells between
     the boxes you kept; a file-level box that aggregates its file's seeds keeps their edges, so it
     is never left dangling.
   - **give every box its `meta.status`** (see Schema): for `source == "diff"`, read it off the
     seed's own `reason` (`"added"` → `"new"`, `"modified"` → `"modified"`, `"deleted"` → `"deleted"`);
     for `source == "plan"`, judge it from the spec files (never from git — there is no diff yet).
     Either way an unchanged caller or collapsed background gets `"context"`.
4. Wire `relations[]` between the boxes you kept; put a short `label` on the arrows that carry the
   story ("builds X", "calls Y()"), and mark 1-2 of them `hero: true` — the edge(s) a reviewer most
   needs to see first.
5. Write the file. Copy `fingerprint` from `impact/context` so the canvas can flag staleness.
6. **Self-check — never report success on a run that didn't print `OK`:**

   ```bash
   python3 .claude/skills/codechroma-draw-diagram/scripts/check_diagram.py --kind impact --source=diff
   # for a plan diagram, name the feature dir the slice was seeded from:
   python3 .claude/skills/codechroma-draw-diagram/scripts/check_diagram.py --kind impact --source=plan --feature=specs/006-graph-research-endpoint
   ```

   Common codes (`drawing-rules.md`) apply; `BROKEN` also covers a missing `node_id` — copy it from
   `impact/context` instead.

   Exit tiers and the `--shape-advisory` rule: see `drawing-rules.md`.
