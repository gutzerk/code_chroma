# type: patterns — the design-patterns diagram

Read `references/drawing-rules.md` first — bridge contract, path honesty, density budgets, the
per-box and per-arrow `style` rule, arrow labels and the self-check contract live there and are not
repeated here.

Write the project's Design Patterns diagram: real classes clustered by the pattern they play a role
in, wired together — including the plain infrastructure and external systems that make the diagram
read as one connected system, not a handful of isolated shapes.

**A free heuristic pass has already run** (`src/codechroma/patterns/detector.py`) and its output is
your seed list, not your ceiling. It finds *candidates* using seven fixed structural rules (e.g.
"has 'adapter' in its name and wraps exactly one attribute") — real code that doesn't hit those
exact shapes produces nothing, silently. Your job is to use judgment where the heuristic can't:
confirm real matches, reject superficial ones, name instances the rules missed entirely, and — this
is the part no heuristic can do at all — decide which plain infrastructure/external boxes belong on
the canvas so the confirmed patterns connect into one coherent system instead of floating alone.

## Gather context efficiently — two endpoints, not a grep

**Follow `drawing-rules.md`'s Wiki-first fetch order first**, for the files/classes you're about to
examine — its wiki pages substitute for `patterns/context`'s per-class detail below wherever they
cover a path; see `drawing-rules.md` for the full substitution/fallback rule.

**1. The structural material — classes, their shape, and how they call each other:**

```bash
curl -s http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/patterns/context
```

