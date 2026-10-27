# type: system-context — the system, its people and what it talks to

Read `references/drawing-rules.md` first — bridge contract, path honesty, density budgets, arrow labels and the self-check contract live there and are not repeated here.

A system-context diagram shows **the system as one boundary, the people who use it and the external systems it depends on or serves**, with a labelled relationship for each. `c1` is one form of it (the system decomposed into layers of sub-blocks down to real code, see `references/type-c1.md`). Use this type when the user wants the **context only**, or a context view for something that is not this repo's own layered build: a product, a service landscape, a subsystem, a planned system. It is a saved `custom` type with id `system-context`.

## Pick c1 or this

| The request is for… | Draw |
|---|---|
| the repo's system decomposed layer by layer into real code | `c1` |
| "system context", "who uses this and what does it integrate with", a landscape view, a single subsystem or product, a context view with no internal breakdown | `system-context` (this file) |

## Save the type once

`GET /diagram-types/system-context`. On a 404 save it, then continue with `references/type-custom.md` for the path, schema and self-check:

```bash
curl -s -X PUT ${CODECHROMA_BRIDGE_URL:-http://localhost:8000}/diagram-types/system-context -H 'Content-Type: application/json' -d '{
  "title": "System context",
  "description": "The system, its users and the external systems around it.",
  "style": "boxes-arrows",
  "layout": {"direction": "TB"},
  "grouping": {"enabled": true, "label": "Kind"},
  "relation_kinds": [
    {"id": "uses", "label": "uses"}, {"id": "calls", "label": "calls"},
    {"id": "sends", "label": "sends to"}, {"id": "reads", "label": "reads from"}
  ],
  "context_sources": ["structure", "dependency-digest"],
  "instructions": "Draw the system context. Exactly one box is the system under description (group System), described in one sentence of what it does for its users. Around it draw every PERSON or role that uses it (group People) and every EXTERNAL system it calls, is called by, or stores data in (group External). Find external systems from real evidence: SDK and HTTP client imports, config and env vars, database drivers, webhooks. Every relationship is one arrow from the initiator, labelled with what passes or why (sends invoices, authenticates users), never a bare verb. Do not decompose the system into internal components; one box per person or external system; merge duplicates. Keep it under 12 boxes."
}'
```

## What to draw

1. One `System` box (`path` null, or the repo root if it is this repo), two groups around it: `People` and `External`.
2. External systems only from evidence in the code or config; name the real product (Stripe, Postgres), not the SDK file.
3. Each arrow starts at whoever initiates it and has a payload label.
4. Set the top-level `question` ("Who and what does X talk to?") and 1–2 `hero` relations: the most important user and the most important dependency.

Self-check: `check_diagram.py --kind custom --type system-context`. Never report success on a run that did not print `OK`.
