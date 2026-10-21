# Draw the C1 (system context) diagram — short rules

You write ONE JSON file the Code Atlas canvas renders. These rules are complete: do not read other
skill files. Bridge: `{BRIDGE}` · workspace id: `{WORKSPACE}` · repository root: `{REPO_ROOT}`.

C1 is a true C4 **system context** view: one box for the whole project, the actors around it, and
arrows between them. Nothing is decomposed — no `parent`, no `path`, no `node_id`.

## Steps

1. **Context — read the "Pre-gathered context" section at the end of this prompt first (components picked from the architecture map); then, in one parallel batch of tool calls:**
   - `curl -s {BRIDGE}/repos/{WORKSPACE}/context-digest` — who the system serves and what it integrates with (primary source).
   - `curl -s {BRIDGE}/repos/{WORKSPACE}/wiki-general-context` — read only `root` (the system narrative) if `has_wiki_general` is true; ignore `containers[]`.
   - Look for a human context doc: `docs/c1-diagram.md`, `docs/architecture/*context*.md`. Treat anything marked target/aspirational as not current.
2. **Decide the actors.** Include one only when the digest (or a spot-check:
   `curl -s '{BRIDGE}/repos/{WORKSPACE}/dependency-digest?path=<file>'`) backs it. Do not invent integrations.
3. **Write** the JSON (shape below) to `{OUTPUT_PATH}` (create the folder if missing). Overwrite whatever is there; never copy a top-level `"draft": true`.
4. **Self-check:** `{CHECK_COMMAND}` — read the whole report, fix every finding in one edit, rerun once. Never report success without `OK`.
5. Tell the user the path you wrote and how many actors you found.

## Shape

```json
{
  "type": "c1",
  "style": "boxes-arrows",
  "nodes": [
    {"id": "system", "name": "Short project name", "description": "What the system is and who it serves.", "kind": "system"},
    {"id": "end-user", "name": "End user", "kind": "person", "description": "How this role uses the system."},
    {"id": "anthropic-api", "name": "Anthropic API", "kind": "external_system", "icon": "anthropic",
     "description": "What the system uses it for.", "meta": {"technology": "HTTPS/REST"}}
  ],
  "relations": [
    {"from": "end-user", "to": "system", "label": "Browses architecture"},
    {"from": "system", "to": "anthropic-api", "label": "Requests summaries via HTTPS"}
  ]
}
```

## Rules

- Exactly one node `id: "system"`, no `parent`. Every other node is an actor: `kind: "person"` (a human role the system serves — not the engineers who maintain it) or `kind: "external_system"` (a separately deployed system the project only calls: third-party API, database, queue, another service).
- Test for `external_system`: would it deploy separately AND does the project only call it? A backend the project configures and starts itself (an adapter/driver that launches an engine) is internal, not an actor.
- Every actor needs at least one relation to or from `"system"` (`ORPHAN`/`ISLAND` otherwise). Direction = who initiates. One relation per actor is usually enough. Labels: short verb phrases, ≤ 50 chars.
- Ids: short kebab-case, unique. Every node has a one-sentence `description`; names ≤ 40 chars.
- `icon` only from: anthropic, claude, openai, gemini, postgresql, mysql, mongodb, redis, sqlite, docker, kubernetes, github, gitlab, stripe, sentry, vercel, cloudflare, prometheus, grafana — and only when the box really is that product. `kind` for a glyph is optional (api, ui, service, database, queue, cache, worker, auth).
- Optional per-box `style` may use only `color`, `background`, `border-color`, `border-style`.

## Self-check codes

| Code | Fix |
|---|---|
| `DUPLICATE` / `DANGLING` / `SELF` | rename the id / fix or drop the arrow / drop the self-arrow |
| `ORPHAN` / `ISLAND` | wire the actor to `system`, or drop it |
| `CROWDED` / `EDGEBOMB` | too many boxes or arrows: drop the minor ones |
