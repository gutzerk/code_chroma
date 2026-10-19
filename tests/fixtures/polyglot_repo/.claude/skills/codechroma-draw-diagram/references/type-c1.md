# type: c1 — the system context diagram

Read `references/drawing-rules.md` first — bridge contract, path honesty, density budgets, the
per-box and per-arrow `style` rule, arrow labels and the self-check contract live there and are not
repeated here.

## What C1 is — one system box, actors, nothing inside

`c1` is a true C4-model **system context** view, not a component/service breakdown. The diagram has
exactly two kinds of node, and one kind of relation:

- **The system** (`id: "system"`) — one box for the *whole* analyzed project. It never has
  `parent`-children — there is no internal decomposition to draw here.
- **Actors** (`kind: "person"` or `kind: "external_system"`) — everything outside the system that it
  serves or integrates with. Actors have no children either.
- **Relations** — only `actor → system` or `system → actor`. There is nothing else in the file for a
  relation to connect.

If someone wants component/service-level internals (handler → service → repository chains,
directory decomposition, layered boxes), that's a different, currently unbuilt diagram type — say so
rather than forcing it into `c1`; see `drawing-rules.md`'s "Drawing a type this skill does not know".

## Docs-first for C1

Alongside the digest fetch (see the parallel batch in step 1 of "Procedure" below), check whether the
repo already carries a human-authored system-context diagram — a `docs/c1-diagram.md`, any
`docs/architecture/*context*.md`, or an ARC42-style doc pulled in as a submodule. Read what's already
there.

- Reconcile its actor/external-system list against what `context-digest` confirms below **before**
  deciding what's missing — don't just copy it: some of it may describe target architecture, not
  current code.
- A line marked target/aspirational in the human doc ("opt-in", "mesh only", "seam") is **not**
  current reality — include it in `c1` only if `context-digest` (or a `dependency-digest`
  spot-check) confirms a real code path for it today.
- If the human doc names an actor the digest doesn't surface (e.g. an "AI agent / MCP client" role),
  don't drop it just because the digest missed it — verify it with a spot-check
  (`dependency-digest?path=...`) before adding it.

## Gather context — wiki-general's root, the digest, two spot-checks

Follow `drawing-rules.md`'s Wiki-first fetch order for Step 0 (`wiki-general-context`) first. The
c1-specific delta: read only `root`, the system-level narrative — a free head start on "what the
system is and who it serves" before you fetch the digest below. 🔴 **Never read `containers[]` for
this type.** C1 doesn't decompose, so the C2-level detail those pages carry has no box to attach to
here — that's `patterns`/`custom`'s job, not this one.

**The digest — WHO the system serves and WHAT it integrates with, the primary source for this type:**

```bash
curl -s http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/context-digest
```

Reconcile the digest (and wiki-general's `root`, if any) against what the docs-first read above
found. That's the only context call most runs need beyond wiki-general's root. Two more exist only
for spot-checks, never as a default fetch:

- **Docs-first**, above — read the repo's own human-authored context doc if one exists.
- **`dependency-digest?path=...`** — for an ambiguous case (does this really cross a deployment
  boundary, or is it a driver this project configures and runs itself?), check the specific file:

  ```bash
  curl -s 'http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/dependency-digest?path=src/codechroma/bridge/server.py'
  ```

`c1` no longer decomposes anything, so `/structure` and `/wiki-context` aren't needed for this
type — there's nothing below the system box to give a `path` to.

## Where the file goes

```bash
curl -s http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/c1-path
# -> {"repo_root":"/abs/path/to/repo","c1_path":"/abs/path/to/repo/.codechroma/diagrams/c1/c1.json"}
```

Write the JSON to the returned `c1_path`. Fallback order and the live-update note: see
`drawing-rules.md`. The file you're overwriting may carry a top-level `"draft": true` marker (the
deterministic bootstrap's "unreviewed skeleton" flag) — never copy it into your output. Write
exactly the `## Schema` shape below and nothing else; the marker disappears on its own.

## Schema

Same shared shape as every type (`drawing-rules.md`), with `type: "c1"`. Flat, and shallow by
design — `nodes[]` holds only the system and its actors, none of them carries a `parent`:

```json
{
  "type": "c1",
  "style": "boxes-arrows",
  "nodes": [
    { "id": "system", "name": "Short project name", "description": "One or two sentences: what the system is and who/what it serves.", "kind": "system" },
    { "id": "developer", "name": "Developer", "kind": "person", "description": "One sentence: how this actor uses the system." },
    { "id": "anthropic-api", "name": "Anthropic API", "kind": "external_system", "icon": "anthropic", "description": "One sentence: what the system uses this external system for.", "meta": { "technology": "HTTPS/REST" } }
  ],
  "relations": [
    { "from": "developer", "to": "system", "label": "Browses architecture, runs analysis" },
    { "from": "system", "to": "anthropic-api", "label": "Requests node summaries via HTTPS" }
  ]
}
```

Rules:
- `system` — exactly one node with `id: "system"`, no `parent`, no children, representing the
  **whole analyzed project as a single box**. Never model an internal directory/module as its own
  node.
- Every actor's `id` — stable, unique, short kebab-case (`developer`, `anthropic-api`,
  `postgres-db`). Reuse ids across edits so a block keeps its identity and any manual edits survive.
