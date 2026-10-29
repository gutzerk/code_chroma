# type: dataflow — where data comes from, where it is stored, where it goes

Read `references/drawing-rules.md` first — bridge contract, path honesty, density budgets, arrow labels and the self-check contract live there and are not repeated here.

A data-flow diagram shows **what data moves between which sources, processes and stores**. Arrows are data, not calls; there is no time axis (that is `sequence`, never this). It is a saved `custom` type with id `dataflow`, so it is drawn and checked exactly like any custom type.

Edge `kind` on `relations[]`: `calls` (default), `spawns` (starts a process/CLI/agent), `data` (reads/writes a file/DB/store), `minor` (optional link) -- set `spawns`/`data` whenever true; see `drawing-rules.md` "Edge kinds".

## Save the type once

`GET /diagram-types/dataflow`. On a 404 save it, then continue with `references/type-custom.md` for the path, schema and self-check:

```bash
curl -s -X PUT ${CODECHROMA_BRIDGE_URL:-http://localhost:8000}/diagram-types/dataflow -H 'Content-Type: application/json' -d '{
  "title": "Data flow",
  "description": "What data moves between sources, processes and stores.",
  "style": "boxes-arrows",
  "schematic": "dataflow",
  "layout": {"direction": "LR"},
  "grouping": {"enabled": true, "label": "Trust zone"},
  "relation_kinds": [
    {"id": "reads", "label": "reads"}, {"id": "writes", "label": "writes"},
    {"id": "sends", "label": "sends"}, {"id": "transforms", "label": "transforms"}
  ],
  "context_sources": ["structure", "dependency-digest"],
  "instructions": "Draw the data flow of this repository. Boxes are of three roles, named in the box description: SOURCE (user input, files, queues, external APIs), PROCESS (code that transforms or routes data) and STORE (database, cache, file, in-memory state). Group boxes by trust zone or layer (client, service, storage, external). Every arrow is data and its label names the payload (user rows, auth token, parsed AST), never a verb alone. Trace at least one complete path from where data enters to where it is stored or leaves. Do not draw call order, and do not add a box that no data touches."
}'
```

## What to draw

1. Find **entry points** (routes, CLI args, file readers, queue consumers, watchers) from `/structure` and the dependency digest — these are the SOURCES.
2. Follow each one inward to the code that transforms it (PROCESS) and to every place it is persisted or sent on (STORE, external SINK).
3. One box per role-bearing thing, not per function: collapse a chain of pass-through calls into one PROCESS box.
4. Set `path` from `/structure` verbatim on boxes backed by real code; leave it null for conceptual or external boxes.
5. `kind` is `reads`, `writes`, `sends` or `transforms`; the `label` is the payload.
6. Set the top-level `question` ("Where does X end up?") and 1–2 `hero` relations: the main path of the data.
7. Set the top-level `title` to what this flow shows ("Where an uploaded invoice ends up"), never "Data flow" — see `drawing-rules.md` "Naming the diagram (`title`)".

Self-check: `check_diagram.py --kind custom --type dataflow`. Never report success on a run that did not print `OK`.
