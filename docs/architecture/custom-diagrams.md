# User-defined custom diagrams (011-custom-diagrams)


> ⚠ **The skill that writes this diagram is no longer its own.** `codechroma-custom-diagram` was merged
> into the one `codechroma-draw-diagram` router skill; its authoring rules now live in
> `references/type-custom.md` and its self-check is `check_diagram.py --kind custom`. See
> [`diagram-skills.md`](diagram-skills.md) for the router, the shared rules, the retire/prune
> pass, and the soft-diagnostics path this diagram's resolver now feeds.

⚠ **016-single-canvas-dashboard Stage 4 deleted only the per-repo *view* half** —
`canvas/custom/` (`CustomDiagramView.tsx` and its box/overlay chrome) and `CustomDiagramMenu.tsx` —
along with `state/customDiagramStore.ts`. A generated custom diagram's boxes now render through the
one canvas's `CanvasNodeBox`, reached via a diagram layer on the canvas document — see
`canvas/recipes.py`'s one shared `reshape()` (036-shared-diagram-style-catalog collapsed
`custom_reshape` and every other per-kind reshape into it — see [`diagram-skills.md`](diagram-skills.md))
and [`single-canvas.md`](single-canvas.md).

🔴 **The in-app interview that used to author a new library entry is retired** (diagram-management
unification, superseding the "wizard survives untouched" claim this section used to make):
`DiagramTypeWizardPanel.tsx`, `diagramWizardStore.ts`, `useDiagramTypeInterview.ts`, the five
`EngineClient` `*DiagramTypeInterview*` methods, and the backend's `codechroma-diagram-type` skill +
`diagram_type_agent.py` + its draft/interview routes (`POST /diagram-types/interview` and its
`{draft_id}` sub-routes, `GET /diagram-types-path`) are all deleted. **The library itself survives
untouched** — `GET /diagram-types`, `GET/PUT/DELETE /diagram-types/{type_id}`, `GET /diagram-styles`,
and every per-repo `/repos/{id}/custom/{type_id}...` route below — a definition just has no in-app
authoring UI anymore; it's saved by hand or by a direct API/skill `PUT`. `RecipeMenu.tsx` (the old
"Add a picture" dropdown that both listed saved types and opened the wizard via "New custom type…")
is gone too, replaced by `DrawDiagramButton.tsx` (always launches the drawing agent, no listing) plus
`AgentRail`'s Diagrams tab (which now lists every saved type's generated diagram, on canvas or not) —
see [`single-canvas.md`](single-canvas.md).

A `Custom` rail entry that renders a diagram type **the user describes once, in plain language, and
reuses across every repo** — unlike C1 and Patterns, which are hardcoded diagram types (their own
Python module set, skill, React view, and `DIAGRAMS`/`ROUTERS` registry entry). Two parts:

1. **A cross-project library** of diagram-*type* definitions (a title, a style, and free-text
   authoring instructions) saved outside any one repo, in the user's home directory.
2. **A per-repo generated diagram** for one of those types, produced by the `codechroma-draw-diagram`
   skill (custom type) run from the canvas terminal panel — see the "Routes" section below for why
   this is a skill run, not a UI-triggered generate/status/output/cancel job like C1/Patterns still
   have.

## The two stores, and why they're different

| | Where | Scope | Written by |
|---|---|---|---|
| Diagram-type definition | `~/.codechroma/diagram-types/<type-id>.json` (`$codechroma_DIAGRAM_TYPES_DIR` overrides) | Cross-project — the user's machine, not one repo | By hand, or a direct `PUT /diagram-types/{type_id}` — the in-app interview that used to write here is retired (see below) |
| Generated diagram | `<repo>/.codechroma/custom/<type-id>.json` | One repo | The generator (`codechroma-draw-diagram` skill, custom type), run from the terminal panel — writes straight to disk, no UI generate button |