- An actor's `kind` — `"person"` or `"external_system"`:
  - `"person"` — a human **role the system serves** (end user, admin, API consumer). NOT the
    engineer who develops/maintains this codebase — every project has maintainers, so a generic
    "Developer" actor adds no signal; leave it out unless the user asks for it.
  - `"external_system"` — a **separately-deployed** system this project crosses a boundary to
    reach: a third-party API/product, a database/queue, a CI system, or another repo/service it
    calls, shells out to, or imports as a foreign package. Model the *deployable*, never an internal
    bounded-context/domain of one.
  - ⚠ The test is always **would this deploy separately, and is it something the project only calls
    rather than configures and runs itself?** Two failure directions, both wrong:
    - Missing a real external boundary (a third-party API the digest confirms is called).
    - **Misclassifying an internal component the project deploys and drives itself.** If the code
      contains an adapter/driver that *configures and starts* the backend (not just calls a ready-made
      third-party HTTP API), that backend is part of the system's own data/control plane — not an
      `external_system` — even though it may run as a separate process or container. Example: a
      `PlatformAdapter` that launches and configures a local inference engine is internal; a Cloud
      LLM API the same adapter calls over HTTPS is external.
- An actor's `meta.technology` — short protocol/product label (`"HTTPS/REST"`, `"PostgreSQL"`), fold
  it into a relation's `label` too when it matters to the story, rather than relying on it alone.
- `meta.order`/`meta.lane` (`drawing-rules.md`) are almost never needed here — C1 is a system fan-out,
  not a process, so there's no "after" or "who performs this step" to record.
- `relations[].from`/`.to` — `"system"` or an actor's `id`; nothing else exists to reference.
- Never author `node_id` — the bridge resolves it from `path`, and neither the system nor an actor
  carries one.

Only include an actor/relation the digest (or a spot-checked file) actually gives evidence for —
don't invent integrations just to fill out the diagram.

## Give actors their own look

- **Let external actors read as outside the project.** When several actor boxes compete for
  attention with the system box, give one a quieter `style` (see drawing-rules.md's per-box `style`
  rule) so the system stays the visual subject. Judgment call for a crowded diagram, not a rule for
  every actor.
- **Use `kind` for role, not decoration** — it already renders a distinct glyph.
- **`group` clusters peer actors of the same kind** (e.g. several cloud LLM providers under "Cloud
  LLM providers") — only when there's more than one box in it. See `drawing-rules.md`'s
  anti-patterns list for the `group`-equals-`name` trap.

## Wiring — every actor connects to the system

🔴 **Every top-level actor needs at least one relation to `"system"`.** Don't skip it because the
actor's role feels implied by its description — an actor with no relation renders as a disconnected
box (`ORPHAN`). An actor wired only to another actor, never to `system`, is just as disconnected —
the self-check catches that pair as an `ISLAND` too.

```json
{ "from": "developer", "to": "system", "label": "Browses architecture, runs analysis" }
{ "from": "system", "to": "anthropic-api", "label": "Requests node summaries via HTTPS" }
```

- **Direction is who initiates** — see drawing-rules.md's "Arrow labels".
- **One relation per actor is usually enough.** Add a second only when the actor genuinely plays two
  distinct roles (calls in AND is called back).

## Procedure

1. Resolve `c1_path`, fetch `wiki-general-context`, fetch `context-digest`, and check for a
   human-authored context doc (docs-first) — independent bridge/file reads, issue them as parallel
   tool calls in one message rather than one after the other.
2. Reconcile wiki-general's `root` (if any) and the docs-first read (if any) against what the digest
   confirms — spot-check a disputed entry with `dependency-digest?path=...` before deciding.
3. Build the actor/external-system list: only entries the digest (or a spot-check) actually backs.
   Apply the "would this deploy separately" test, including the adapter/driver refinement above, to
   every disputed case.
4. Write `nodes` — the system box plus every actor — and `relations` — one `actor ↔ system` arrow per
   actor. Write the file now; the canvas re-renders on every write.
5. **Self-check — never report success on a run that didn't print `OK`:**

   ```bash
   python3 .claude/skills/codechroma-draw-diagram/scripts/check_diagram.py --kind c1
   ```

   Common codes (`drawing-rules.md`) apply; `ORPHAN`/`ISLAND` here mean "not wired to `system`" —
   an actor wired only to another actor is just as disconnected.

   `FLAT`, `SHALLOW`, `LISTING`, `SINGLETON`, `VAGUE`, `UNCOVERED`, `DEPTH`, `NOARROWS`,
   `DUPLICATE-PATH`, `NESTING-EDGE`, `BARE` and `COVERAGE` were all decomposition findings — c1's own
   `checks` config (`check_bare_actors: false`, no `coverage_source`) turns the last two off, and none
   of the rest can trigger on a flat `c1` file (nothing has children or a `path`), so none of them can
   print here. If one somehow does, treat it as a bug, not something to work around in the JSON.

   Re-run until it prints `OK`. Exit tiers and `--shape-advisory`: see `drawing-rules.md`. The density
   budgets there (`CROWDED`/`EDGEBOMB`) still apply, but a real system-context diagram — a handful of
   actors — sits nowhere near them.
6. Tell the user the absolute path you wrote, how many actors you found, and that the C1 view updates
   live — no reload needed.

To **clear** the diagram, write `{"type": "c1", "nodes": [], "relations": []}` to the same `c1_path`
(or delete that file).
