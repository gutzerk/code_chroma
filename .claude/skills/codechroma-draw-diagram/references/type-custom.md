# type: custom — a user-authored diagram type

Read `references/drawing-rules.md` first — bridge contract, path honesty, density budgets, the
per-box and per-arrow `style` rule, arrow labels, the generic `nodes[]`/`relations[]` shape and the
self-check contract live there and are not repeated here.

Write one user-authored diagram type's data for **this repository**. Unlike C1 or Patterns, the
*rules for what to draw* are not written into this reference at all — they live in a **diagram-type
definition** the user authored once, in a separate interview, and that definition's `instructions`
field is your entire authoring brief. Two different diagram types can produce wildly different
pictures from the exact same repo; your job is to follow whichever `instructions` this run's
`type_id` names, not a fixed template.

## Gather context efficiently

**Follow `drawing-rules.md`'s Wiki-first fetch order first**, for the paths this definition's
`instructions` point you at — its wiki pages substitute for `/structure` below wherever they cover a
path; see `drawing-rules.md` for the full substitution/fallback rule.

**1. The diagram type's own definition — this is your authoring brief, not a fixed schema:**

```bash
curl -s http://localhost:8000/diagram-types/<type-id>
```

Returns the definition: `title`, `description`, `style` (which render style to target — see
"Schema" below), `layout`, `grouping` (`{"enabled": bool, "label": str}` — only cluster nodes by
`group` when `enabled` is true), `relation_kinds` (the vocabulary `relations[].kind` should use),
`context_sources` (which of the endpoints below this type actually needs), and **`instructions`** —
free text written by the user describing exactly what to put on this diagram and how. Quote it to
yourself and follow it literally; it is the single source of truth for what "done" looks like here,
since the same reference authors every diagram type differently depending on what it says.

If you don't know the `type_id`, list them: `curl -s http://localhost:8000/diagram-types`.

**2. Real repo paths, for any node that should link to real code:**

```bash
curl -s 'http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/structure?depth=2'
curl -s 'http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/structure?root=dir::src&depth=2'
```

Copy `path`/`node_id` verbatim — see "Path honesty" in `drawing-rules.md`.

**3. Optional, only when the definition's `context_sources` names it:**

```bash
curl -s 'http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/dependency-digest?path=<some/file.py>'
# omit ?path= for the whole repo's resolved caller/callee map
```

Don't fetch sources the definition didn't ask for — `context_sources` is the whole point of keeping
this generic instead of hardcoding a fixed context bundle per type.

**When `style` is `dependency-graph`, always fetch the dependency digest** (whole-repo, no `path=`)
and build `nodes`/`relations` from it directly, instead of reading files free-form — it is already
the resolved file→class→function caller/callee map, cheaper and more accurate than re-deriving an
import graph by hand. Set `relations[].kind` to `imports` or `calls` (nothing else), and **keep
cycles**: if A imports B and B imports A, write both relations — don't drop either to make the
picture acyclic. A node relating to itself (e.g. recursion, `kind: "calls"`) is also valid for this
style only; the self-check's `SELF` finding still applies to every other style.

## Where the file goes

```bash
curl -s http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/custom/<type-id>-path
# -> {"repo_root":"/abs/path/to/repo","custom_path":"/abs/path/to/repo/.codechroma/diagrams/custom/<type-id>/<type-id>.json"}
```

Write the JSON to the returned `custom_path` (create `.codechroma/diagrams/custom/<type-id>/` if
missing). Fallback
order and the live-update note (`DirWatcher` on this directory): see `drawing-rules.md`.

## Schema

The same shared shape every type authors (`drawing-rules.md`) — custom types have used this flat
`nodes[]`/`relations[]` shape since before 036, so nothing here changed with that migration.
`parent`/`icon`/`meta` are available too when the definition's `instructions` call for them (nesting,
a brand icon, type-specific extra fields); the style catalog (`drawing-rules.md`) governs which
capabilities (grouping, self-relations, edge coloring) the chosen `style` turns on:

```json
{
  "type_id": "data-flow",
  "style": "boxes-arrows",
  "generated_at": "2026-01-01T00:00:00Z",
  "nodes": [
    {
      "id": "http-edge",
      "name": "HTTP edge",
      "description": "One sentence: what this box represents, in this diagram type's own terms.",
      "group": "Transport",
      "node_id": null,
      "path": "src/api"
    }
  ],
  "relations": [
    { "from": "http-edge", "to": "store", "kind": "writes", "label": "user rows" }
  ]
}
```

Rules:
- `nodes[].id` must be unique across the file — relations address nodes by bare id.
- `nodes[].path` is optional; when set, copy it verbatim from `/structure` so it resolves to a real
  `node_id` and the box clicks through to real code. Leave `path`/`node_id` null for a purely
  conceptual box the definition's `instructions` asked for that has no single owning file/dir.
