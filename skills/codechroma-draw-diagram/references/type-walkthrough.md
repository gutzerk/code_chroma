# type: walkthrough — one process, step by step, over the code it touches

Read `references/drawing-rules.md` first — bridge contract, path honesty, density budgets, the per-box and per-arrow `style` rule and the self-check contract live there and are not repeated here.

A walkthrough shows **one process the user asked about** — "how does Update refresh the architecture map" — as numbered steps. Each step names the real files and functions it runs in, so the canvas can light that route on the code map (**Show route**) and expand a step in place into its calls. It is the built-in home of the `route` data described in `references/type-custom.md` ("Optional `route`"); read that section for the step fields, this one for how to draw the whole thing.

It is **not** a sequence diagram (no lifelines, no return arrows) and **not** a data-flow diagram (arrows are the order of the process, not payloads).

## Where the file goes

```bash
curl -s ${CODECHROMA_BRIDGE_URL:-http://localhost:8000}/repos/${CODECHROMA_WORKSPACE_ID:-default}/walkthrough-path
# -> {"repo_root":"/abs/path/to/repo","walkthrough_path":"/abs/path/to/repo/.codechroma/diagrams/walkthrough/walkthrough.json"}
```

Write the JSON to the returned `walkthrough_path`. Do not overwrite an existing walkthrough silently: `ls -la` the file first; if it exists and the request was not to redraw it, ask.

## Gather context

Follow `drawing-rules.md`'s wiki-first fetch order, then trace the process from `/structure` and the dependency digest (`GET /repos/{id}/dependency-digest?path=<file>`), entry point first. Copy every `path` and `node_id` verbatim; never invent one. Steps carry `meta.order`; an optional `rank: "entry"`/`"exit"` pins an un-numbered box to the first/last layer (`order` wins), and a `"feedback"`/`"return"` relation kind lays out as a back edge.

## Schema

The one shared flat shape (`drawing-rules.md`) with `type: "walkthrough"`, plus a top-level `route`:

```json
{
  "type": "walkthrough",
  "generated_at": "2026-01-01T00:00:00Z",
  "title": "How Update refreshes the stale map",
  "question": "What happens when I click Update on the stale map?",
  "summary": "Refreshes the graph, rewrites changed pages with Claude, then stamps.",
  "nodes": [
    {"id": "click", "name": "Click Update", "description": "You press Update on the stale notice.", "node_id": null, "path": null, "meta": {"order": "1", "no_code_reason": "conceptual"}},
    {"id": "update", "name": "Refresh graph", "description": "The route that starts a map update.", "node_id": "component::dotnet/CodeChroma.Bridge/Routes/WikiGeneralRoutes.cs", "path": "dotnet/CodeChroma.Bridge/Routes/WikiGeneralRoutes.cs", "meta": {"order": "2"}},
    {"id": "rewrite", "name": "Rewrite pages", "description": "Claude rewrites only the pages that changed.", "node_id": "component::skills/codechroma-wiki-general-update/SKILL.md", "path": "skills/codechroma-wiki-general-update/SKILL.md", "meta": {"order": "3"}}
  ],
  "relations": [
    {"from": "click", "to": "update", "kind": "calls", "label": "POST /update", "hero": true},
    {"from": "update", "to": "rewrite", "kind": "spawns", "label": "starts the skill", "hero": true}
  ],
  "route": {
    "id": "update-map", "title": "Update the architecture map",
    "steps": [
      {"id": "click", "order": 1, "lane": "You", "title": "Click Update", "kind": "trigger", "detail": "You, on the stale notice", "node_ids": [], "children": []},
      {"id": "update", "order": 2, "lane": "Bridge", "title": "Refresh graph", "kind": "decide", "detail": "MapPost /update", "node_ids": ["component::dotnet/CodeChroma.Bridge/Routes/WikiGeneralRoutes.cs"], "children": []},
      {"id": "rewrite", "order": 3, "lane": "Claude CLI", "title": "Rewrite pages", "kind": "ai", "detail": "SKILL.md · AI", "node_ids": ["component::skills/codechroma-wiki-general-update/SKILL.md"], "children": []}
    ]
  }
}
```

- **`title`** (top-level, required): a short name (≤ 60 chars, in the language of the user's request) for what *this* diagram shows, never the type name ("Walkthrough"), distinct from the titles already on the canvas — see `drawing-rules.md` "Naming the diagram (`title`)"; the self-check advises `NOTITLE`/`GENERICTITLE` otherwise.

Rules:
- **One step box per route step; the box `id` equals the step `id`.** The route is the spine: `route.steps[*].id` must match a `nodes[].id`, orders run 1..N with no gaps. 5–9 steps; over 12 the self-check prints `SPLIT`.
- **The trigger is step 1** (`kind: "trigger"`, a person or an event, `node_ids: []`, `detail` says who). **The last step is the outcome**; the canvas draws it as ✓.
- **Colour is a signal, so keep it rare:** `ai` (a model runs, drawn violet), `data` (something is written), `failure` (a branch that stops the flow, drawn red; its arrow is `kind: "error"`). Everything else is `decide` or `check`.
- **`title` ≤ 4 words; `detail`** names the actor or the function that runs (`MapPost /update`, `ComputeDelta()`). Do not repeat the title.
- **`node_ids`** are the real files or functions the step runs in. Use `[]` for an actor, an external service or any step with no code in this repo, and give that box `node_id: null`, `path: null`, `meta.no_code_reason: "conceptual"` (an external system also `meta.external: true`).
- **`children`**: the 2–5 calls inside a step that matter, `{id, label, node_id, line}` with a positive integer `line`. Optional; write them by hand from the context cache.
- **`relations[]`** are the order of the process, one per consecutive pair, plus real branches (a failure goes to its own box). Mark the main path `hero: true` on 1–2 arrows. Kinds: `calls` (default), `spawns`, `data`, `minor`, `error`.
- **No `meta.lane`.** A walkthrough has no lane bands; the order chips and the ROUTE panel carry the sequence. (`meta.order` stays: it is the number on the box.)
- Write the JSON as UTF-8 and use plain ASCII in `detail` (`·` and `—` have been mangled into `�` on Windows); say `A, B` not `A · B`.
- Top-level `question` and `summary` are required for the 5-second read.

## Procedure

1. Resolve `walkthrough_path`.
2. Name the process in the user's words (`route.title`); trace its real call chain, entry point first.
3. Collapse pass-through calls so each step changes who acts or what runs; add the failure branch only if the code has one.
4. Author `nodes[]`, `relations[]`, `route`, `question`, `summary`. Write the file.
5. **Self-check — never report success on a run that did not print `OK`:**

   ```bash
   python3 .claude/skills/codechroma-draw-diagram/scripts/check_diagram.py --kind walkthrough
   ```

   The route codes (`BADROUTE`, `ROUTE-*`) are advisory; `ORPHAN`, `DANGLING`, `DUPLICATE`, `SPLIT` and the budgets are in `drawing-rules.md`.
6. Tell the user which files the route lights and which steps have no code. The canvas shows the route with **Show route** on the diagram frame.
