# Drawing rules — shared by every diagram type

Read this once per run, alongside the `type-*.md` the router sent you to.

## Wiki-first fetch order

Before any of your type's own context calls, gather narrative context in this order — wiki-general
first (the richer, meaning-grouped source), the older directory-mirroring wiki second, your type's
own tools last. `impact` opts out of Step 0 and Step 1 entirely — see `type-impact.md`.

🔵 **"First" and "second" is read order, not call order.** Step 1's `paths=` doesn't depend on
Step 0's response — you already know which paths you need from the user's request, so fire both
`wiki-general-context` and `wiki-context` as one parallel batch of tool calls, not two separate
turns waiting on each other. Read Step 0's result before Step 1's only because it's the richer
source; don't pay for a whole extra round-trip just to preserve that reading order.

🔴 **Both calls are mandatory, not "Step 0, then Step 1 if you still need it."** Fire both in the
same tool-call batch before you read a single line of source code, every run — even when Step 0
alone looks like it already answered the question. Skipping Step 1 because Step 0 seemed to be
enough is the single most common way this fetch order gets missed.

### Step 0 — wiki-general (the semantic C1→C2→C3→C4 map)

```bash
curl -s "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/wiki-general-context"
```

- **`has_wiki_general: true`** — read `root` (the system-level narrative) and every entry in
  `containers[].content` (one per C2 container) as your primary narrative source, in place of
  re-deriving the same picture from raw structure/code. `c1` reads only `root` — see `type-c1.md`;
  it never reads `containers[]`.
- Need one **component's** (C3) detail rather than a whole container's? The container's page links
  to its components by id — read `{repo_root}/.codechroma/wiki-general/c3/<id>.md` directly (you
  already know `repo_root` from your type's own `*-path` endpoint); there is no route for this yet.
- **`has_wiki_general: false`** (no wiki-general generated for this repo) — skip straight to Step 1.
  Never trigger a wiki-general generation yourself to fill this gap — it's a paid run up to 900s,
  and generation only ever starts from an explicit user click.
- wiki-general covers a topic only partially, or not at all — fall back to Step 1 for what it
  doesn't cover, same as a `gaps[]` entry below.

### Step 1 — the older, directory-mirroring wiki

```bash
curl -s "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/wiki-context?paths=<comma-separated repo-relative paths you need>"
```

- **`has_wiki: true`** — read `root` and each entry in `pages[]` (already root-to-leaf, deduped)
  instead of your type's usual full `/structure`/`/patterns/context`/`/impact/context` dump. A path
  listed in `gaps[]` has no usable wiki page — fall back to Step 2 for that **one path only**, per
  its own `references/type-*.md`.
- **`has_wiki: false`** — this repo has no wiki generated yet. Fall back to Step 2 for the **whole
  run**, exactly as before this fetch order existed — no wiki step is required first.
- **The route fails** (non-2xx) — the wiki refresh itself failed. Treat this exactly like any other
  reason you can't finish the run: POST `{"state":"error","detail":"<short reason>"}` (see below) and
  abandon the run, rather than proceeding on a context you can't trust.
- **A wiki page isn't detailed enough** (any type) — don't re-fetch the whole `wiki-context` bundle.
  Ask for more on that one path: `/structure?root=<node_id>&depth=1`, or just read the file directly.

### Step 2 — your type's own context tools

Unchanged: each `references/type-*.md`'s own "Gather context" section, for whatever Step 0/1 didn't
already cover.

## Docs-first

Before you decide a box's responsibility from raw code alone, check whether the analyzed repo
already explains it:

1. **Read what's already there.** Its `README.md` and any `docs/**` (`/structure` will surface these
   paths) are the human-maintained source of truth when present — prefer them over re-deriving
   behavior from code.
2. **Still open? Grep/read the source directly** for that one path — cheap, and often enough once
   Wiki-first already narrowed down where to look.

If docs and source still don't answer the question after both steps above, note the gap in your
final message rather than reaching for search.