Returns `{"classes": [...], "heuristic_candidates": [...]}`. Each class entry carries `id` (a
symbol id you address participants by), `name`, `qualified_name`, `path`, `node_id` (null if the
class isn't in the graph — never reference it as a participant if so), `bases`, `decorators`,
`is_abstract`, `class_attrs`, `methods` (each with the extracted signals the heuristic rules use:
`calls_on_attr`, `reads_dict_attrs`, `writes_dict_attrs`, `appends_list_attrs`, `iterates_attrs`,
`sets_class_attr`, `checks_none_class_attr`), and resolved `calls`/`called_by` (real node ids this
class's dependency edges already resolved to). `heuristic_candidates` is the detector's own output,
serialized the same way `GET /patterns` returns it — read it first; it's free signal.

⚠ **An empty `called_by` is not proof nothing calls this class — two known blind spots in how call
edges get resolved:** a call made at bare module top level (e.g. `_client = SomeAdapter()` sitting
outside any function — common in an `__init__.py` or a services-registry module) never becomes a
graph edge at all; and a call through an instance attribute (`self._client.do_thing(...)`) resolves
by its bare rightmost name (`do_thing`), which only becomes an edge if that exact name is *also* a
top-level class/function name somewhere reachable — so most attribute/method calls resolve to
nothing. Before concluding a class has no real caller (and therefore belongs on the diagram only
connected to what it wraps), skim the likely entrypoint/startup/service-registry file yourself —
`dependency-digest` or just reading the file — rather than trusting an empty `called_by` list.

**2. Real repo paths, for any infra/external node you add that should link to real code:**

```bash
curl -s 'http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/structure?depth=2'
curl -s 'http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/structure?root=dir::src&depth=2'
```

Copy `path`/`node_id` verbatim from `patterns/context` (for classes) or `structure` (for
directories/files) — see "Path honesty" in `drawing-rules.md`.

**Optional third source — function-level call detail.** `patterns/context`'s per-class `calls`/
`called_by` only cover classes; when you need caller-side evidence for a specific method (e.g.
confirming a Facade's callers, or checking a non-candidate class's real usage beyond what
`heuristic_candidates` already seeded), fetch just that file:

```bash
curl -s 'http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/dependency-digest?path=src/codechroma/patterns/detector.py'
```

Don't fetch the whole digest by default — it's for spot-checks, not part of the standard two-call flow.

## Where the file goes

```bash
curl -s http://localhost:8000/repos/${CODECHROMA_WORKSPACE_ID:-default}/patterns-path
# -> {"repo_root":"/abs/path/to/repo","patterns_path":"/abs/path/to/repo/.codechroma/diagrams/patterns/patterns.json"}
```

Write the JSON to the returned `patterns_path`. Fallback order and the live-update note: see
`drawing-rules.md`.

## Schema

Same shared shape as every type (`drawing-rules.md`), with `type: "patterns"`. There is no separate
`patterns[]`/`unconfirmed[]`/`participants[]` — a pattern instance and its participants are just flat
`nodes[]` entries, linked by `parent`, and every relation (instance-internal or cross-cluster) lives
in one top-level `relations[]`:

```json
{
  "type": "patterns",
  "generated_at": "2026-01-01T00:00:00Z",
  "nodes": [
    {
      "id": "strategy::discount_strategy", "name": "Strategy — discount dispatch",
      "description": "One sentence: the real problem this instance solves in this codebase.",
      "kind": "pattern-instance",
      "meta": { "type": "strategy", "confirmed": true, "confidence": 0.85 }
    },
    { "id": "class::discount_strategy", "parent": "strategy::discount_strategy", "name": "DiscountStrategy", "node_id": "class::discount_strategy", "path": "billing/discounts.py", "description": "The shared interface every discount strategy implements.", "meta": { "role": "interface" } },
    { "id": "class::percent_discount", "parent": "strategy::discount_strategy", "name": "PercentDiscount", "node_id": "class::percent_discount", "path": "billing/discounts.py", "description": "Knocks a flat percentage off the order total.", "meta": { "role": "implementation" } },
    { "id": "infra::api-app", "name": "API App", "path": "src/main.py", "node_id": "component::src/main.py", "kind": "infra", "description": "Entry point — wires routers." },
    { "id": "infra::logging", "name": "Logging System", "path": "src/logging/logging.py", "node_id": "src/logging/logging.py::class::setup_logging", "node_ids": ["src/logging/logging.py::class::setup_logging", "src/logging/logging.py::class::LogRecord"], "kind": "infra", "description": "Structured JSON logging; two real classes merged for readability." },
    { "id": "ext::postgres", "name": "PostgreSQL Database", "kind": "external", "description": "Where confirmed data ends up." }
  ],
  "relations": [
    { "from": "class::percent_discount", "to": "class::discount_strategy", "kind": "implements" },
    { "from": "infra::api-app", "to": "class::guardrails_facade", "kind": "uses", "label": "Routes via routers" },
    { "from": "class::postgres_adapter", "to": "ext::postgres", "kind": "uses", "label": "Connects" }
  ]
}
```

Rules:
- **A pattern instance** — `kind: "pattern-instance"`, `meta: {type, confirmed, confidence}`.
  `type` is one of `strategy`/`facade`/`adapter`/`registry`/`singleton`/`observer`/`repository`; a
  participant's `meta.role` reuses the existing `PatternRole` vocabulary, and a relation's `kind`
  reuses `PatternRelationKind` — don't invent new values. `meta.confirmed: true` → renders solid; a
  heuristic candidate never yet reviewed (`meta.confirmed` absent/`null`) renders dashed with a
  Confirm prompt; `meta.confirmed: false` (rejected) never renders at all — see "Rejecting a
  candidate" below.
- **A participant** — `parent` set to its instance's own `id`, plus `node_id`/`path` copied verbatim
  from `patterns/context`; never invent a class that doesn't exist. **Give every participant its own
  short `description`, not just the instance.** The heuristic never sets one (only your pass does),
  and the box otherwise renders with only a name — one clause on the *role this specific class plays*
  ("Knocks a flat percentage off the order total."), distinct from the instance's own `description`
  (the pattern's problem as a whole). The canvas keeps whatever you write here across reruns (merged
  back in by id), so a class you don't revisit doesn't lose its note.
- **Optional `style` on a participant or free-standing node** — see `drawing-rules.md`. Use it to
  flag a risky class, or to mute a collapsed "integration" background box.
- **A free-standing connective node** — `kind: "infra"` or `kind: "external"`, no `parent` — **this
  is what makes the diagram read as one system, not isolated shapes.** A plain box that isn't itself
  a detected pattern instance but is needed to connect them: an entry point, a router layer, a
  database, an external SDK, a config/startup module. `"infra"` is real code in this repo (set
  `node_id`/`path` when you have a real one); `"external"` is a system this repo talks to but doesn't
  contain (no `node_id`). Any other `kind` on a free-standing node is dropped as `unknown_kind` — only
  these two are recognized. Only add one the context (`patterns/context`/`structure`) actually gives
  evidence for; don't invent integrations to fill space.
- **Merging near-identical siblings for readability is expected, not a fudge** — if several classes
  are the same shape and none is individually pattern-relevant (e.g. six near-identical route
  handler files), represent them as **one** free-standing node with a `description` naming what it
  collapses ("6 endpoints — guardrails, projects, associations, ..."), rather than six disconnected
  boxes that add noise without adding a pattern. Never merge a class that IS a pattern participant —
  only plain connective tissue.
  When a merged (or otherwise infra) box maps to several *real* classes, also write those classes'
  real `node_id`s into `node_ids[]` on the same entry — the canvas opens a box's `node_ids` as one
  tap per class in the code inspector, so a single box lets the user read every class it collapses.
  `node_id` stays the box's primary/fallback id; `node_ids` is the full click-through list. Copy every
  id verbatim from `patterns/context`/`structure`; don't guess.
- **A participant referenced by more than one pattern instance, but never "owned" by any of
  them, stays a free-standing node — never force it into one cluster.** E.g. an external SDK wrapped
  by two different Adapters, or extended by a Strategy implementation: put it in `nodes[]` (kind
  `"external"` or `"infra"`, no `parent`) and let each instance's relation point to it by id. The
  canvas clusters by `parent` automatically; don't try to pick a "primary" pattern for it yourself.
- `relations[]` — every edge, instance-internal or cross-cluster: what connects two participants of
  the same instance, a free-standing node to a participant, or two instances to each other. Direction
  is who initiates. A self-relation (a class calling itself) is allowed, unlike most other types.
- **Every id must be unique across the whole file** — an instance, a participant, and a free-standing
  node all share one namespace, since relations address any of them by bare id.
- Don't restate a class's own `bases`/inheritance as a relation if it's already implied by an
  `implements`/`extends` participant relation inside the owning instance — that would double the
  arrow.
- `meta.order`/`meta.lane` (`drawing-rules.md`) are almost never needed here — patterns is a class
  graph, not a process, so there's no "after" or "who performs this step" to record.

## Procedure

1. Resolve `patterns_path` from the bridge.
2. Fetch `patterns/context`. For each `heuristic_candidates[]` entry: read its participants' real
   shape (bases/decorators/methods/calls) and judge whether it's a **real** instance of its claimed
   pattern, not just a superficial shape match. Give a confirmed one a short descriptive name and a
   one-sentence real-world description — and give **each of its participants** their own short
   `description` too (its specific role, not a repeat of the instance's).
   **Rejecting a candidate is not the end of the step — read the repo to finish the thought.** The
   canvas never shows a rejected node (`meta.confirmed: false` is bridge-internal, so a future run
   doesn't re-litigate the same candidate), so leaving one there and moving on produces a silent gap,
   not a finished picture. Before rejecting: is it the *wrong* pattern type / missing a real
   counterpart the heuristic didn't wire up (open the file, follow its `calls`/`bases`, and author the
   real instance under its correct type instead)? Only write `meta.confirmed: false` once you've made
   that call — never as a placeholder for "I'll decide later."
   🔴 **Never omit a `heuristic_candidates[]` id entirely.** The detector re-emits every one of its
   own candidates as unconfirmed on *every* call, regardless of what the file says — the only way to
   silence one for good is an explicit node addressing its id with `meta.confirmed: true` or
   `meta.confirmed: false`. Simply not writing it anywhere (e.g. because its sole participant turned
   out to be a test double or dead code) looks identical to never having reviewed it: the diagram
   re-shows it as unconfirmed on the very next load, however many times the user clicks Confirm.
   "Drop it" applies to a *participant inside an instance you're still authoring* — never to the whole
   candidate; the candidate itself always gets one of the two explicit outcomes.
3. Look for real instances the heuristics missed — the same seven types, same participant/relation
   vocabulary, but not limited to the detector's exact structural triggers. Only add one you can back
   with real `calls`/`bases`/`methods` evidence from `patterns/context`. Same rule applies: a short
   `description` on every participant you author, not just the instance.
4. Decide the free-standing connective nodes — entry points, routing/service layers, databases,
   external SDKs — needed so every confirmed instance is **reachable from the rest of the diagram**,
   not just wired to *something*. "Isolated" doesn't mean zero relations — it means the cluster's
   relations only reach each other, never the rest of the picture. An Adapter or Repository that
   relates only to the external system it wraps (e.g. `class::s3_model_client --uses--> ext::s3`, and
   nothing else) is exactly as isolated as a node with no relations at all: the external target is a
   dead end unless something on the canvas also shows who in the app calls the Adapter. Before
   treating a pattern instance as finished, ask "what in this repo actually constructs or calls this?"
   and put that caller on the diagram too — see the `calls`/`called_by` blind-spot callout above for
   why an empty `called_by` is not proof nothing calls it. Merge near-identical plain siblings into
   one node (see "Merging" above).
5. Wire `relations[]`: the call chain between clusters and nodes, plus any cross-cluster edge (a
   class playing a role in two instances). Direction is who initiates.
6. Write the file.
7. **Self-check — never report success on a run that didn't print `OK`:**

   ```bash
   python3 .claude/skills/codechroma-draw-diagram/scripts/check_diagram.py --kind patterns
   ```

   Common codes (`drawing-rules.md`) apply — `ISLAND` here most often means the real caller of an
   Adapter/Repository is missing, not just the external system it wraps (see step 4 above). Two codes
   are patterns-only:

   | Code | Means | Fix |
   |---|---|---|
   | `SPARSE <n> node(s) for <m> classes` | the diagram covers only a sliver of the classes `patterns/context` offered | this is the "just a few blocks" failure — go back to step 3/4, don't stop at the first confirmed match |
   | `UNREVIEWED <id>` | a `heuristic_candidates[]` id has no node anywhere in the file, so it still resolves as unconfirmed | address it explicitly: a node with `meta.confirmed: true`, or one with `meta.confirmed: false` — never leave it unaddressed, or it comes back next run no matter how many times the user clicks Confirm |

   Exit tiers and the `--shape-advisory` rule: see `drawing-rules.md`.