🔴 **This is the first *live* home-directory store on the Python side.** `bridge/agents/worktree.py`
deliberately moved worktrees *out* of `~/.codechroma` and into the repo (see
[`parallel-agents.md`](parallel-agents.md) — `worktrees_root()`'s `$codechroma_WORKSPACES_DIR`
override mirrors `library_dir()`'s `$codechroma_DIAGRAM_TYPES_DIR` shape exactly, same env-var escape
hatch, opposite default location). The difference is deliberate: a worktree is repo-specific working
state; a diagram *type* ("show me data flow, grouped by layer") is an authoring artifact the user
wants back on the *next* repo without re-describing it — that's the feature's whole point. One
consequence: a saved type lives only on the machine that created it — committing code shares nothing
about it with a teammate. Export/import between the home library and a repo is explicitly out of
scope for v1 (see "Not built yet" below).

`src/codechroma/diagrams/library.py` owns the first store: `library_dir()`, `valid_type_id()` (a
definition's id becomes a filename — validated against `CustomDiagramsConfig.type_id_pattern`,
`^[a-z0-9][a-z0-9-]{0,63}$`, before it ever touches a path), `list_types()`/`load_type()`/
`save_type()`/`delete_type()`, and `validate_definition()` (id/title/style/instructions all
required; style must be a real `STYLES` key). `save_type()` also enforces
`CustomDiagramsConfig.max_types` so the library can't grow unbounded.

## The style registry