- `nodes[].group` is only meaningful when the definition's `grouping.enabled` is true — use short,
  consistent group names (the definition's `grouping.label` names what a group represents); leave it
  `null` when grouping is disabled or a box doesn't fit any group.
- `nodes[].style` is optional — see `drawing-rules.md`. Use it to flag a critical box; it applies
  alongside the group accent.
- `relations[].kind` should be one of the definition's own `relation_kinds` ids when it lists any;
  invent a short lowercase verb only when it doesn't.
- Never invent a relation between two ids that aren't both in `nodes[]`. Never relate an id to
  itself either, **except for `dependency-graph`**, where a self-relation is real data (recursion).
- Cover what the `instructions` actually asked for — a diagram type asking for "every service that
  writes to the database" should not stop at the first one you find.

### Make every box and relation carry its weight

A diagram where most boxes are bare labels with no group and no connection reads as broken, even
though the schema allows it. Follow the definition's `instructions` to keep the output rich:

- **When `grouping.enabled` is true, group genuinely distinct things.** Don't leave most boxes
  `group: null` — assign each one a real group the `instructions` calls for (layer, concern, ...).
  A type that says "organize by layer" should have every box in a layer, not a few stragglers.
- **Every box gets a real `description`** (one sentence explaining what it is in this diagram's
  terms), not empty or one word.
- **Don't drop to a bare chain unless the type really is one.** Most flow/architecture types want
  more structure than a straight list. Add the intermediate steps/nodes the `instructions` imply so
  the picture reflects the codebase, not a thin skeleton.
- **Label relations with the actual payload** where it adds meaning — `"Request context"`,
  `"vector search"` — instead of only the kind verb. A labelled arrow is far more readable.

A good test before writing: **would this diagram still look rich if the colour palette and cluster
halos were on?** If removing groups would collapse it to a flat list, you've under-grouped.

## Recording process order — `meta.order`/`meta.lane`, not text in the arrow label

When the definition's `instructions` describe a **process or communication flow** (a request moving
through several parties, a protocol handshake, a multi-step pipeline), record each box's place with
`meta.order` and its performer with `meta.lane` (`drawing-rules.md`) — never by numbering steps inside
a relation's `label` (`"Step 1: ..."`, `"2. then ..."`). A label read in isolation, out of layout
order, still needs to say what the arrow carries; the step number belongs on the box, where the
layout and the rendered badge/soft-area already show it.

```json
{
  "type_id": "mcp-communication-architecture",
  "style": "boxes-arrows",
  "nodes": [
    { "id": "client-request", "name": "Client sends tool call", "description": "The MCP client issues a JSON-RPC request over the transport.", "meta": { "order": "1", "lane": "Client" } },
    { "id": "server-validate", "name": "Server validates params", "description": "Schema-checks the incoming request against the tool's declared input schema.", "meta": { "order": "2a", "lane": "Server" } },
    { "id": "server-log", "name": "Server logs the call", "description": "Structured audit log entry, independent of validation.", "meta": { "order": "2b", "lane": "Server" } },
    { "id": "server-response", "name": "Server returns result", "description": "JSON-RPC response sent back once validation and logging both complete.", "meta": { "order": "3", "lane": "Server" } }
  ],
  "relations": [
    { "from": "client-request", "to": "server-validate", "kind": "calls" },
    { "from": "client-request", "to": "server-log", "kind": "calls" },
    { "from": "server-validate", "to": "server-response", "kind": "calls" },
    { "from": "server-log", "to": "server-response", "kind": "calls" }
  ]
}
```

`"2a"`/`"2b"` share a leading digit, so the canvas renders them as one Concurrency island automatically
— no separate field marks them as parallel. `"Client"`/`"Server"` each get their own soft-tinted Lane
area grouping their boxes together, independent of the numbering. Leave both fields unset on a
diagram that isn't a process — most structural diagrams never need them (see `type-c1.md`/
`type-patterns.md`/`type-impact.md`).

## Procedure

1. Fetch the definition (`GET /diagram-types/<type-id>`). Read `instructions` carefully — it is the
   whole brief for this run, not a fixed rulebook this skill already knows.
2. Resolve `custom_path` from the bridge.
3. Fetch `/structure` (and any other `context_sources` the definition names) for real paths.
4. Author `nodes[]`/`relations[]` following the `instructions` literally: what counts as a node, how
   it's named/described, whether/how it's grouped, and what relation kinds connect them.
5. Write the file with `type_id`, `style` (copied from the definition), and `generated_at` set.
6. **Self-check — never report success on a run that didn't print `OK`:**

   ```bash
   python3 .claude/skills/codechroma-draw-diagram/scripts/check_diagram.py --kind custom --type <type-id>
   ```

   The six common codes (`drawing-rules.md`) cover everything this type can raise, including the
   `dependency-graph`-style `SELF` exception noted there.

   Exit tiers and the `--shape-advisory` rule: see `drawing-rules.md`.
