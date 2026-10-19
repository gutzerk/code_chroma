# type: sequence — the ordered-call (UML sequence) diagram

Read `references/drawing-rules.md` first — bridge contract, path honesty, density budgets, the
per-box and per-arrow `style` rule and the self-check contract live there and are not repeated here.

Write a Sequence diagram: the participants (the systems/classes that take part in one flow) arranged
left-to-right across the top, and the messages between them drawn top-to-bottom in time order —
**the one diagram type where a `relations[]` entry becomes a dedicated message element, not an edge.**
The canvas lays it out for you from `meta`; you don't place or size anything.

## ⚠ The core difference from every other type

Every other type's `relations[]` become arrow *edges*. For `sequence`, they become **message
elements**: the renderer (`SequenceDiagram.tsx`) reconstructs the visual from the message's own
`meta`, so a message must carry everything needed to place it — the `order` (its time row), the
`from`/`to` participant ids, and whether it is a return/async arrow. **Give every message a unique
`id`** the same as any node, and **never author a message without ordering it** (`order`).

## Gather context — the recorded-call scaffold, then fill the gaps

**Follow `drawing-rules.md`'s Wiki-first fetch order first** (Steps 0/1) for narrative about the flow
you're drawing.

**3. The ordered call scaffold — a real recorded run, if one exists:**

```bash
curl -s http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/sequence/context
```

Returns the recorded-execution scaffold from `GET /repos/{id}/traces` when a trace exists:
`{"traces": [...]}` (list of recorded run summaries), and when selecting the most recent one,
`{"trace": {...}, "participants": [{id, name, node_id}, ...], "messages": [{order, from_idx, to_idx,
from, to, args}, ...]}`. Each `message` is a distinct direct caller→callee hop the real run observed,
collapsed to distinct symbol pairs so the scaffold stays readable rather than one giant loop. This is
your **template** — the machine-recorded truth of which systems call which.

- **`traces` is empty** (no recorded run): author the sequence from `structure`/`dependency-digest`
  and your judgement of the flow, same as any other type — the scaffold is a convenience, not a
  requirement.
- The scaffold's `participants` are the real graph `node_id`s (copy `from`/`to`/`node_id` verbatim —
  path honesty). The scaffold only shows **direct call hops between distinct symbols**; `return`
  events are dropped, and nested/self-calls are collapsed. **Your job** is the judgment the recording
  can't give: group the steps into one readable flow, label each message, add the return arrows that
  make the story complete, and surface any entries the recording's blind spots hid (calls at module
  top level, attribute-method calls that resolved to nothing — see `type-patterns.md`'s identical
  `called_by` blind-spot note).

**4. Real repo paths, for any participant you add that should link to real code** (same as patterns):
`/structure?depth=2` / `dependency-digest?path=<file>`, copying `path`/`node_id` verbatim.

## Where the file goes

```bash
curl -s http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/sequence-path
# -> {"repo_root":"/abs/path/to/repo","sequence_path":"/abs/path/to/repo/.codechroma/diagrams/sequence/sequence.json"}
```

Write the JSON to the returned `sequence_path`. Fallback order and the live-update note: see
`drawing-rules.md`.

## Schema

The one shared flat shape (`drawing-rules.md`), with `type: "sequence"`. Participants are `nodes[]`
(KEPT as elements), messages are `relations[]` (become dedicated message elements — never ordinary
edges):

```json
{
  "type": "sequence",
  "generated_at": "2026-01-01T00:00:00Z",
  "nodes": [
    { "id": "client", "name": "Client", "node_id": "component::web/app.ts",
      "description": "The browser app that starts the checkout." },
    { "id": "api", "name": "API", "node_id": "component::src/api/main.py",
      "description": "The HTTP entry point." },
    { "id": "db", "name": "DB", "node_id": "component::src/db/pg.py",
      "description": "The PostgreSQL store." }
  ],
  "relations": [
    { "id": "m1", "from": "client", "to": "api", "kind": "call", "order": "1",
      "label": "POST /checkout" },
    { "id": "m2", "from": "api", "to": "db", "kind": "call", "order": "2",
      "label": "SELECT orders" },
    { "id": "m3", "from": "api", "to": "client", "kind": "return", "order": "3",
      "label": "200 OK", "return": true }
  ]
}
```