This is a docs pass, not a replacement for the Wiki-first fetch order above — do the Step 0/1
wiki checks first for what you already know you need; this is only for what those two steps didn't
cover.

## Bridge contract

**Base URL:** use `$CODECHROMA_BRIDGE_URL` if set (the desktop app's terminal panel exports the real
dynamic port there); otherwise default to `http://localhost:8000`.

**Workspace id:** every `/repos/{repo_id}/...` path uses `${CODECHROMA_WORKSPACE_ID:-default}`. The
bridge sets `CODECHROMA_WORKSPACE_ID` on this run (e.g. `pr-29` when reviewing a pull request); the
main workspace leaves it unset, so `:-default` resolves to `default`. Use the **same id** for the
`*-path` endpoint as for the context endpoints, so a PR run writes its artifact into its own
worktree, not the main checkout.

**Ask the bridge for the write path — do not derive it from cwd.** The canvas only reads these
artifacts from the repo the bridge was launched against, which is often *not* your shell's cwd.
⚠ **Never conclude the file or this skill is "missing" from a relative `ls`/`find`.** Query the
exact absolute path first (the endpoint name is in your type's reference), then write there, creating
the parent directory if missing.

If that curl fails (bridge unreachable), fall back in this order and **tell the user which fallback
you used**:

1. `$CODECHROMA_BRIDGE_REPO_PATH/.codechroma/<file>`
2. `<cwd>/.codechroma/<file>`

A `FileWatcher` on that exact path (a `DirWatcher` on `.codechroma/diagrams/custom/`) pushes a live update to
the canvas — wrong path, nothing appears, no error.

**Never overwrite an existing diagram silently.** Before writing the file, check whether an artifact
for this kind already exists at the resolved path (`ls` the exact absolute path, or `[ -f ... ]`). If it
does, do **not** replace it on your own — the canvas shows one diagram per layer, and replacing it
destroys the previous one with no undo (`.codechroma/` is gitignored). Instead:
- If the request is to *draw a fresh/new* diagram and one already exists, **stop and ask the user**
  whether to replace the existing one (names/participants are unlikely to survive the overwrite).
- If the request is to *update/redraw* an existing diagram, proceed, but say so explicitly in your
  final report ("replaced the existing `<kind>` diagram with a new one").
Only skip the check when the endpoint's response (or your own `ls`) shows no file yet.

**Report your own progress (`c1` only — no other kind has a `.../status` route).** A headless
`/generate` run flips its own "generating" status automatically; your interactive run does the same
three POSTs by hand:

```bash
curl -s -X POST "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/c1/status" \
  -H 'Content-Type: application/json' -d '{"state":"generating"}'
```

- Send `{"state":"generating"}` **before writing the skeleton** — the canvas's generating panel
  appears from this one call, no other change required.
- Send `{"state":"idle"}` once the self-check prints `OK`.
- Send `{"state":"error","detail":"<short reason>"}` if you abandon the run instead of finishing it
  (e.g. the self-check never converges) — never leave the job stuck on `generating`.

## Path honesty

⚠ **Never use `ls`, `find`, or your memory of the tree to author a path.** Copy `path` and `node_id`
values **verbatim** from the bridge (`/structure`, `patterns/context`, `impact/context`); never
construct or extend one. A path that doesn't resolve renders as a visibly broken dead end.

The graph excludes `node_modules`, `dist`, `build`, `__pycache__`, `.venv` and `.codechroma`, so a
path that really exists on disk may have **no graph node at all**. That is not a bug to work around
— pick a path the graph listed, or leave the box conceptual (`path`/`node_id` null) where its schema
allows it.

## Density budgets

These are a **pathology ceiling, never a size target.** Hitting one means the diagram has gone
wrong — not that you're near a recommended size. `c1` in particular has no numeric authoring target at
all (see its own reference's "How much to decompose"); the other types should stay well under these
numbers in ordinary use. Treat these as the wall, never the goal.

| kind | max_nodes | max_relations | max_name_chars | max_edge_label_chars |
|---|---|---|---|---|
| c1 | 60 | 60 | 40 | 50 |
| patterns | 45 | 70 | 40 | 50 |
| impact | 25 | 40 | 40 | 40 |
| epics | 60 | 60 | 60 | 50 |
| custom | 60 | 100 | 40 | 50 |
| sequence | 24 | 60 | 40 | 60 |

`sequence`'s "nodes" are its participants (kept tight at 24 — a readable diagram has a handful of
boxes across the top), and its "relations" are its messages (the real story, capped higher at 60).

`impact`'s 25 is low **on purpose**: its slice is one-hop by construction, so a big impact diagram
means you dumped the repo instead of judging the slice. `patterns` has the opposite failure mode —
its characteristic bug is too *few* boxes (`SPARSE`), not too many.

## Splitting a crowded diagram

Past ~15 nodes a diagram gets unreadable (overlapping frames, tangled edges), long before the
ceilings above. The self-check prints a `SPLIT` advisory when the count exceeds 15
(`--split-threshold N` tunes it, `0` disables it; a legitimately large diagram may stay whole).

1. **Warn and propose, don't just draw.** Tell the user the diagram is too large and propose a split
   plan — by stage/frame, by subsystem/directory, by flow step, or by abstraction layer — naming each
   resulting diagram and what it holds. Ask them to confirm, adjust, or keep one diagram.
2. **On confirm, draw several focused diagrams**, each coherent on its own and within the threshold.
   Write the first to the type's normal path; write the others as `custom` diagrams (or the
   type's own sub-slug where it has one), each running the self-check.
3. **Cross-reference them.** Give every split diagram a box (kind `external`, named after its
   sibling, `description` saying which diagram holds the rest) for each neighbour it hands off to,
   so the whole picture stays navigable.

## Anti-patterns

One line each; every one of these is a finding, not a style preference.

- A flat listing where a decomposition belongs — 4+ leaf siblings that call each other.
- An orphan box (relates to nothing) or an island cluster (relates only to itself).
- An arrow that only restates the nesting — a parent already visually contains its child.
- A bare label with no `description`.
- A filler name — `Utils`, `Helpers`, `Core`, `Misc`, `Other` — proof the split isn't real.
- One deployable split into peer boxes (a product, its plugin hub, and its plugins are **one** box).
- A duplicate `id` — relations address boxes by bare id, so both become unaddressable.
- One repo path claimed by two boxes — give the code one home, reach it with an arrow.
- An unlabeled arrow where the label would carry the story.
- A box's `group` set to its own `name` — a redundant cluster wrapper doubles the box visually.

## The per-box and per-arrow `style` rule

Every type accepts an optional `style` on a box *or an arrow (relation)* — a presentational override
the canvas applies verbatim. **Only these four CSS properties are allowed:** `color`, `background`,
`border-color`, `border-style`. Anything else (position, size, z-index, padding, …) is **silently
ignored**. `style` is a per-element flag, never a whole-diagram theme; add it only when a box (or an
arrow) genuinely needs to stand out or recede. When several participants dedup into one box, the
first supplies the style.

An arrow's `style` paints its **line and its label** from `color` (the other allow-listed keys are
harmless no-ops on an SVG arrow). The arrowhead itself stays uncoloured — per-arrow head colouring
isn't supported (the canvas renderer's arrowheads come from shared `<marker>`s; see
`ArrowMarkerDefs`). So to make an arrow read as the critical path, colour *it*, and to make a box
read as "at risk", colour the *box* — the two don't compete.

