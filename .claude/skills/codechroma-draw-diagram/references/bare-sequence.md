# Draw a Sequence diagram — short rules

You write ONE JSON file the Code Atlas canvas renders. These rules are complete: do not read other
skill files. Bridge: `{BRIDGE}` · workspace id: `{WORKSPACE}` · repository root: `{REPO_ROOT}`.

Participants (the systems/classes in one flow) left-to-right, messages top-to-bottom in time order.
Unlike every other type, each `relations[]` entry becomes a **message element**, so every message
needs its own unique `id` and an `order`.

## Steps

1. **Context, one parallel batch:**
   - `curl -s {BRIDGE}/repos/{WORKSPACE}/sequence/context` — a recorded run, when one exists: `participants` (`id`, `name`, `node_id`) and `messages` (`order`, `from`, `to`, `args`). Use it as the skeleton and copy participant `node_id`s verbatim. `traces: []` means no recording: derive the flow from the next two sources.
   - `curl -s '{BRIDGE}/repos/{WORKSPACE}/structure?depth=2'` — real paths (copy `path`/`node_id` verbatim).
   - `curl -s '{BRIDGE}/repos/{WORKSPACE}/wiki-general-context'` — narrative for the flow.
2. **Reduce to ONE readable flow:** merge hot-loop repetitions into single messages, drop symbols that only churn, keep the calls that tell the story. Add what the recording's blind spots hid (module-level calls, attribute-method calls) only with real code evidence.
3. **Author** participants and messages, then **write** the JSON to `{OUTPUT_PATH}` (create the folder if missing); overwrite whatever is there.
4. **Self-check:** `{CHECK_COMMAND}` — read the whole report, fix every finding in one edit, rerun once. Never report success without `OK`.

## Shape

```json
{
  "type": "sequence",
  "generated_at": "<ISO time>",
  "nodes": [
    {"id": "client", "name": "Client", "node_id": "component::web/app.ts", "description": "The browser app that starts checkout."},
    {"id": "api", "name": "API", "node_id": "component::src/api/main.py", "description": "The HTTP entry point."}
  ],
  "relations": [
    {"id": "m1", "from": "client", "to": "api", "kind": "call", "order": "1", "label": "POST /checkout",
     "description": "POST /checkout with {cartId, items[], total}."},
    {"id": "m2", "from": "api", "to": "client", "kind": "return", "order": "2", "label": "200 OK", "return": true}
  ]
}
```

## Rules

- Participants: unique `id`, `name`, `node_id`/`path` verbatim from the context, a one-sentence `description`. Every participant takes part in at least one message; no extra connective boxes.
- Messages: unique `id`; `from`/`to` are participant ids (the caller initiates — a response is a `return` message, not a second call); `order` is a STRING (`"1"`, `"2"`, `"2a"`/`"2b"` for simultaneous) and is never omitted; `label` a short verb phrase; `async: true` for a fire-and-forget (dashed) arrow; `return: true` for the response arrow back to the caller (add the returns that close the story); `description` the concrete payload or signature on the messages that carry the story.
- Self-calls are allowed.
- Budget: ≤ 24 participants, ≤ 60 messages; names ≤ 40 chars; labels ≤ 60 chars.

## Self-check codes

| Code | Fix |
|---|---|
| `ORPHAN <id>` | a participant with no message: wire it or drop it |
| `DANGLING <pair>` | `from`/`to` names no participant: fix the id |
| `DUPLICATE <id>` | two messages share an id: rename |
| `UNLABELED` | too many messages without a `label` |
| `BROKEN <id>` | copy `path`/`node_id` verbatim, or set both to null |
