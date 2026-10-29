# Draw a process diagram (short rules)

You draw ONE flat process diagram — a request or job moving through several parties — as a JSON file
the Code Atlas canvas renders. These rules are complete: do not read other skill files or wiki pages.

## Steps

1. **Phrases.** Turn the request into 2–4 search phrases of 1–3 words: the subject terms a component
   description would contain. Drop "make a diagram", "show", "how", generic verbs.
   Example: "how end clients calling the /v1 gateway with a key are authorized" →
   `"/v1 gateway" "client key" "authorized"`.
2. **Context — one call.** Run, from the repository root:
   `{CONTEXT_TOOL} "<phrase>" "<phrase>" ...`
   It prints the relevant components: best text matches (with description, files and symbols),
   supporting components linked through imports, and the import links between them. Not every listed
   component belongs on the diagram — pick what the process uses.
3. **Order comes from the context.** Each function line lists its source lines and the calls it makes
   in code order. Build the step order and the branches (`Error401…`, `Error409…`) from those lines.
   Do not read source files: every `node_id` is `<path>::function::<name>` from the context, verbatim.
4. **Write the JSON** (shape below) to the path you were given.
5. **Self-check**, from the repository root:
   `{CHECK_COMMAND}`
   Read the whole report, fix every finding in one edit, rerun once. Never report success without `OK`.

## JSON shape

```json
{
  "type_id": "{TYPE_ID}",
  "style": "{STYLE}",
  "generated_at": "<ISO time>",
  "nodes": [
    {"id": "authorize", "name": "Check bearer key", "description": "One sentence: what this step does.",
     "kind": "auth", "path": "gateway-orchestration/internal/gateway/auth.go",
     "node_id": "gateway-orchestration/internal/gateway/auth.go::function::authorize",
     "meta": {"order": "3", "lane": "Gateway"}},
    {"id": "reject", "name": "401 Unauthorized", "description": "Generic rejection on a key mismatch.",
     "node_id": null, "path": null, "style": {"border-color": "var(--danger)"},
     "meta": {"order": "4b", "lane": "Gateway", "no_code_reason": "conceptual"}}
  ],
  "relations": [
    {"from": "authorize", "to": "reject", "kind": "calls", "label": "key mismatch"}
  ]
}
```

## Rules

- Edge `kind` on `relations[]`: `calls` (default), `spawns` (starts a process/CLI/agent), `data` (reads/writes a file/DB/store), `minor` (optional) -- use `spawns`/`data` whenever true, e.g. `{"from":"api","to":"db","kind":"data","label":"saves run"}`.
- **Size:** aim for 8–15 boxes. Over 15 the self-check prints `SPLIT`; cut detail instead.
- **Process order:** every step box gets `meta.order` ("1", "2", "3a"/"3b" for parallel or
  alternative branches) and `meta.lane` (who performs it: a service, a component, "Client").
  Never number steps inside an arrow label. Where numbering a box is impractical, `rank: "entry"`/
  `"exit"` pins it to the first/last layer (`order` wins when both are set); an edge with `kind`
  `"feedback"`/`"return"` lays out as a back edge.
- **Show the repo's own code on the path.** If code in this repository handles the step (a handler,
  a guard, a check), it gets a box — even when an external system (LiteLLM, a database, a cloud API)
  also does part of the work. External systems are extra boxes, never a replacement for in-repo code.
- **Setup stage + main path.** If the process only works after a setup stage — a key or token is
  issued, a client or edge is registered, a model is downloaded — draw both: the setup stage first,
  then the main path that uses its result, linked by an arrow (e.g. "issued key used in"). On the main
  path, show every check the repo's own code does, even if an external system checks again later.
- **One box per component crossed.** When a step calls into code that belongs to another component in
  the context (a different `### <component>` entry, e.g. a hardware snapshot read, a store, a client),
  give that call its own box with that component's `node_id`; don't fold it into the caller's box.
- **Branches are real:** show failure/reject paths and alternatives as their own boxes; a straight
  chain is wrong if the code branches. Style failure boxes `{"border-color": "var(--danger)"}`.
- **Code links:** `path` and `node_id` come verbatim from the context output (formats:
  `<path>::function::<name>`, `<path>::class::<name>`, `component::<path>`). Prefer the function or
  class over the file. Never invent one; if unsure, drop the code link (`node_id: null`). A box without code (client, external system, decision,
  reject) takes `node_id: null`, `path: null` and `meta.no_code_reason: "conceptual"`; an external
  system also gets `meta.external: true`.
- **One box per code location:** two boxes never share a `node_id`.
- **Names ≤ 40 chars; every box has a one-sentence `description`.**
- **Arrows:** `from` is the caller. A response is not a second arrow. Label with a short verb
  phrase (≤ 50 chars) where it carries the story (`"mints key via /key/generate"`). No self-arrows,
  no arrows to ids that don't exist, no orphan boxes.
- **`kind`** (optional icon): api, ui, service, database, queue, cache, worker, auth — only when obvious.

## Self-check codes

| Code | Fix |
|---|---|
| `BROKEN <id>` | path/node_id not in the graph: copy it verbatim or set both to null |
| `DUPLICATE` / `DANGLING` / `SELF` | rename the id / fix or drop the arrow / drop the self-arrow |
| `ORPHAN` / `ISLAND` | connect the box or drop it |
| `SHAREDNODE` | advisory: give each box its own symbol, or null |
| `CYCLES`, `ARTICULATION` | advisory: fine when the loop or the single path is real |
| `BADROUTE`, `ROUTE-*` | advisory: an optional `route` is malformed (see `type-custom.md`, "Optional `route`") |
| `SPLIT` | too many boxes: merge or drop minor steps |