Prefer the theme's own CSS variables (`web/src/styles.css`'s `:root`) over a hardcoded hex, so a box
still reads correctly if the theme's palette ever shifts:

- Surfaces/borders: `--surface-0`…`--surface-4`, `--surface-inset`, `--surface-code`, `--border`,
  `--border-strong`, `--border-subtle`, `--border-faint`
- Text: `--text-1`, `--text-2`, `--text-3`, `--text-strong`, `--text-invert`
- Accent/semantic: `--accent`, `--accent-muted`, `--primary`, `--link`, `--added`, `--danger`,
  `--warning`, `--plan`, `--trace`, `--c1`, `--patterns`

e.g. `{"color": "var(--text-invert)", "background": "var(--danger)"}` for a box you want to read as
"broken" or "at risk". A hardcoded color (`"#dc2626"`) still works — the allow-list is on the CSS
*property*, not the value — but a theme variable stays correct if the palette changes later.

## Icons

`kind` — **optional**, one of `api` / `ui` / `service` / `database` / `queue` / `cache` / `worker` /
`auth`. Picks the box's glyph, so a deep diagram reads by shape at a glance. Set it only when the
box's own responsibility is unambiguously one of these; a generic "Domain" or "Handlers" grouping box
is better left without one than forced into the nearest fit. Never invent a new value — an
unrecognized one just renders with no icon.

