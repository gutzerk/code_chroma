# Draw the Design Patterns diagram — short rules

You write ONE JSON file the Code Atlas canvas renders. These rules are complete: do not read other
skill files. Bridge: `{BRIDGE}` · workspace id: `{WORKSPACE}` · repository root: `{REPO_ROOT}`.

Real classes clustered by the pattern they play a role in, wired together with the plain
infrastructure and external boxes that make it read as one system. A free heuristic pass already
produced candidates; they are your seed list, not your ceiling.

## Steps

1. **Context:** `curl -s {BRIDGE}/repos/{WORKSPACE}/patterns/context` → `{classes, heuristic_candidates}`. Each class has `id`, `name`, `path`, `node_id`, `bases`, `methods`, `calls`, `called_by`. Optionally one batch with `curl -s '{BRIDGE}/repos/{WORKSPACE}/structure?depth=2'` for directories and entry points, and `curl -s '{BRIDGE}/repos/{WORKSPACE}/wiki-general-context'` for narrative.
2. **Judge each `heuristic_candidates[]` entry** against the class's real shape: confirm a real instance (`meta.confirmed: true`), or reject a superficial one (`meta.confirmed: false`) only after checking whether it is a different pattern or missing its counterpart. 🔴 Never leave a candidate id out of the file — every one needs an explicit node with `confirmed` true or false, or it comes back unreviewed.
3. **Add real instances the heuristics missed** (strategy, facade, adapter, registry, singleton, observer, repository), only with `calls`/`bases`/`methods` evidence.
4. **Add connective nodes** so every instance is reachable from the rest of the picture: entry points, routers, databases, SDKs, config modules (`kind: "infra"` real code in this repo; `kind: "external"` a system outside it). An empty `called_by` is not proof nothing calls a class — module-level and attribute calls are not resolved; check the likely entrypoint file if it matters. Merge near-identical plain siblings into one node (describe what it collapses); never merge a pattern participant.
5. **Write** the JSON to `{OUTPUT_PATH}` (create the folder if missing); overwrite whatever is there.
6. **Self-check:** `{CHECK_COMMAND}` — read the whole report, fix every finding in one edit, rerun once. Never report success without `OK`.

## Shape

```json
{
  "type": "patterns",
  "generated_at": "<ISO time>",
  "nodes": [
    {"id": "strategy::discount", "name": "Strategy — discount dispatch", "kind": "pattern-instance",
     "description": "The real problem this instance solves here.", "meta": {"type": "strategy", "confirmed": true, "confidence": 0.85}},
    {"id": "class::percent_discount", "parent": "strategy::discount", "name": "PercentDiscount",
     "node_id": "<verbatim from context>", "path": "billing/discounts.py",
     "description": "The role this class plays.", "meta": {"role": "implementation"}},
    {"id": "infra::api-app", "name": "API App", "kind": "infra", "path": "src/main.py", "node_id": "<verbatim>", "description": "Entry point."},
    {"id": "ext::postgres", "name": "PostgreSQL", "kind": "external", "description": "Where data ends up."}
  ],
  "relations": [
    {"from": "class::percent_discount", "to": "class::discount_strategy", "kind": "implements"},
    {"from": "infra::api-app", "to": "class::guardrails_facade", "kind": "uses", "label": "Routes via routers"}
  ]
}
```

## Rules

- Edge `kind` on `relations[]`: `calls` (default), `spawns` (starts a process/CLI/agent), `data` (reads/writes a file/DB/store), `minor` (optional) -- use `spawns`/`data` whenever true, e.g. `{"from":"api","to":"db","kind":"data","label":"saves run"}`.
- Instances and participants are flat `nodes[]`; a participant sets `parent` to its instance's `id`. All ids share one namespace and are unique. `node_id`/`path` are copied verbatim from the context — never invented; a class with `node_id: null` is never a participant.
- Every participant gets its own one-sentence `description` (its role), distinct from the instance's. Every instance box must be an endpoint of at least one relation (`ORPHAN` otherwise).
- `meta.type`: strategy/facade/adapter/registry/singleton/observer/repository. A participant's `meta.role` and a relation's `kind` reuse the vocabulary the context uses (implements, extends, uses, …); do not invent new values.
- A class shared by several instances and owned by none stays free-standing (`infra`/`external`, no `parent`); each instance's relation points to it.
- `node_ids[]` (optional) on a merged infra box lists every real class id it collapses; `node_id` stays the primary.
- Do not restate inheritance already implied by an `implements`/`extends` relation. Self-relations are allowed. Direction = who initiates. Labels ≤ 50 chars, only where they carry the story. Names ≤ 40 chars.
- Budget: ≤ 45 nodes, ≤ 70 relations; the usual failure is too few boxes (`SPARSE`), not too many.
- Optional `style` on a box/arrow may use only `color`, `background`, `border-color`, `border-style`.

## Self-check codes

| Code | Fix |
|---|---|
| `BROKEN <id>` | copy `path`/`node_id` verbatim, or fix/delete the entry |
| `DUPLICATE` / `DANGLING` / `SELF` | rename / fix the id or drop the arrow / drop it |
| `ORPHAN` / `ISLAND` | wire it in — for an adapter or repository the missing piece is usually its real caller |
| `SPARSE` | the diagram covers a sliver of the classes: go back to steps 3–4 |
| `UNREVIEWED <id>` | a candidate id has no node: add one with `confirmed` true or false |