`src/codechroma/diagrams/styles.py`'s `STYLES: dict[str, DiagramStyle]` is what a definition picks a
render style from. `GET /diagram-styles` serves it so a caller authoring a definition (by hand, or a
skill run) can pick it by name rather than hardcoding the string. Six entries today
(036-shared-diagram-style-catalog added four:
`patterns-yellow-arrows`, `impact-status-colors`, `layered-flow`, `state-machine` — reproducing each
pre-036 type's own look, not custom-specific), all authoring the same shared shape
(`{type, style, nodes, relations}`, see [`diagram-skills.md`](diagram-skills.md)). The two a custom
definition actually picks between in practice:

- `boxes-arrows` — plain boxes, optionally clustered into named groups, connected by labeled arrows.
- `dependency-graph` (018) — the same shape, but `relations[].kind` is a closed
  `"imports"|"calls"` vocabulary and cycles (including a node relating to itself, e.g. recursion) are
  real data the resolver must keep, not noise to clean up. See "Resolving the generated diagram"
  below for how that differs from every other style.

`DiagramStyle` itself changed shape in 036: `supports_groups`/`allow_self_relations`/`schema_hint`
were fixed dataclass fields before; now there's one open `overrides: dict[str, object]`
(`dependency-graph`'s entry is `overrides={"supports_groups": True, "allow_self_relations": True}`).
A new capability needs no dataclass change, just a new key some resolver/renderer reads —
`resolve_style_overrides(style_source)` is the one place a `"style"` (a catalog name here, always —
a custom definition never authors an inline overrides dict) turns into the effective map.

Since the 016-single-canvas-dashboard migration, **a style that stays inside "boxes connected by
arrows" needs no web change at all** — `web/src/canvas/doc/CanvasNodeBox.tsx` renders every element
kind generically via `styleFor(element.render)` → `NODE_STYLES[render]`
(`web/src/canvas/doc/nodeStyles.tsx`), and `render` is always `"custom"` regardless of which library
style produced the data (`canvas/recipes.py`'s shared `reshape()`). `tests/unit/test_diagram_styles.py`
only checks a legacy web mirror (`web/src/canvas/custom/styles/registry.ts`) when that path still
exists — it doesn't anymore, so the check is a no-op survivor from before the migration. A **new
visual grammar** (Gantt, UML, kanban) is a different, bigger task: a new `render` kind, a new
`NODE_STYLES` entry (or a sibling component if the shape doesn't fit a box), and a non-dagre layout
module — `docs/planning/018-dependency-graph-diagram-style/`'s "Later styles" note was meant to guide
this, but that planning doc is not present in this checkout; there is no existing design to read
before starting one.

⚠ **Two unrelated things share the word "style"**: the diagram-type-id `style` above
(`dependency-graph`/`boxes-arrows`, a library-level layout/vocabulary choice) and a per-node `style`
authored on one node in the diagram JSON (a color override, the shared `reshape()` reads it off the node
dict and `graph_to_ops` carries it onto `RecipeNode.style` — see
[`single-canvas.md`](single-canvas.md)'s recipes-layer entry). The two never interact.

## The interview (retired) and the `custom` agent (already orphaned before it)

🔴 **Both composite runners this section used to describe in depth are gone.** `custom`'s composite
`SkillAgent`/`job_key(repo_id, type_id)` machinery (`bridge/custom_diagram_agent.py`'s
`CustomDiagramAgentSpec`/`build_agent()`/`COMPOSITE_SPECS["custom"]` entry) was removed in 034
(duplicate/dead-code cleanup) — nothing in the live HTTP surface ever called `.start()` on it since
016 Stage 6 deleted the generate route. `diagram-type` (the interview) followed in the
diagram-management unification: it fed a multi-turn-on-top-of-single-shot trick (`claude -p` can't
ask a question and wait, so each user answer was its own short `claude -p` run whose prompt carried
the whole transcript so far, and the skill rewrote its draft as
`{"status": "asking"|"ready", "questions": [...], "definition": {...}}` on every turn), a
question-bank-first prompt (`QUESTION_BANK`, biased toward "Group by layer (recommended)"), and a
`library.validate_definition()`-mirroring self-check (`check_diagram_type.py`) so a bad draft failed
during the interview, not silently at save time. `bridge/diagram_type_agent.py`, the
`codechroma-diagram-type` skill, and every `/diagram-types/interview...` route are all deleted; none
of that machinery has a live successor — see git history for the full mechanism if it's ever needed
as a reference.

The *get/resolve/path* half of a saved custom type is **not** hand-written, and is untouched by
either retirement: the runtime `DiagramRegistry.get("custom/<type_id>")` synthesizes a `DiagramSpec`
from the library definition (see `bridge/diagram_registry.py`), so the custom GET and `-path` routes
flow through the *same* `resolve_diagram`/`diagram_path_response` helpers the built-in c1/patterns
get routes use. A type's `PUT /diagram-types/{type_id}` still runs the same
`library.validate_definition()` the interview's save step used to call (now via a small local
`_known_registries()` helper in `routes/custom_diagrams.py`, since the module that used to own it is
gone) — so a hand-authored or directly-`PUT`ed definition is validated exactly as strictly as an
interview-produced one used to be.

## Routes (`bridge/routes/custom_diagrams.py`)

Library and style routes are **not repo-scoped**; the generated diagram is. `type_id` is always a
path parameter, so a new type needs no process restart. The GET and `-path` routes route through
`DiagramRegistry.get("custom/<type_id>")`'s synthesized spec via `routes/diagrams.py`'s
`resolve_diagram`/`diagram_path_response` — the same single implementer the built-in c1/patterns GET
routes share, so a custom type needs **no registry edit at import time**: its spec is synthesized from
the library on the first request. ⚠ The `-path` route is registered *before* the bare `{type_id}`
GET: Starlette matches in registration order, so a later `{type_id}` route would otherwise capture
`.../{type_id}-path` and 404 instead of resolving the skill's write target.

| Route | Purpose |
|---|---|
| `GET /diagram-styles` | the render-style registry a saved definition's `style` picks from |
| `GET /diagram-types` | list saved definitions (id, title, description, style) |
| `GET /diagram-types/{type_id}` | one definition |
| `PUT /diagram-types/{type_id}` | create/update (validated, schema-checked) |
| `DELETE /diagram-types/{type_id}` | remove from the library |
| `GET /repos/{repo_id}/custom/{type_id}` | the resolved diagram |
| `GET /repos/{repo_id}/custom/{type_id}-path` | where the generator skill writes |

🔴 **`type_id` becomes a filename twice over** — once under the home-dir library, once under the
repo's `.codechroma/custom/`. Both paths go through the one shared `valid_type_id()` check before
anything touches disk.

⚠ **016-single-canvas-dashboard Stage 6 deleted the per-repo generate/status/output/cancel trio and
the layout GET/POST pair**, 034 (duplicate/dead-code cleanup) removed the now-unreachable
`custom_diagram_agent` `SkillAgent`/`COMPOSITE_SPECS["custom"]` entry that trio used to drive, and the
diagram-management unification later deleted the library's own `-path`/interview trio the same way
(the previous section). The `codechroma-draw-diagram` skill (custom type) writes its artifact straight
to `custom_path` on disk when a user runs it from the canvas terminal panel, and never posts
`/generate`. There is therefore no "Generate"/"Regenerate" button in the UI to auto-fire or gate —
`AgentRail`'s Diagrams tab only reads whatever the skill already wrote, via the plain GET above. A
box's position lives on the shared
canvas document (`Element.position`), not a per-type `-layout` file, so the layout pair had nothing
left to serve either.

## Resolving the generated diagram

036-shared-diagram-style-catalog moved almost all of this into the shared resolver.
`bridge/custom_diagram_resolver.py` now holds only `grouping_enabled(definition)` — whether a
custom type's own generated diagram should carry `groups` at all (its author's own
`definition.grouping.enabled` toggle, gated further by whether the chosen style's `overrides` even
supports groups). Everything the defensive-validation discipline used to describe here —
a malformed node/relation dropped rather than crashing the route, a relation naming an unknown id
dropped, a node's `path` resolved to a real graph node (`component::<path>` then `dir::<path>`,
exact match only, still `c1_resolver.resolve_path_node` under the hood, just called from the one
shared `bridge/diagram_resolver.py::resolve_diagram()` now instead of a local `resolve_custom`) —
is the shared resolver's job, the same one every other type's `DiagramSpec.resolve` closure calls
(`diagram_registry.py::DiagramRegistry._synthesize_custom`). `has_diagram` is still `bool(data)`,
the same convention every type uses. The resolved payload still echoes `style` from the definition.

🔴 **A relation naming itself is dropped, except for a style whose `overrides` set
`allow_self_relations: true`.** Every other style treats `from == to` as noise; `018`'s
`dependency-graph` preset carries `allow_self_relations: true` in `styles.py` for exactly this — a
self-relation there is real data (a function calling itself). This is now a data-driven property of
the chosen style, not a `definition["style"] == "dependency-graph"` string check in code — any style
(custom or otherwise) can opt in by setting that one override key. A multi-node cycle (A imports B,
B imports A) was never affected by this check either way — both relations have different endpoints,
so nothing style-specific was needed to keep those. The generator skill's self-check
(`check_diagram.py --kind custom`) mirrors the same style-aware rule before flagging `SELF`.

## Canvas rendering

⚠ `web/src/canvas/custom/` (`BoxesArrowsRenderer.tsx`, `CustomDiagramView.tsx`,
`CustomConnections.tsx`, `customGraphLayout.ts`, `CustomDiagramMenu.tsx`) and
`state/customDiagramStore.ts` **no longer exist** — deleted whole in
016-single-canvas-dashboard Stage 4. A generated custom diagram (whichever style produced it) now
renders through the one canvas document's generic pipeline: `canvas/recipes.py`'s shared `reshape()`
turns the resolved `{nodes, relations}` into `RecipeNode`/`RecipeEdge` objects with `render:
"custom"`, `web/src/canvas/doc/CanvasNodeBox.tsx` draws them via `styleFor("custom")` →
`NODE_STYLES.custom` (`web/src/canvas/doc/nodeStyles.tsx`), and `web/src/canvas/doc/autoLayout.ts`
runs dagre once over newly-added elements, persisting the result as the document's own position. The
rail's draw entry is `canvas/doc/DrawDiagramButton.tsx` (always launches the drawing agent, no
listing of saved types); `AgentRail`'s Diagrams tab is what lists every saved library type's
generated diagram now (on canvas or not) and adds/removes/deletes it — see
[`single-canvas.md`](single-canvas.md) for the full rendering pipeline and that tab's behavior; none
of it is style-specific.

**"Regenerate" is a skill re-run, not a UI action.** The user re-runs the `codechroma-draw-diagram`
skill from the terminal panel (optionally telling it what changed) and the skill itself reads the
existing `custom/<type-id>.json` first, per its own "deepen, don't start over" rule (see the
SKILL.md excerpt above). The Diagrams tab then just re-fetches the resolved GET route to pick up
whatever the skill wrote.

## The interview panel (retired)

🔴 **`canvas/DiagramTypeWizardPanel.tsx`, `state/diagramWizardStore.ts` and
`state/useDiagramTypeInterview.ts` are deleted** (diagram-management unification) — there is no
in-app UI left that authors a new library entry through a multi-turn question flow. A definition is
now saved by hand (editing a JSON file under `~/.codechroma/diagram-types/`) or by a direct
`PUT /diagram-types/{type_id}` from a skill/API caller; `GET /diagram-types` still drives whatever
lists saved types (today, `AgentRail`'s Diagrams tab).

## ⚠ Known limitation: a cross-axis nudge on a dragged box's saved position

`useAbsoluteSavedLayout` (`canvas/useSavedLayoutAndFitLoop.ts`) is meant to be immune to a box's raw
dagre position shifting between renders — it stores an absolute target and recomputes `delta = target
- currentRaw` fresh every render. In practice `useSelectionAwareDrag`'s mount effect (`canvas/
collision/useSelectionAwareDrag.ts`) fires one `onOffsetChange` on every box's first mount, seeded
from whatever `initialOffset` that render had. If the box mounts *before* `useMeasuredSizes` reports
its real (non-`DEFAULT_NODE_SIZE`) width — which `boxes-arrows` always does, since a box only learns
its true size after its first paint — that stray write can bake a small, untouched-axis offset into
the persisted absolute position once real widths differ meaningfully from the 200×56 default. The
*dragged* axis itself was unaffected (confirmed reproducible, when this was written, via the now-
deleted `web/e2e/custom-diagram.spec.ts`: the axis actually moved always reproduced exactly on
reopen; the other axis could drift). This is pre-existing behavior shared by every
`useAbsoluteSavedLayout` consumer (Patterns, C1, Epics), not something feature 011 introduced — it
simply surfaced more often here because grouped custom-diagram boxes tend to differ from the 200×56
default by more than a typical Patterns box does. Fixing it means changing shared collision code all
consumers depend on, which was out of this feature's scope. No dedicated spec asserts this for custom
diagrams anymore (see "Tests" below) — treat this note as unverified against the current tree.

## Not built yet

- Exporting/importing a saved type between the home library and a repo, for team sharing.
- A genuinely new visual grammar (Gantt/UML/kanban) — needs a new `render` kind and web renderer;
  `docs/planning/018-dependency-graph-diagram-style/` was meant to guide this but is not present in
  this checkout.
- Per-type `context_sources` beyond `/structure` + `/dependency-digest`.

## Tests

`tests/unit/test_diagram_library.py` (incl. `validate_definition`'s layout/grouping/relation_kinds
shape checks), `test_diagram_styles.py` (incl. `dependency-graph`'s registration and schema hint),
`test_custom_diagram_resolver.py` (incl. self-relation/cycle survival for `dependency-graph`) ·
`tests/contract/test_custom_diagram_routes.py` (the current route table only — library CRUD, style
list, the per-repo GET/`-path` pair, and a regression that the retired interview route 404s; no
generate/status/output/cancel/layout, deleted in 016 Stage 6). `test_diagram_type_agent.py` and
`test_diagram_type_check_script.py` (the interview agent and its `check_diagram_type.py` self-check)
are deleted along with the interview itself (diagram-management unification) — see
`test_skill_sync.py`'s retire/prune coverage for `codechroma-diagram-type` instead. ⚠
`web/e2e/custom-diagram.spec.ts` was deleted whole in 016 Stage 4, along with every
other per-diagram-kind e2e spec — a custom diagram's on-canvas rendering/drag/persistence is now
exercised only through the generic `canvas/doc/` specs (see [`single-canvas.md`](single-canvas.md)'s
own test list), not a dedicated spec; that's a real coverage gap for style-specific behavior (like
`dependency-graph`'s cycles), not a documentation error to fix later.
