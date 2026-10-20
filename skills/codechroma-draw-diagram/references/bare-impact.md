# Draw the Impact diagram — short rules

You write ONE JSON file the Code Atlas canvas renders. These rules are complete: do not read other
skill files. Bridge: `{BRIDGE}` · workspace id: `{WORKSPACE}` · repository root: `{REPO_ROOT}`.

The boxes a change (git diff) or a plan (feature spec) touches, plus the one-hop neighbours that
matter, with unchanged background collapsed. The bridge already computed the slice; you add judgment.
The task line says which source: `diff`, or `plan` with a feature directory.

## Steps

1. **Context (the only call you need):**
   `curl -s '{BRIDGE}/repos/{WORKSPACE}/impact/context?source=diff'` — or, for a plan,
   `curl -s '{BRIDGE}/repos/{WORKSPACE}/impact/context?source=plan&feature=<feature dir>'`.
   It returns `nodes` (`id`, `name`, `node_id`, `seed`, `path`, `level`, `reason`, `anchors`), `relations`, `seed_count`, `node_count`, `fingerprint`.
2. **Decide the final boxes:**
   - Merge seeds from one source file into ONE box with id/`node_id` `component::<file path>`, `seed: true`, description like `"3 functions changed"`. `component::` is for one real file only; several files in one package → `dir::<package path>`.
   - A seed at file/dir level, or one symbol that carries the story, keeps its real `node_id`.
   - Keep one-hop neighbours that tell the story (a caller you can name) as real boxes; fold the rest into a few collapsed context boxes whose `node_id` is the closest real ancestor (`dir::…`), `seed: false`, description "unchanged background".
   - Every box must connect (`ORPHAN`/`ISLAND` otherwise); keep the edges the slice spells between kept boxes.
3. **Give every box `meta.status`** (`new`/`modified`/`deleted`/`context`):
   - diff: read the seed's `reason`: `added` → `new`, `modified` → `modified`, `deleted` → `deleted`. A merged box is `deleted` only if every merged change was a delete, else `new` only if every one was an add, else `modified`. Never guess past `reason`.
   - plan: judge from the spec — creates the entity → `new`, changes an existing one → `modified`, removes it → `deleted`.
   - unchanged neighbours and collapsed background → `context`.
4. **Wire `relations[]`** between kept boxes (caller `from` → callee `to`); short `label` on the arrows that carry the story; mark at most 1–2 relations `hero: true` (3+ trips `TOOMANYHERO`).
5. **Write** the JSON to `{OUTPUT_PATH}` (create the folder if missing); overwrite whatever is there. Copy `fingerprint` from the context.
6. **Self-check:** `{CHECK_COMMAND}` (add `--source=plan --feature=<dir>` for a plan) — read the whole report, fix every finding in one edit, rerun once. Never report success without `OK`.

## Shape

```json
{
  "type": "impact",
  "generated_at": "<ISO time>",
  "source": "diff",
  "feature": "<feature dir; plan only, else omit>",
  "fingerprint": "<verbatim from impact/context>",
  "nodes": [
    {"id": "component::server/api/handlers.go", "name": "handlers.go", "node_id": "component::server/api/handlers.go",
     "seed": true, "description": "2 functions changed: accept DeployTargetRef.", "meta": {"status": "modified"}},
    {"id": "collapsed::auth", "name": "Auth (unchanged)", "node_id": "dir::server/auth", "seed": false,
     "description": "Unchanged background the change passes through.", "meta": {"status": "context"}}
  ],
  "relations": [
    {"from": "component::server/api/handlers.go", "to": "collapsed::auth", "label": "authorizes via", "hero": true}
  ]
}
```

## Rules

- 🔴 `node_id` is required on every node; copy `id`/`node_id` from the context verbatim (or use the `component::`/`dir::` forms above). Never invent one. Ids unique.
- Budget is tight: ≤ 25 nodes, ≤ 40 relations — a big impact diagram means you dumped the repo.
- Every box has a one-sentence `description`; names ≤ 40 chars; labels ≤ 40 chars.
- `style` (optional) may use only `color`, `background`, `border-color`, `border-style` — e.g. to flag a fragile caller.
- `SHAREDNODE` does not apply here (boxes are file-level by design).

## Self-check codes

| Code | Fix |
|---|---|
| `BROKEN <id>` | copy `node_id` verbatim from the context (a `component::` id built from a directory must be `dir::`) |
| `DUPLICATE` / `DANGLING` / `SELF` | rename / fix or drop the arrow / drop it |
| `ORPHAN` / `ISLAND` | connect the box or drop it |
| `TOOMANYHERO` | keep 1–2 `hero` relations |