`icon` — **optional**, a real brand logo instead of the generic `kind` glyph, for a box whose
identity *is* a specific named product. One of the recognized slugs below; set it only when you are
confident the box genuinely *is* that product — never guess a slug to decorate a generic box, and
never invent one that isn't in this list:

`anthropic, apachekafka, auth0, bedrock, bitbucket, circleci, claude, claudecode, cloudflare,
confluence, datadog, digitalocean, docker, elastic, elasticsearch, figma, firebase, gemini,
github, githubactions, gitlab, googlecloud, grafana, hubspot, influxdb, jira, kubernetes,
langchain, mariadb, mistral, mongodb, mysql, netlify, newrelic, nginx, okta, ollama, openai,
pagerduty, paypal, postgresql, prometheus, rabbitmq, redis, render, sentry, sqlite, stripe,
supabase, terraform, vercel, zendesk`.

The set is sourced from two places: `web/src/icons/brands.generated.ts` (simple-icons, includes
`anthropic`) plus `web/src/icons/brandLobe.ts` (lobe-icons, MIT) for the LLM/AI marks simple-icons
withdrew on trademark request — `claude`, `claudecode`, `openai`, `gemini`, `langchain`, `mistral`,
`ollama`, `bedrock`.

⚠ Some well-known brands (AWS, Azure, Slack, Twilio, SendGrid) are still **not** in this list —
they were withdrawn from the underlying icon sets on trademark request, not omitted by mistake. Don't
substitute a lookalike slug for one of these; leave `icon` unset and let `kind` (or nothing) carry
it. An unrecognized slug renders exactly like an unset one — a silent, harmless fallback — but still
only use a slug from this list.

## Arrow labels

- **Direction is who initiates.** The caller is `from`. A response travelling back is not a second
  arrow.
- A label is a **short verb phrase, a few words** — `"Sends receipt emails via"`, `"builds
  RankRequest"`, `"calls Rank()"`, `"Authenticates users against"`. It renders on the line between
  the two boxes, so keep it terse.
- Never restate the target's name. Put labels on the arrows that carry the story, not on every edge.

## The self-check

One command shape, run from the repo the bridge serves:

```bash
python3 .claude/skills/codechroma-draw-diagram/scripts/check_diagram.py --kind <c1|patterns|impact|custom|epics> [--type <type-id>] [--source=diff|plan] [--feature=<dir>] [--json <file>]
```