Rules:
- **`nodes[]` are participants** — `id` unique, `name`, `node_id`/`path` copied verbatim from
  `sequence/context` or `structure`, a real one-sentence `description`. Every participant ought to
  take part in at least one message — a participant that only ever appears on the canvas and never
  sends/receives is an `ORPHAN` you should wire or drop.
- **`relations[]` are messages**, each with its own **unique `id`** (a message is an element now, so
  it needs a file-unique id like any node). Fields:
  - `from`/`to` — the participant `id`s (the caller and callee). Direction is who initiates; don't
    author a reverse "response travelling back" arrow as a second call — that's what `return` is for.
  - `order` — **a string** step number recording this message's place in time (`"1"`, `"2"`, `"2a"`/
    `"2b"` for two messages at once — note `"a"`/`"b"` are fine and sort before the next whole digit).
    This is what the renderer reads to place the row; **never omit it.**
  - `label` — a short verb phrase naming the call (`"POST /checkout"`, `"SELECT orders"`), rendered on
    the arrow.
  - `async` (`true`) — an asynchronous (dashed) arrow: the caller fires and doesn't wait.
  - `return` (`true`) — a return/response arrow back to the original caller (drawn leftward). The
    reverse of a `call`. Don't forget the returns that close the story — a flow with only outgoing
    calls reads half-drawn.
  - `description` — the **request's detail**, shown in the popup when the user clicks the message
    (the same description popup a box's "?" button opens). Put the concrete payload/signature of the
    call here — for an HTTP message, the method, path and request body/shape (`"POST /checkout with
    {cartId, items[], total — the browser sends the cart to charge.")`); for a function call, the
    arguments and return. Keep it one or two lines of real detail, not a repeat of the label. A
    message with no authored `description` still opens the popup, but only shows the label — so give
    the messages that carry the story a real one.
- **Do not** author extra plain `nodes[]` connective boxes to "connect" participants the way patterns
  adds infra/external boxes — a sequence is a single flow; a participant that doesn't take part has
  no reason to be on the canvas, and there is no cross-cluster wiring.
- **Self-calls**: a participant calling itself is allowed (`SELF` is exempt for `sequence` because
  recursion/self-messaging is real in a flow).
- Every message connects two participants that both exist — the resolver drops a message whose
  `from`/`to` matches no participant, and has no room to invent one.

## Procedure

1. Resolve `sequence_path` from the bridge.
2. Fetch `sequence/context`. If a trace exists, use its `participants`/`messages` as the skeleton —
   copy the participant `node_id`s verbatim, keep the message order. If not, derive the flow from
   `structure`/`dependency-digest`.
3. Reduce the scaffold to ONE readable flow: merge the trace's hot-loop repetitions into single
   messages, drop symbols that only churn, keep the calls that tell the story. A sequence diagram is
   a *judgment of a flow*, not a dump of every recorded step.

**⚠ Guard — do not overwrite an existing sequence silently** (drawing-rules.md's shared rule):
   before writing `sequence_path`, `ls -la` that exact file. If it exists this is a *replacement* of
   the sequence layer already on the canvas. Unless the request was to redraw/update it, **stop and ask
   the user** whether to replace; never let "draw a diagram" clobber a diagram that's already there.
   Mention the replacement explicitly in your final report either way.

4. Author `nodes[]` (participants) with real descriptions. Author `relations[]` (messages) with
   `order` numbering top-to-bottom, `label`s, and `return`/`async` flags where they belong. Add any
   participant/message the recording missed but you can back with real code.
5. Write the file.
6. **Self-check — never report success on a run that didn't print `OK`:**

   ```bash
   python3 .claude/skills/codechroma-draw-diagram/scripts/check_diagram.py --kind sequence
   ```

   Common codes (`drawing-rules.md`) apply; the ones most likely here:
   `ORPHAN <id>` (a participant with no message), `DANGLING <pair>` (`from`/`to` names no
   participant), `DUPLICATE <id>` (two messages sharing an id — each message needs its own),
   `UNLABELED` (too many messages with no `label`).

   Exit tiers and the `--shape-advisory` rule: see `drawing-rules.md`.