`epics` reads the bridge's resolved `epics.json` when given no `--json`; a per-epic diagram
(`epics/<epic_id>`, no resolved-GET route) is checked by pointing `--json` at the file it was written
to (`type-epics.md`).
```

It fetches the bridge's resolved diagram, prints one line per finding, and exits non-zero unless
everything passes. Don't hand-grep the JSON instead — the response is serialized without spaces, so a
naive grep silently passes.

| Exit | Means |
|---|---|
| `0` | `OK` — every check passed |
| `1` | BROKEN — a correctness finding (unresolved id, dangling/self relation, duplicate) |
| `3` | SHAPE — shape findings only; override with `--shape-advisory` |
| `2` | the diagram couldn't be read at all |

🔴 **Never report success on a run that didn't print `OK`.** If a shape finding genuinely doesn't
apply (a repo really is four files), rerun with `--shape-advisory` and **name the finding and say why
you overrode it** in your final message — never silence it quietly.

### Fix the whole report, then rerun once

The script never stops at the first finding — it always prints every one it found in that run (see
`_Report`, `check_diagram.py`). Read the **entire** report before touching anything, fix every line
in one batch of edits, then rerun the script exactly once to confirm. Fixing one finding and
rerunning before reading the rest turns a single self-check into one rerun per finding, for no
reason — the full list was already in front of you on the first run.

### Common finding codes

Same six per type; each `type-*.md` adds only what differs.

| Code | Fix |
|---|---|
| `BROKEN <id>` | copy `path`/`node_id` verbatim, or fix/delete the entry |
| `DUPLICATE <id>` | rename — relations address by bare id |
| `DANGLING <pair>` | fix the id, or drop the relation |
| `SELF <pair>` | drop it (`custom`'s `dependency-graph` style excepted — recursion is real) |
| `ORPHAN <id>` | wire it in, or drop it |
| `ISLAND <ids…>` | wire in the missing relation, or merge/drop the cluster |

## The one shared diagram shape

Every type (`c1`, `patterns`, `impact`, `custom/<id>`) authors this exact shape — `type`/`meta` carry
the only per-type variation, nothing else in the shape differs (see
`specs/036-shared-diagram-style-catalog/contracts/diagram-schema.md`):

```json
{
  "type": "c1",
  "style": "boxes-arrows",
  "nodes": [
    {
      "id": "http-edge", "name": "HTTP edge", "description": "One sentence: what this box represents.",
      "parent": null, "path": "src/api", "node_id": null, "group": "API", "kind": "api", "icon": null,
      "style": null, "meta": {}
    }
  ],
  "relations": [
    { "from": "http-edge", "to": "store", "kind": "writes", "label": "user rows", "style": null }
  ]
}
```

- `id` unique across the file; `path`/`node_id` copied verbatim or left null for a purely conceptual
  box; every box gets a real `description`.
- `parent` — another node's own `id`, for decomposition/nesting (c1's blocks) or instance→participant
  grouping (patterns). Never a display hierarchy of its own — `group` is the clustering signal.
- `group` — a cluster label; only rendered when the diagram's style has `supports_groups`.
- `kind`/`icon`/`style` — see Icons and the per-box and per-arrow `style` rule below; `style` on a
  relation follows the same allow-listed CSS properties.
- `meta` — an open bag for type-specific fields (`status`, `confirmed`, `confidence`, `order`,
  `lane`, ...), never read by the shared resolver/renderer. Put anything that isn't one of the fields
  above here. There is **no** `critically` field anymore — the `bridge`/`hub` meta-stamp and its
  canvas chip were removed as dead weight (a bridge/hub box already visibly converges arrows).
  Fragility is surfaced only by the self-check's `ARTICULATION` advisory; never author it.
- `meta.order` — an authored, optional step number (`"1"`, `"2"`, `"2a"`/`"2b"` for two things
  happening at once) recording a box's place in a process the diagram describes (CONTEXT.md's
  "Order"). Only meaningful for a diagram that actually shows a process/flow (most custom diagrams);
  leave it unset on structural diagrams (C1's system fan-out, patterns' class graph) where there's no
  "after" to record. Never computed from a call graph or execution trace — the authoring skill
  decides it. Boxes sharing a leading `order` digit (`"2a"`/`"2b"`) render as one highlighted
  "Concurrency island" automatically — that grouping is derived, not a field you set yourself.
- `meta.lane` — an authored, optional performer name (CONTEXT.md's "Lane") recording *who* carries
  out a box's step — a team, service, or role, e.g. `"Billing service"`/`"On-call engineer"`. Every
  box sharing the same `meta.lane` string renders inside one shared soft-tinted area and sorts
  adjacent to each other within their `order` rank. Independent of `order` — set one, both, or
  neither. Same rule as `order`: only meaningful for a process/flow diagram; leave it unset on
  structural diagrams where there's no "who" to record.
- Never relate an id to itself, and never relate two ids that aren't both in `nodes[]` — the resolver
  drops what it can't place, it never invents one.

## The style catalog

`"style"` at the top level is either a catalog name (`boxes-arrows`, `dependency-graph`,
`patterns-yellow-arrows`, `impact-status-colors`, `layered-flow`, `state-machine`) or an inline
overrides object of the same shape — pick a preset unless the diagram genuinely needs a one-off
combination. A preset controls capabilities the shared resolver/renderer read (self-relations
allowed, grouping enabled, per-relation-kind coloring), not any per-type schema — the same six
presets apply to any diagram type. An unrecognized preset name degrades to no overrides rather than
failing, so getting this wrong never breaks the diagram.

## Drawing a type this skill does not know

The user wants a diagram none of the four rows covers. In this order:

1. **`GET /diagram-types`.** If a saved type is close, use it — go to `references/type-custom.md`
   and author that type's instance. A saved type always wins over improvising.
2. **If none fits and they'll want this diagram again in other projects**, say so, then save one
   yourself: `PUT /diagram-types/{type_id}` with `{id, title, description, style, layout, grouping,
   relation_kinds, instructions, context_sources}` — `GET /diagram-styles` lists valid `style` ids,
   and the route 400s with the exact field problem if anything's malformed, so a bad first attempt is
   cheap to fix. There is no interactive wizard for this anymore. Then draw its first instance per
   `references/type-custom.md`.
3. **If they want it now, once**: author `nodes[]`/`relations[]` per the generic shape above and
   place it on the canvas directly through the one write point —
   `PATCH /repos/{id}/canvas` with `add_element` / `add_edge` ops, `created_by: "ai"`, and a `layer`
   named after the diagram. That route is real (`src/codechroma/bridge/routes/canvas.py`) and
   `apply_batch` accepts exactly those ops, so this is a genuine capability, not a polite refusal.

   **A real, working batch** (field names verified against `canvas/apply_batch.py` and
   `canvas/document.py` — don't guess these by trial and error):

   ```bash
   curl -s -X PATCH "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/canvas" \
     -H 'Content-Type: application/json' -d '{
       "layer": "my-diagram",
       "explanation": "short reason for this batch",
       "ops": [
         {"op": "add_element", "temp_id": "n1", "render": "custom",
          "label": "HTTP edge", "description": "One sentence.",
          "node_id": "component::src/api", "position": {"x": 0, "y": 900},
          "created_by": "ai"},
         {"op": "add_element", "temp_id": "n2", "render": "custom",
          "label": "Store", "description": "One sentence.", "node_id": null,
          "position": {"x": 300, "y": 900}, "created_by": "ai"},
         {"op": "add_edge", "from": "n1", "to": "n2", "kind": "writes",
          "label": "user rows"},
         {"op": "delete_element", "id": "n2"}
       ]
     }'
   ```

   - **`render`** is the field for a box's kind, and its value is one of
     `RENDER_KINDS = ("hierarchy", "c1", "pattern", "impact", "epic", "custom", "group", "note")`
     (`canvas/document.py`). For an ordinary diagram box, use `"custom"` — not `"box"`/`"node"`/
     `"shape"`, none of which exist. `"group"`/`"note"` are for a native group container or sticky
     note, not a generic diagram node.
   - **`temp_id`** is a scratch id **you invent** on `add_element`/`add_edge` — later ops in the
     *same batch* can address that element/edge by it (an `add_edge`'s `from`/`to`, or a later
     `delete_element`'s `id`) instead of the real id, which doesn't exist yet when you're writing the
     batch. A real id (from a prior `GET /repos/{id}/canvas`) also works anywhere a `temp_id` does.
   - **`delete_element`**'s op name is `delete_element` (not `remove_element`), and its target field
     is `id` (a real id or a `temp_id` from earlier in the same batch).
   - **`position`** is `{"x": <float>, "y": <float>}`, required on every `add_element` — see below.

   🔴 **Set a real `position` on every `add_element` op.** This path never runs through the canvas's
   own auto-layout (`autoLayout.ts`'s `layoutNewElements` — client-side, only wired to the
   recipe/custom-type "Add" flow), so an op with no `position` lands at `(0, 0)`, and every diagram
   you draw this way piles up in the same spot. Before writing any `add_element` op:
   - `GET /repos/{id}/canvas` (same call `highlight-process.md`'s "see what's already there" uses).
   - Find `maxBottom`, the largest `element.position.y + (element.size?.h ?? 72) / 2` in the response.
   - Center your first row of boxes around `y = maxBottom + 300` (headroom for a multi-row diagram),
     later rows/columns further down/right, `x` spread however fits the node count.
   - Exact pixel placement doesn't matter; landing outside every existing diagram's box does.
   🔴 **Resolve a real `node_id` for every box whose description names an actual file, before you
   write the `add_element` op — never leave it `null` "because there's no function-level graph".**
   This path has no self-check to catch a missed one, and a path-less box needs its own explicit
   signal here: it never runs through `resolve_diagram()` (`diagram_resolver.py`'s
   `_stamp_no_code_reason`), the one place `meta.no_code_reason` gets computed automatically for
   every other diagram type. Without it, clicking the box opens `InspectorPanel`, not the description
   popup, and fails with "This node no longer exists" the moment a real user clicks — a real, observed
   incident (a process-trace diagram authored with every `node_id` left `null`, even for boxes whose
   description literally named the source file). `GET /structure?root=dir::<pkg>&depth=1` gives you
   file-level `node_id`s (`component::<path>`) even when the graph has no function-level nodes — use
   the file it lives in, never `null`, for any box that maps to real code. **If you're copying the
   shape of an existing freeform diagram as a starting template, re-verify its `node_id`s are real
   too — don't propagate a `null` you're copying from one diagram into the next one.** Leave `node_id`
   unset only for a genuinely conceptual box with no owning file (an external actor, a decision gate
   that isn't itself a line of code) — and when you do, also set
   `"meta": {"no_code_reason": "conceptual"}` on the `add_element` op itself. The canvas honors it
   exactly like a resolver-computed one: a dotted border, a CONCEPTUAL chip, and a click opens the
   description popup with your box's own `description` instead of the Inspector's misleading message.
5. **Obey the density budgets above, using the `custom` row** (60 nodes / 100 relations / 40-char
   names / 50-char edge labels), and every anti-pattern in this file still applies.

6. **Self-check — there is no `check_diagram.py --kind` for this path** (it writes straight to the
   canvas, not a `.codechroma/<kind>.json` file `check_diagram.py` could fetch and resolve), so do
   this by hand before you report success:

   ```bash
   curl -s "http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/canvas"
   ```

   Filter to the elements/edges whose `layer` is the one you just wrote, then check:
   - **`BROKEN`/failed op** — re-read the batch's own response first: a failing op returns an error
     entry there, not a silent no-op. Fix and resend rather than trusting the next `GET`.
   - **`DANGLING`** — every edge's `from`/`to` resolves to a real element id in this layer.
   - **`ORPHAN`** — every `render: "custom"` element you added has at least one edge touching it
     (a `render: "group"`/`"note"` element is exempt — those are annotations, not diagram nodes).
   - **`DUPLICATE`** — no two elements you just added share a `label` that should have been one box.

   Same rule as every other kind: don't report the diagram finished until this pass comes back
   clean.
