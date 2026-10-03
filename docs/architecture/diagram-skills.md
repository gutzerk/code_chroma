# The diagram-drawing skill (`codechroma-draw-diagram`) and the soft-diagnostics path

One skill draws every generated diagram. Four separate skills (`codechroma-c1`,
`codechroma-patterns`, `codechroma-impact`, `codechroma-custom-diagram`) were merged into it. The
*review* job is a second, separate skill — `codechroma-review-diagram` (037-total-diagram-
unification), which itself replaced two per-axis skills (`codechroma-c1-review`,
`codechroma-impact-review`; see "037: five named registries" below). The *interview*
(`codechroma-diagram-type`) is a third, unrelated job.

## Why it was merged

Three things had drifted, all of them consequences of "one skill per diagram type":

- **Nothing routed.** `RecipeMenu.tsx`'s "Draw a diagram" told the agent to "run the matching
  `codechroma-*` skill", leaving the pick to the model — and offering nothing at all for a type the
  repo has no skill for.
- **Rules diverged.** Numeric budgets existed only in c1. The label-length rule only in impact. The
  `style` rule in three of four. The `kind`/icon vocabulary only in c1.
- **Two lists of skill names were hand-kept.** `skill_sync.SKILL_NAMES` and `packaging/bridge.spec`
  — and they had already diverged: the frozen build shipped **no impact skill at all**.

## Layout

```
.claude/skills/codechroma-draw-diagram/
  SKILL.md                       #  52 lines — router only
  references/
    drawing-rules.md             # 298 — shared rules, the one shared shape + style catalog, fallback
    type-c1.md                   # 210 — 042-c1-diagram-quality-and-speed cut it from ~350: flat
                                  #       system-context authoring only, decomposition removed
    type-patterns.md             # 226
    type-impact.md               # 172
    type-sequence.md               # ordered-call flow from trace scaffold or code context
    type-custom.md                 # 173
  scripts/
    check_diagram.py               # one self-check, including --kind sequence
```

⚠ **The source of truth is the repo root's `.claude/skills/`**, resolved by
`bridge/resources.py`'s `_SOURCE_RELATIVE["skills"]`. `examples/.claude/skills/` used to hold a
byte-identical mirror that nothing read; it was deleted and `examples/.claude/` is now gitignored,
because it was machine output from dogfooding the bridge against `examples/`.

🔴 **`SKILL.md`'s `description` is the load-bearing artifact, not the prompts.** Only `c1` has a
generate route (`DiagramSpec.has_generate`), so `patterns_agent.yaml` and `impact_agent.yaml` are
unreachable today — patterns/impact are launched by an in-canvas agent that picks the skill **by
description match**; a custom type's prompt comes from its saved definition
(`content_generators.py`'s `prompt=definition.instructions`), not from a YAML file. The merged
description is 983 chars, down from 2077 across the four originals. Re-check trigger accuracy before
trimming it further.

⚠ The prompt YAMLs name the skill **and** the type **and** the reference file
(`Use the codechroma-draw-diagram skill, type c1 — read references/type-c1.md …`), which is what the
router's precedence line ("a named reference file wins over this table") makes deterministic.

## 🔴 Retiring a skill needs its own pass

`sync_skill` only `rmtree`s a target whose name is still in `SKILL_NAMES`. Removing a name therefore
**leaves the old copy installed forever** in every repo a previous version analyzed — five
overlapping descriptions for the model to choose between, which is the worst possible outcome of a
merge. `skill_sync.RETIRED_SKILL_NAMES` + `prune_retired_skills()` (called from `sync_all_skills`)
exist for exactly this. Retired names also stay in `SKILL_EXCLUDE_PATTERNS`, so a leftover never
reads as the user's own untracked work in the window before it is removed.

⚠ `packaging/bridge.spec` now **imports** `SKILL_NAMES` instead of re-typing it. The hand-kept copy
is what silently dropped `codechroma-impact` and `codechroma-impact-review` from every frozen build.

💡 `skills.is_synced_skill_path` matches the `codechroma-` prefix, not exact names, so it needed no
change.

⚠ **`codechroma-diagram-type`** (the custom-diagram-type interview skill, unrelated to
`codechroma-draw-diagram`'s own "custom" type) followed the same pass in the diagram-management
unification: its in-app UI (the wizard panel) and backend (`diagram_type_agent.py`, its
`/diagram-types/interview...` routes) are deleted outright, not just retired-and-pruned, but the
skill *name* still moved from `SKILL_NAMES` to `RETIRED_SKILL_NAMES` the normal way, since an
already-installed copy in an existing repo needs the same prune. See
[`custom-diagrams.md`](custom-diagrams.md) for what survives (the library) and what doesn't (the
interview).

## 036: one shared shape, one resolver, one render path

The skill merge above unified *which skill* draws a diagram and *how it's checked*; it left each
type's authored JSON schema, resolver and canvas-reshape function separate. 036-shared-diagram-
style-catalog (see `specs/036-shared-diagram-style-catalog/`) unifies that remaining layer too: `c1`,
`patterns`, `impact` and `custom/<id>` now all author and resolve to one shape.

**The shape** (`drawing-rules.md`'s "The one shared diagram shape", `contracts/diagram-schema.md`):

```json
{"type": "c1", "style": "boxes-arrows",
 "nodes": [{"id", "name", "description", "parent", "path", "node_id", "group", "kind", "icon",
            "style", "meta"}],
 "relations": [{"from", "to", "kind", "label", "transport", "style"}]}
```

`parent` (another node's own `id`) replaces every type's previous nesting: c1's `system`/`children`
tree and patterns' `instances[].participants[]` are both gone — a c1 block, a pattern instance
(`kind: "pattern-instance"`, `meta: {type, confirmed, confidence}`) and its participants
(`meta.role`) are just flat `nodes[]` entries now. `meta` is an open bag for whatever's specific to
one type (`status` for impact, `confirmed`/`confidence` for patterns) that the shared resolver never
reads. A pre-036 saved file converts to this shape once, on first read after upgrade
(`bridge/diagram_migration.py`'s `migrate_if_legacy`); one the converter can't parse is left on disk
untouched and served with `needs_regeneration: true` rather than crashing.

**The resolver**: `bridge/diagram_resolver.py`'s `resolve_diagram(engine, data, *, style_source=None)`
replaces `resolve_c1`/`resolve_patterns`/`resolve_impact_diagram`/`resolve_custom` — node/relation
validation, `path`→`node_id` resolution, dangling-relation drop, and style-priority application are
now one implementation every `DiagramSpec.resolve` closure (`bridge/diagram_registry.py`) calls.
Coverage (`attach_coverage`) and staleness (`attach_staleness`) live in the same module as opt-in
add-ons any type's closure can call — `custom/<id>` gaining both, which it had neither of before, is
the concrete proof they generalize (`DiagramRegistry._synthesize_custom`). The `meta.critically`
(`bridge`/`hub`) stamp and its canvas chip were **removed** as dead weight — a bridge/hub box already
visibly converges arrows. Fragility is surfaced only by the self-check's `ARTICULATION` advisory:
`diagrams/articulation.articulation_labels` is a neutral graph module used by `inspect.py` (for the
`ARTICULATION` advisory) and mirrored in `check_diagram.py`, so the two can't drift.

**Edge provenance (`meta.origin`) — 012 Provenance**: every dependency edge now knows where in
code it comes from, so clicking an arrow can jump to the caller. Origin is a property of the
*source* (calling) node, not a persisted edge map: `GraphEngine.edge_origin(from_id)` derives
`file:line` on demand from that node's `Symbol` (`graph/builder.symbol_origin` — file + start line,
both fields `Symbol` already holds), so there is nothing to persist, recompute, or desync.
`GET /repos/{id}/nodes/{node}/connections` adds an `origin` field to each connection (additive to
`from_to`). `resolve_diagram` then stamps `meta.origin` on each relation whose source endpoint
resolves to a graph node via `attach_origins` — an opt-in stamp merged into existing `meta`, left
absent when the source is conceptual/planned or the engine has no symbol for it. The same
`engine.edge_origin` method serves both the route and the resolver, so the two can't drift.
Known precision limit: origin points at the *caller's symbol* (its file + start line), the same
value for every edge out of one node — not the exact call site. That granularity matches the
"click the arrow, land on the caller" contract and needs no per-call line tracking; the web
consumer splits `file:line` on the **last** `:` so Windows drive letters (`C:`) don't break the
jump.

**The style catalog** (`diagrams/styles.py`): `DiagramStyle.overrides` is an open
`dict[str, object]` now, not fixed `supports_groups`/`allow_self_relations`/`schema_hint` fields.
`STYLES` has six presets — `boxes-arrows`, `dependency-graph` (pre-existing), plus
`patterns-yellow-arrows`, `impact-status-colors`, `layered-flow`, `state-machine` (added to
reproduce each type's pre-036 look with no visual change). A node/relation's own `style` still wins
over the diagram's resolved overrides, which win over no override at all.

**The render path**: `canvas/recipes.py`'s one `reshape(resolved, render)` replaces
`c1_reshape`/`patterns_reshape`/`impact_reshape`/`custom_reshape`/`epics_reshape`; `recipe_for`'s
`custom/<id>` case collapsed into one layer-parameterized `Recipe`. `web/src/state/types.ts`'s
`Diagram`/`DiagramNode`/`DiagramRelation` replace four per-kind type families, and
`canvas/doc/nodeAccent.tsx`'s one `accentFor()` replaces four `*Accent` functions behind a switch —
patterns/impact/custom render icon-by-`kind` and status/group classes now, a capability gain, not
just a refactor. `canvas/doc/elementRules.ts`'s `NODE_STYLES` collapsed to one shared
`DIAGRAM_NODE_BASE` entry (pattern/impact/custom/epic reuse it; c1 stays its own approximation) and
`styles.css`'s per-kind box/row/header/title-row/name/desc rules collapsed into one
`.diagram-node-box*` family, with genuine per-kind modifiers (seed/problem accents, infra/external
left-borders, group's dashed frame, epic's meta row) layered on top.

A node's `meta.icon` brand logo resolves through two vocabularies merged
(`web/src/icons/brands.ts`'s `ALL_BRAND_ICONS`): `web/src/icons/brands.generated.ts` (simple-icons, includes
`anthropic`) plus `web/src/icons/brandLobe.ts` (lobe-icons, MIT) for the LLM/AI marks simple-icons
withdrew on trademark request — `claude`, `claudecode`, `openai`, `gemini`, `langchain`, `mistral`,
`ollama`, `bedrock`. Both feed the same `accentFor`/`NodeKindGlyph` chain, so a lobe slug renders
and auto-contrasts exactly like a simple-icons one.

`check_diagram.py` reads whatever `GET /repos/{id}/{kind}` actually resolves to, so it had to move
with this: `_inspect_c1`/`_inspect_patterns` used to read the pre-036 nested `system`/`instances`
keys directly and had silently stopped matching real bridge output (a real, since-fixed bug — they
vacuously passed a c1/patterns diagram against a resolved payload that no longer had those keys at
all). Both now walk the flat `nodes[]`/`parent` shape; duplicate-id, duplicate-path and relation-
endpoint checks are shared/generic (`_check_duplicates`, `_check_relations`) instead of c1 having its
own trail-addressing logic, since there is no more "id trail" concept anywhere — every id is flat and
file-wide unique, which is also why `AMBIGUOUS` and `SIBLING` were retired (see below).

## The self-check's unified contract

| Code | Meaning |
|---|---|
| `0` | `OK: <n> …` — advisory lines may still print above it |
| `1` | `BROKEN`, `DANGLING`, `SELF` — points at nothing, or draws nowhere |
| `3` | shape: it resolves, but the diagram is not doing its job — overridable with `--shape-advisory` |
| `2` | the diagram could not be read at all |

Advisory (print, never gate): `COVERAGE`, `DEPTH`, `NESTING-EDGE`, `CYCLES`, `ARTICULATION`,
`BADKIND`, `BADICON`, `UNLABELED`, `DROPPED`.

`CYCLES` (011-draw-relations-borrow): a directed cycle in `relations[]` — found by `_check_cycles`
(Tarjan SCC) in both the flat and hierarchical strategies. Advisory because a cycle is often
legitimate (state-machine, retry-loop); only a permitted self-loop (custom `dependency-graph`) is
reported as a 1-edge `CYCLES <id> -> <id>`.

`ARTICULATION` (012-draw-borrow-backlog, task C): flags a critical node. `_check_articulation` /
`diagrams/articulation.articulation_labels` (used by `bridge/inspect.py`'s `FlatInspector` + c1
`_check_relations`, mirrored in `check_diagram.py`) labels each node `bridge` when a single-node SCC
is an articulation point of the undirected condensation (removing it disconnects the graph), or
`hub` when it wires to `4+` neighbors and isn't a bridge. This is **advisory only** — the labels are
reported by `bridge/inspect.py`'s `ARTICULATION` self-check advisory; there is no `meta.critically`
stamp or canvas chip (removed as dead weight). `check_diagram.py` keeps its own stdlib-only copy of
the label logic because it cannot import the package.

Three deliberate behaviour changes from the merge:
- impact's `ORPHAN` moved from exit 1 to exit 3 and became overridable — a shape problem, not a dead
  link. This is a real loosening for the one type that is supposed to be small and fully connected.
- `--shape-advisory` now exists for **every** kind; impact and custom had no such flag.
- `DUPLICATE` and the relation findings share one sentence across kinds, so c1's original wording
  changed. Same finding, same tier; `test_c1_check_script.py` now asserts the stable parts.

⚠ `ISLAND` (a 2+-node cluster wired only to itself) originally shipped only for patterns and custom
-- `CheckConfig.check_islands` was `None` for c1 and impact, and `HierarchicalInspector` never called
the island logic at all regardless of config, even though `type-c1.md`'s "every actor needs a
relation to `system`" and `type-impact.md`'s "every box must connect" already promised exactly this.
Both gaps are closed: impact just flips `check_islands` on (its `FlatInspector` path is unchanged);
c1 gets its own `_check_c1_islands` (`bridge/inspect.py`, mirrored in `check_diagram.py`'s
`_check_c1_islands`) since c1 has an authoritative root (`"system"`) rather than "whichever
component is largest" -- it unions parent→child containment edges with `relations[]` endpoints, then
flags any component of size ≥2 that doesn't include `"system"`.

⚠ `AMBIGUOUS` (a bare id claimed by several blocks, disambiguated by a full id trail) and `SIBLING`
(a duplicate id tolerated as advisory-only within one c1 branch) are **retired** by
036-shared-diagram-style-catalog, not merely renamed: every id is flat and file-wide unique now (no
more c1 "trail" addressing), so a repeated id is unconditionally a shape-tier `DUPLICATE` regardless
of where in the diagram it appears. `check_diagram.py`'s own module docstring still lists both in its
exit-tier prose — that's stale and should be corrected alongside the next change to that file.

### The density family (new — no previous script had an upper bound)

🔴 `_BUDGETS` in `check_diagram.py` and the markdown table in `drawing-rules.md` must stay equal;
`tests/unit/test_diagram_check_script.py` parses the markdown and asserts it. That is what makes
"the rules live in both the prompt and the machine check" a checked property rather than a hope.

| kind | max_nodes | max_relations | max_name_chars | max_edge_label_chars |
|---|---|---|---|---|
| c1 | 60 | 60 | 40 | 50 |
| patterns | 45 | 70 | 40 | 50 |
| impact | 25 | 40 | 40 | 40 |
| custom | 60 | 100 | 40 | 50 |

`CROWDED`/`EDGEBOMB` are shape-tier; `LONGLABEL` and `UNLABELED` are advisory (`UNLABELED` is one
aggregated line, and shape-tier for c1 only, whose schema requires a label). A `custom` diagram with
`style == "dependency-graph"` is exempt from `CROWDED`/`EDGEBOMB`, reusing the same style-aware
precedent as its existing `SELF` exemption.

⚠ These thresholds are **not** in `config.py`. The script is stdlib-only inside the analyzed repo
and cannot import `codechroma`. The constitution's "capped by configuration" rule governs listings
the bridge serves — that is the diagnostics cap below, not an authoring guideline.

## 037: five named registries replace the per-type closures

036 unified *shape*; 037-total-diagram-unification (`specs/037-total-diagram-unification/`) unifies
*behavior*: a diagram type is now one declarative `DiagramTypeDefinition`
(`diagrams/registry.py`) plus five small, string-keyed registries every type — built-in or
custom — plugs into by name, replacing `bridge/diagram_registry.py`'s `DiagramSpec`/`DIAGRAMS` as
the source of a type's data (routing/generate-route wiring stays on `DiagramSpec` for now; see
`research.md` Decision 1). The three genuinely algorithmic pieces (pattern detection, impact
slicing, c1's hierarchical tree-walk) stay as named code behind these registries; everything else —
budgets, which overlays apply, which context provider feeds the drawing skill, which review axis —
is JSON on the `DiagramTypeDefinition`.

| Registry | File | Looked up by | Built-ins registered |
|---|---|---|---|
| Content generator | `bridge/content_generators.py` | `ContentGenerator` name | patterns' detector, impact's slicer |
| Context provider | `bridge/context_providers.py` | `DiagramTypeDefinition.context` | `patterns`, `impact` (`c1`/`custom` default to `None` → null `generation_data`) |
| Overlay | `bridge/overlays.py` | each name in `DiagramTypeDefinition.overlays` | `changes` (impact, path-independent — moved off c1 in the same 038 follow-up; the `"review"` overlay was removed with the judgmental axis, same follow-up; the `"plan"` overlay was retired with the Plan overlay, see below) |
| Inspector | `bridge/inspect.py` | `DiagramTypeDefinition.checks.shape` | `hierarchical` (c1), `flat` (patterns/impact/custom) |
| Review | `bridge/review.py` | `DiagramTypeDefinition.review.agent_factory` | `impact-changes` (c1's `review` is `None` now — the explanatory axis moved to impact, 038 follow-up, since impact resolves onto real graph `node_id`s instead of c1's path-addressed blocks) |

**The context envelope** (`contracts/context-envelope.md`): `GET /repos/{id}/{kind}/context`
(`routes/diagrams.py::get_diagram_context`, plus `routes/custom_diagrams.py`'s
`/custom/{type_id}/context` twin, since a path parameter can't span the `custom/<id>` slash) returns
one `{coverage, staleness, generation_data}` shape for every kind, replacing three structurally
different bodies: `GET /repos/{id}/c1/coverage`, `/patterns-context`, `/impact-context` (all three
🔴 deleted — every caller, including `check_diagram.py`'s `_check_coverage`/`_check_sparse` and
`codechroma-review-diagram`'s SKILL.md, now reads `.coverage`/`.generation_data` off the unified
route). `source`/`feature` query params still reach impact's provider, unchanged from the old
`impact-context` route.

**The inspector split** (`contracts/inspector-config.md`, research.md Decision 5): `inspect.py`
defines an `Inspector` Protocol with two strategies, not one function per kind —
`HierarchicalInspector` keeps c1's real tree-walk (`_walk_c1`/`_check_actor`/`_check_leaf`, id-trail
addressing) and `FlatInspector` keeps patterns/impact/custom's already-shared
`_check_duplicates`/`_check_relations`/`_check_orphans`/`_check_islands`, now driven entirely by a
type's own `CheckConfig` (budgets, `coverage_source`, `density_source`, `required_meta`,
`membership_source`, `allow_self`, `check_islands`) instead of hand-listed per-kind constants.
`check_diagram.py`'s old `_INSPECTORS` dict and four `_inspect_*` functions are gone; it dispatches
into `inspect.py` keyed by `checks.shape` and reads every threshold from the fetched
`DiagramTypeDefinition` instead of a literal `if kind == ...`.

**The one review flow** (`contracts/review-result.md`): `codechroma-review-diagram` replaces
`codechroma-c1-review`, parametrized by `review.axis` — today only `explanatory` (before/after prose)
resolves. 🔴 The `judgmental` axis (severity) was removed rather than kept half-wired (038
follow-up): `overlays.py`'s `"review"` overlay/`routes/impact.py`'s `/impact-review` routes are gone
entirely. 🔴 In the **same** 038 follow-up, the `explanatory` axis itself moved from `c1` to
`impact`: `c1`'s `review` is now `None` (`GET /repos/{id}/c1/review` 404s), and `impact`'s
`review.agent_factory` is `"impact-changes"`. The reason: `overlays.resolve_impact_changes`
(`bridge/overlays.py`, née `resolve_c1_changes`) now attributes a changed file to a box by a direct
real `node_id` lookup plus a bounded ancestor walk (`GraphEngine.get_node(...).parent_ids`, reusing
`change_cards.build_change_cards`'s own resolution), never the old longest-path-prefix match against
c1's hand-authored blocks — simpler, and it needs no pre-drawn architecture diagram to attach to,
since impact is already a diff-only slice of the real graph. `GET /repos/{id}/{kind}/review`
(`routes/diagrams.py`, backed by `bridge/review.py`'s `resolve_review`) returns one `ReviewResult`
shape (`entries[].explanation`/`.severity`; `ghosts[]` for any type using an overlay with
`can_ghost: true`); the skill's own `scripts/check_review.py` replaces `check_c1_changes.py`,
fetching over HTTP (`GET /repos/{id}/{kind}` + `.../{kind}/review`) and only ever inspecting the
explanatory axis now. `services.py`'s `_build_skill_agents()` builds the `impact-changes` headless
runner from `DiagramTypeDefinition.review.agent_factory` via `REVIEW_AGENT_FACTORIES`, not a
hand-listed dict entry — the same registry-driven read the generate-side agents already used.
`.codechroma/impact-changes.json` is the written artifact (`.codechroma/c1-changes.json` before the
move); `Workspace.impact_changes_path`/`load_impact_changes()` (`bridge/workspaces.py`) own it.

**Hero edges** (impact only, pr-lens-inspired): a relation may carry `hero: true` — the 1-2 edges
the drawing skill judges as best explaining the PR, rendered bolder on the canvas
(`RelationshipEdge`'s `isHero` prop → `.c1-relationship-path--hero`/`-label--hero` in `styles.css`).
This is the first per-*relation* (not per-node, not diagram-wide) styling hook: a relation's own
`style` override already existed end-to-end on the backend (`resolve_diagram`'s `_relation_style`,
`canvas/recipes.py`'s `RecipeEdge.style`, `canvas/document.py`'s `Edge.style`) but the frontend never
read it for edges (only nodes, via `authoredStyle.ts`); `hero` gets the same backend plumbing
(`RecipeEdge.hero`/`Edge.hero`, threaded through `build_batch_ops`) plus the frontend's missing last
hop, rather than reusing the raw `style` dict — a fixed boolean + CSS class is simpler and safer for
the LLM to author than picking colors. `check_diagram.py` caps it at `checks.max_hero_edges` (2,
impact only — a sibling field on `CheckConfig`, deliberately *not* inside `budgets`, since the
density-family table in `drawing-rules.md` and `test_the_prose_budget_table_and_the_machine_one_
cannot_drift` assume exactly 4 columns for every kind).

**Renamed, not rewritten**: `bridge/c1_coverage.py` → `bridge/coverage.py` (no c1-specific logic
left in it); `bridge/c1_resolver.py` + `c1_tree.py` → `bridge/diagram_paths.py`. `web/src/canvas/
doc/CanvasNodeBox.tsx`'s old combined `isC1`/`isImpact` branch is gone, replaced by one
`useNodeOverlays(element)` call reading `element.overlays[name]` for the *changes* overlay
(`isImpact`/`impactChange`, now impact's own) — the *plan* overlay it used to share a render-kind
check with is retired, so this is the box's only overlay check now. `web/src/state/useSidecar.ts`'s
`c1ChromeKey` was generalized to `recipeChromeKey`, which stays generic (`layerPositionCache.ts`,
`diagramCatalog.ts`'s `runRecipeAndLayout` also key off it) even though only the *changes* overlay
reads it today.
`web/src/state/sidecarStore.ts`'s `SidecarStore<T>` generalized the (now-retired, with the Plan
overlay) `c1PlanStore.ts`'s `CardStore<T>` pattern for `changes`/`review` alike, with an optional
geometry channel for the one overlay (`changes`) that synthesizes ghosts.

## Soft diagnostics: what a write lost, made visible

🔴 **There are two silent-drop layers, not one.** Instrumenting only the resolver under-reports.

```
skill writes .codechroma/<kind>.json
   ↓ POST /repos/{id}/recipes/{kind}/run
   ↓ resolve_diagram(engine, data, ...)  ← layer 1: bridge/diagram_resolver.py, one function for all four
   ↓ run_recipe_with_drops(...)          ← layer 2: canvas/recipes.py's one reshape()
   ↓ apply_batch → commit_canvas_batch   ← the response the web already reads
```

Since 036-shared-diagram-style-catalog, layer 1 is one shared `resolve_diagram()`
(`bridge/diagram_resolver.py`) every `DiagramSpec.resolve` closure calls — not four separate
resolvers. Each type's own `{c1,patterns,impact,custom_diagram}_resolver.py` now holds only the
business logic that's genuinely specific to it (patterns' detector-candidate merge, impact's
diff/plan slice derivation, custom's grouping gate) *ahead of* that one call, and diagnostics from
both stages are merged the same way regardless of type (`diagram_diagnostics.merge_dropped`).

`bridge/diagram_diagnostics.py` is the shared accumulator. Payload shape, identical for all four
kinds so one web type and one component cover everything:

```json
{"dropped": [{"what": "node", "id": "pg-client", "reason": "unresolved_path", "detail": "src/db/pg.py"}],
 "dropped_count": 7, "shown": 5, "truncated": true}
```

`REASONS` is a closed vocabulary (`invalid_shape`, `unknown_kind`, `dangling_endpoint`,
`self_relation`, `duplicate_sibling_id`, `depth_capped`, `unresolved_path`, `status_coerced`) so the
web maps slugs to labels instead of parsing prose. `shown`/`truncated` exist because the list is
capped by `settings.diagram_diagnostics.max_reported` (20) and `dropped_count` reports the true
total — a cap that hid its own truncation would read as complete coverage.

⚠ `merge_dropped` sums each stage's own `dropped_count`, never the entries it still carries: an
already-capped input would otherwise undercount itself twice.

**Where it rides.** The `diagnostics` key goes inside each resolver's payload, so it appears on all
four `GET /repos/{id}/{kind}` routes with **no route change** — every one of them is already
`resolve_diagram(ws, kind)`. `routes/recipes.py` merges the resolver's with the converter's
(`RecipeResult.dropped`, via the new `run_recipe_with_drops`) into the recipe-run response.

🔴 **It never joins `errors`.** A `BatchResult` error flips `ok` to False and would block the
render; this mode is soft by decision — an incomplete diagram with a warning beats a blank canvas
with no explanation. By the time the web reads `dropped`, `apply_batch` has already committed.

### The web surface

`state/diagramHealthStore.ts` (a `Store`, so workspace-scoped by construction) is fed by
`runRecipeAndLayout`'s response — no route, no polling, and it appears the instant the run returns.
`canvas/doc/DiagramHealthNote.tsx` renders it, mounted in `RootCanvas.tsx` beside `C1CoverageNote`
and copying that component's chrome contract exactly: screen-fixed outside `CanvasViewport` (so it
neither zooms with the camera nor drifts as blocks expand), `role="status"`, silent unless there is
something to say. It is dismissible per layer.

💡 The same component closes a separate hole: `DiagramGenerationStatus.error` reached the browser
over both transports and was **rendered by no component at all** — `C1CoverageNote` reads `state`
and never `error`. One chrome slot now answers "why does my diagram look wrong?" from both of its
real causes.

## Wiki-first fetch order (epics 029, 049)

`drawing-rules.md`'s "Wiki-first fetch order" section (renamed from "Wiki-context-first fetch order"
by 049) is now two narrative sources tried in sequence before any type-specific context call, plus
that type's own tools as the last resort. `c1` reads only Step 0's `root` (never `containers[]`) and
skips Step 1 entirely (unchanged since 042 — see below); `patterns`/`custom` read both steps in full;
`impact` opts out of **both** steps (see "impact's opt-out" below).

### Step 0 — wiki-general (049)

`GET /repos/{repo_id}/wiki-general-context` (`bridge/wiki_general_context.py` +
`bridge/routes/diagrams.py::get_wiki_general_context`) reads `.codechroma/wiki-general/` — the
AI-generated semantic C1→C2→C3→C4 map (`docs/architecture/wiki-general.md`) — instead of the older
directory-mirroring wiki Step 1 reads. It's a new, separate route rather than a `/wiki-context`
extension: a manifest entry's `path` is the wiki-general **page's own path on disk**
(`"c2/backend.md"`), not a repo-source path, so there is no reliable "repo path → component" index to
teach `build_wiki_context` to prefer wiki-general for a specific requested path — that would mean
parsing markdown prose written by parallel fan-out subagents with no coverage guarantee. Key
differences from Step 1's route, both deliberate:

- **No `paths=` filter.** `build_wiki_general_context()` always returns `root` (`index.md`) plus
  *every* `containers[]` page in full — there's no path index to filter by, so v1 doesn't try. This
  is the compact layer (system overview + containers), sized by `settings.wiki_general_context.max_chars`
  (`WikiGeneralContextConfig`, its own budget, independent of `wiki_context.max_chars`) with
  `truncated` reported the same way Step 1 does. A manifest entry whose page is missing on disk is
  skipped silently, mirroring `wiki_context.py`'s `_safe_read` — this route never raises.
- **No sync call.** Unlike Step 1's route, which calls `ws.engine.sync_wiki(wiki_dir)` inline on
  every request, wiki-general has no `sync_wiki()` analog at all (047's deliberate "full-replace on
  click" design) — this route only ever reads what's already on disk. `generated_at` (from the
  manifest, passed through as-is) is the only freshness signal; there's no new fingerprint/staleness
  infrastructure for it.
- **Component-level (C3) drill-down is a direct file read, not a route.** A container's page already
  links to its components by id, and the skill already knows `repo_root` from its own `*-path`
  endpoint, so `references/drawing-rules.md`'s Step 0 tells it to read
  `{repo_root}/.codechroma/wiki-general/c3/<id>.md` directly rather than adding a second new route.
- **`c1` gets only `root`, never `containers[]`.** `type-c1.md` gained its own Step 0 (before
  `context-digest`) that fetches this route but only ever reads the root narrative — C1 doesn't
  decompose (unchanged since 042), so the C2-level detail in `containers[]` has no box to attach to.
- **No auto-trigger.** A missing wiki-general (`has_wiki_general: false`) is treated exactly like
  Step 1 having no wiki — fall through to the next step. The skill never starts a wiki-general
  generation itself (up to 900s, paid) to fill the gap; generation only ever starts from the canvas's
  own Generate button or an explicit interactive run, per 047's "generation never starts on its own".

Tests: `test_wiki_general_context.py` (pure assembly — no manifest, an invalid manifest, a missing
page skipped not crashed, the char-budget cap), `test_bridge_wiki_general_context_route.py` (no tree
/ tree present), `test_diagram_wiki_general_context_end_to_end.py` (smaller than a full structure
dump; editing the repo after generating doesn't change the served bundle, since there's no sync).

### Step 1 — the older, directory-mirroring wiki (epic 029)

`GET /repos/{repo_id}/wiki-context?paths=<comma-separated paths>` (`bridge/wiki_context.py` +
`bridge/routes/diagrams.py::get_wiki_context`) is a read-only context-builder site, the same shape as
`/structure`/`/patterns/context`/`/impact/context`. `type-patterns.md` and `type-custom.md` call it
for every path they're about to examine, after Step 0 above:

- `has_wiki: true` — read `root` plus each entry in `pages[]` (root-to-leaf, deduped, capped by
  `settings.wiki_context.max_chars` with `truncated` reported per Constitution Principle II) instead
  of a full `/structure`/`/patterns/context`/`/impact/context` dump. A path lands in `gaps[]` only
  when no page for it exists on disk at all — that type's normal context call is the fallback for
  **that one path only** — see `docs/architecture/wiki-generator.md`.
  🔴 `gaps.json` (epic 028's undocumented-symbol report) is **not** consulted here, and never was a
  reliable "no page" signal: `generate_wiki()` writes a file's page unconditionally, docstring or
  not, so a module merely missing its own docstring (its functions can still be fully documented,
  or not) still gets a real, linked page. An earlier version of this route cross-referenced
  `gaps.json` directly and treated any path listed there as unreachable regardless of whether its
  page existed — a real bug, caught when `codechroma-wiki-general`'s self-check kept reporting
  `HALLUCINATED` on real, well-documented files (e.g. a Go file whose package comment was missing
  but whose functions all had doc comments). Fixed by deleting that short-circuit; only a genuine
  missing/unreadable page produces a gap now.
- `has_wiki: false` (no `.codechroma/wiki/index.md`) — unchanged, full-context path for the whole run;
  no wiki generation is ever required as a precondition for a draw.
- The route calls `ws.engine.sync_wiki(wiki_dir)` inline, before assembling the bundle, so the
  skill's first wiki read is never stale. A sync failure raises `HTTPException(500, "wiki sync
  failed: ...")`; the skill treats this exactly like any other reason it can't finish — POST
  `{"state":"error","detail":"..."}` and abandon the run.
- No resolver changed (`c1_resolver.py`/`patterns_resolver.py`/`impact_resolver.py`/
  `custom_diagram_resolver.py` — now each type's own thin layer ahead of the shared
  `resolve_diagram()`, see below — merge an already-authored artifact for canvas display, a different
  job from context-gathering while authoring it). `patterns.json`/`impact.json`'s
  `fingerprint`/`reviewed_fingerprint`/`stale` triplet already catches "the wiki (and so the graph)
  moved on since this was drawn" with zero new code, since `sync_wiki()` is deterministic over the
  same graph state those fingerprints are derived from. c1 still has no staleness concept; custom
  gained one as part of 036 (below), alongside coverage — both now opt-in add-ons any type can wire.

Tests: `test_wiki_context.py` (pure assembly, incl. a `gaps.json` entry never hiding a real page),
`test_bridge_wiki_context_route.py` (no wiki / wiki present / sync failure),
`test_diagram_wiki_context_end_to_end.py` (context shrinks with a wiki present, an undocumented file
still gets served as a real page rather than a false gap, editing a wiki-backed file flips the
existing patterns staleness flag).

### impact's opt-out (049)

`type-impact.md` reads `drawing-rules.md` too, same as every other type — so editing the shared
fetch order would have silently changed impact's behavior as well, without an explicit opt-out.
049 added one: impact never calls Step 0 or Step 1. Its slice is one-hop by construction (a git diff
or a plan, never the whole architecture), so a system-wide or per-file narrative doesn't help judge
it — `impact/context` alone is the one context call this type needs, unchanged from before 049.

## Docs-first

`drawing-rules.md`'s "Docs-first" section is a skill-instruction addition, not a new route: before
authoring a box from code alone, the skill is told to read the target repo's own `README.md`/
`docs/**` first, then grep/read source directly for what's still open. This sits after the Wiki-first
fetch order above (Steps 0/1) — those for paths and topics already known, Docs-first for whatever
they didn't cover.

⚠ **This section used to fall through to a raw search endpoint as a third step** (the research
endpoint's search core) for whatever docs and source still didn't answer. Removed at the user's
request — a real run burned several `curl` round-trips on it for one custom diagram, and the skill
now just notes the gap in its final message instead.

## Reporting generation status from an interactive run

`_register_generate_routes` (`bridge/routes/diagrams.py`) now also registers
`POST /repos/{repo_id}/{kind}/status`, the counterpart to the existing `GET .../status`. It exists
because the "generating" status pipeline (WS `{kind}-status`, `DiagramGeneratingPanel`,
`SkillOutputFeed`) previously only had one driver — `SkillAgent.start()`/`stop()`, which own a
`claude -p` subprocess. That path is headless-only: an *interactive* run (the canvas terminal/agent
window's own Claude Code session doing the work directly, not a spawned subprocess) had no way to
report the same status, so an interactive C1/patterns/impact/custom generation used to run with no
"still working" indicator at all.

`SkillAgent.mark_generating()`/`mark_done()` are a second, process-free driver pair for the same
`self.jobs`/`self.output` state `start()`/`stop()` already own — same WS event shape
(`{"type": f"{kind}-status", **state}`), so `DiagramGeneratingPanel` needed no frontend change. The
skill's own instructions (`references/drawing-rules.md`'s "Bridge contract") tell it to POST
`generating` before writing the skeleton and `idle` once the self-check prints `OK`, or `error` with
a short `detail` if it abandons the run. The existing Stop control (`POST .../cancel` → `stop()`)
already resets a stuck `"generating"` job to idle even when nothing was actually spawned — no new
recovery path was needed for an interrupted interactive run.

🔴 **Both drivers must key `self.jobs`/`_snapshot`/`_restore` by the same id, or they can clobber each
other.** `WorkspaceRegistry.get()` (`workspaces.py`) resolves any unregistered `repo_id` (e.g.
`default`, which a skill's own example calls use) to the same `Workspace` as `main` (which the
canvas's headless button addresses) — same files on disk, different strings. `SkillAgent` used to key
every job by whichever raw `repo_id` string a route happened to pass in, so a headless run under
`main` and an interactive run reporting under `default` looked like two independent, unguarded jobs
against the same artifact; whichever finished with a failing exit code/`has_artifact` check called
`_restore()` and deleted the other one's freshly-written file (caught via wiki-general's
`manifest.json` — see its own doc's "Open items"). Fixed: every route in `routes/diagrams.py`,
`routes/wiki_general.py`, and `routes/epics.py`'s output-key resolver now passes `ws.id` (the
resolved workspace's own canonical id) into `agent.start/mark_generating/mark_done/get_state/
get_output`, never the raw path param.

## Self-check probe parallelism and the C1 fan-out option

⚠ **042-c1-diagram-quality-and-speed removed the BFS/worklist/fan-out material this section
describes from `type-c1.md`.** C1 is now a flat system-context view (system + actors + relations,
authored in one pass, no `/structure` decomposition at all) — see
[`c1-diagram.md`](c1-diagram.md)'s banner and `docs/planning/042-c1-diagram-quality-and-speed/` for
why (an 8-minute run over-decomposing a large monorepo instead of drawing a true C1 view). The
probe-parallelism code below is unchanged and still runs — it is dead weight for a fresh flat C1
file (there are no `dir::` leaves to probe) but still fires correctly against an older or
hand-decomposed `c1.json`, and unchanged for `patterns`/`impact`/`custom`. The fan-out pattern is
gone from `type-c1.md` entirely; if a future C2/C3-style decomposition type is ever built, it would
need to re-document its own version of this rather than resurrecting C1's.

`check_diagram.py`'s C1 self-check used to probe every `dir::` leaf's `UNCOVERED` status one at a
time (up to `UNCOVERED_PROBE_LIMIT = 40` sequential, blocking `urllib.request.urlopen` calls). It now
walks the tree once, network-free, to collect the unique leaf ids (`_collect_dir_leaf_ids`, capped
at the same 40-call budget), then fetches them all in one
`ThreadPoolExecutor(max_workers=PROBE_MAX_WORKERS)` batch (`_make_probe`) before the walk that
consumes them ever runs — the walk itself makes zero network calls. `_dir_leaf_id` is the one
predicate both the collection pass and `_check_leaf` share, so the two can't silently drift apart.
Findings are unchanged; only wall time and call count changed.

`type-c1.md`'s worklist doc used to change alongside it: the documented `structure` fetch depth moved
from `depth=2` to `depth=3` (one round trip covers what used to take two, since the bridge already
caches `structure` responses and supports up to `depth=5`), and the doc told the skill to issue one
BFS layer's independent `structure` calls as parallel tool calls in a single message instead of one
at a time. This whole worklist no longer exists in `type-c1.md` (042, above).

For a monorepo with 3+ independent, sizeable top-level areas, `type-c1.md`'s "Fan-out for independent
branches" subsection used to document a Map-Reduce shape: the main agent resolves the top layer, then
issues one `Agent` call per area (`subagent_type: "general-purpose"`, one id prefix per area) in a
single message; each branch returns a JSON fragment instead of writing the shared artifact itself;
the main agent merges the fragments and authors cross-area relationships last, then runs the
self-check. This was a skill-instruction pattern, not bridge code — no route or `SkillAgent` change
backed it, and no automated test exercised it end-to-end. It's gone as of 042: a flat C1 authors in
one pass, so there's nothing left to fan out over.

## `skill_agent` hardening

- `validate` used to be a bare shape check, so `{"nodes": [{"foo": 1}]}` passed, reported a clean
  `idle` run, and resolved to an empty diagram. `diagram_diagnostics.entries_are_usable` adds "if
  the list is non-empty, at least one entry is a dict with a `str` id". ⚠ An **empty** list still
  passes — writing one is the documented way to clear a diagram.
- 🔴 `_restore` used to no-op when `snapshot is None`, so a failed **first-ever** generation left its
  half-written file on disk for the canvas to render. It now deletes instead.
- ⚠ The restore-before-`has_artifact` ordering at the nonzero-exit branch is **deliberately
  unchanged**. A nonzero exit means the run did not finish; treating whatever JSON is on disk as good
  is exactly how a truncated diagram ships.

## Tests

`tests/unit/test_diagram_check_script.py` (shared tiers, the density family, the `_BUDGETS` ↔
markdown sync assertion) · `test_diagram_check_custom.py` (custom had **no** coverage before) ·
`test_c1_check_script.py` / `test_patterns_check_script.py` / `test_impact_check_script.py`
(retargeted at the unified script and the flat shape, every original case kept) ·
`test_diagram_diagnostics.py` · `test_skill_sync.py` (incl. the retire/prune pass) ·
`test_skill_agent.py` (incl. `mark_generating`/`mark_done`) · `test_bridge_diagram_status_route.py`
(the interactive-run status POST, its WS broadcast, and the B1 stuck-`"generating"`-recovers-via-
cancel regression) · `test_diagram_resolver.py` (the shared `resolve_diagram()`, parametrized per
type) plus each type's own remaining-logic test (`test_patterns_resolver.py`,
`test_custom_diagram_resolver.py`) · `test_diagram_migration.py` (legacy-file conversion) ·
`tests/integration/test_diagram_resolve_parity.py` (SC-001's automated backstop: the new pipeline's
output matches pre-036 golden fixtures) · `tests/contract/test_new_diagram_type_shared_path.py`
(a brand-new custom type needs no code, only content + a style) · `test_recipes.py` /
`test_recipe_routes.py`. Web: `DiagramHealthNote.test.tsx`, `DrawDiagramButton.test.tsx`,
`agentDiagramsReady.test.ts`, `AgentRail.test.tsx`, `AgentWindowLayer.test.tsx`,
`nodeAccent.test.tsx`.

## Highlighting/expanding a process on an already-drawn diagram

`references/highlight-process.md` is a fifth entry point alongside the four `type id` rows, but
it doesn't write a `.codechroma/<kind>.json` — it edits boxes already on the canvas via
`PATCH /repos/{id}/canvas`, so a request like "show me how a request gets saved to the database"
recolors just the relevant boxes instead of regenerating the whole diagram.

🔴 **This needed a real plumbing fix, not just a skill file.** The per-box `style` override
`drawing-rules.md` already documented (`color`/`background`/`border-color`/`border-style`) was
dead for the one-canvas UI: `Element` (`canvas/document.py`) had no `style` field, and neither
`_apply_add_element` nor `_apply_update_element` (`canvas/apply_batch.py`) accepted or persisted
one — it only ever wired into the four old per-view renderers deleted in
016-single-canvas-dashboard Stage 4. `Element.style: dict[str, str] | None` now exists;
`apply_batch.py`'s `_STYLE_ALLOWED_KEYS`/`_sanitize_style` enforce the same 4-key allow-list
`web/src/canvas/authoredStyle.ts`'s `STYLE_ALLOWLIST` already enforced client-side for the old
views — the two must stay in sync by hand, same idiom as `_BUDGETS` ↔ `drawing-rules.md`.
`update_element` treats `style` as a **full replace**, not a merge like `meta` — `style: null`
is how an agent clears a highlight. `CanvasNodeBox.tsx` renders it via `authoredNodeStyle()`
(unchanged, reused from the old views).

⚠ **Two different `style` writers, one field, never fighting.** `highlight-process.md`'s manual
`PATCH /repos/{id}/canvas` and a full recipe regenerate (`build_batch_ops`, 023-unified-recipe-converter)
both end up setting `Element.style` — but a regenerate only emits its own `"style"` op key when the
*diagram JSON itself* authors a `style` on that node (`RecipeNode.style is not None`); when it
doesn't, the key is omitted entirely, never sent as `style: null`. So a highlight applied by hand
survives every unrelated regenerate untouched, and only a diagram JSON `style` (or another manual
`PATCH`) ever overwrites it.

"Expanding" a too-coarse box needs no new plumbing: `add_element`/`add_edge` into an existing
layer already worked (this is exactly what `type-c1.md`'s "Decomposing a box into layers" section
used to describe, before 042-c1-diagram-quality-and-speed removed C1 decomposition entirely — no
built-in type authors this kind of nesting today). A highlighted/expanded box carries the normal
`meta.recipe_key`, so it is a
**temporary annotation, not new authored content** — the next full recipe re-run's ordinary
reconciliation (`canvas/recipes.py`'s `build_batch_ops`) cleans it up automatically, same as any
other AI-owned box the fresh result no longer names.

## Planned block (`meta.plan_kind`) — 055-diagram-feature-plan

A **third** cross-cutting node concept, alongside "highlight" above and the ordinary authored shape:
a node can carry `meta.plan_kind: "add" | "create" | "modify" | "delete"` (the same vocabulary
`plan.json`'s steps use) marking it as part of a **Feature plan** — the field's mere presence is the
marker, no separate boolean. It is **not** the node's own top-level `kind` (that stays a closed
icon-selection vocabulary — `api`/`ui`/`service`/`database`/`queue`/`cache`/`worker`/`auth`, checked
by the self-check's `BADKIND` rule); the two live in different fields precisely so a Planned block
never collides with an ordinary icon-kind node.

- `add`/`create` — code that doesn't exist yet: authored with **no** `path`.
  `diagram_resolver.py`'s `_resolve_node` now also stamps `meta.no_code_reason: "planned"` on it
  (see "No-code boxes" below) — the self-check exemption generalizes to any `no_code_reason`, not
  just a `_plan_kind()` check, but the c1 tree-walk fix this originally required (a path-less nested
  leaf used to be unconditionally flagged `BROKEN`) still traces back to this effort. The exemption
  applies **only** to `add`/`create` — density (`CROWDED`/`EDGEBOMB`) and connectivity
  (`ORPHAN`/`ISLAND`/`DANGLING`) still apply unchanged, since a Planned block is not exempt from
  those, just from the "must resolve to real code" check.
- `modify`/`delete` — existing code the plan will touch: authored **with** a real `path`/`node_id`,
  so neither self-check copy needed a branch for them (an unresolved path on one of these is still a
  genuine authoring bug and still gets `BROKEN`, verified by
  `test_hierarchical_modify_leaf_with_unresolved_path_is_still_broken`/its `check_diagram.py` twin).

**Canvas**: `web/src/canvas/doc/nodeAccent.tsx`'s `accentFor()` gained `planKindClassName` (drives a
dashed border + the app's existing add/modify/delete color palette via `.plan-kind-*` CSS, not a new
one) and a new `PlanKindChip` component (an explicit text chip — a prototype comparing color-only vs
text-labeled treatments showed the role needs to read as text). `CanvasNodeBox.tsx`'s `activate()`
gained an early branch: `plan_kind ∈ {add, create}` opens the existing `descriptionPopupStore` (same
call the "?" button already makes) instead of `InspectorPanel`, since that panel's only fallback for
a node with no `node_id` is "this node no longer exists" — wrong for something that never existed
yet. `modify`/`delete` fall through to the normal `InspectorPanel` path unchanged, since their path
resolves like any other node's.

An optional `meta.details` (richer text than `description`, same fallback rule the retired Plan
overlay's own steps used) is what the description popup shows for `add`/`create` when present.

This is a **schema/self-check/canvas** concern only — the artifact each Planned block lives in (one
per feature/task, `feature-plan/<slug>`) is `graph-bridge-core.md`'s concern (see its own section on
the synthesized `feature-plan/<slug>` kind); the two are independent tickets of the same effort
(`docs/planning/055-diagram-feature-plan/`). Terminology (Feature plan, Planned block, Feature-plan
mode) is fixed in `CONTEXT.md`'s "Feature-plan diagrams" section — this is deliberately separate
from `impact`'s existing `source=plan` mode (untouched by this effort) and the older Plan overlay
(`.codechroma/plan.json`, `plan_resolver.py`'s now-removed `resolve_plan`), which was untouched by
this effort but has since been retired outright — see `change-cards.md`.

## No-code boxes (`meta.no_code_reason`) — unifying "why is node_id null"

Generalizes the Planned block's `add`/`create` exemption above to every box with no resolved
`node_id`, across every diagram type, not just Feature-plan. `diagram_resolver.py`'s `_resolve_node`
(shared by every `DiagramSpec.resolve`) stamps `meta.no_code_reason` on any node that ends up
without a `node_id`, via a new `_stamp_no_code_reason` helper:

- `"planned"` — `meta.plan_kind ∈ {add, create}` (wins over the two buckets below).
- `"unresolved"` — an authored `path` that failed to resolve; `meta.no_code_detail` carries the
  path. The same `unresolved_path` diagnostic still fires, unchanged.
- `"conceptual"` — no `path` authored at all (a C1 actor/system, a Patterns infra/external node, or
  a Custom conceptual box — see drawing-rules.md's "leave null for a purely conceptual box").

Authors never set this themselves for a diagram authored through the normal JSON + resolve flow —
it's computed automatically from `path`/`plan_kind`, the same way `node_id` is. A `CanvasElement`
(`web/src/state/types.ts`) drops `path` entirely once a diagram is spliced onto the canvas, so this
is the only point in the pipeline where "never had a path" vs. "had one that failed" can still be
told apart.

**Self-check**: `bridge/inspect.py`'s `HierarchicalInspector._walk` and its synced `check_diagram.py`
twin (`_walk_hierarchical`) both gained a `_no_code_reason()` reader next to `_plan_kind()`, and key
their nested-leaf `BROKEN` check off it: `"unresolved"` stays `BROKEN`, `"planned"`/`"conceptual"`
don't, and an absent value (a `--json`-loaded raw file, or any hand-built diagram that never went
through the live resolver) falls back to the previous `path`/`node_id`/`plan_kind` heuristic
unchanged. This closes a real bug: before this, a legitimately conceptual **nested C1 leaf** (no
`path`, no `plan_kind` — exactly the drawing-rules.md-sanctioned pattern) was wrongly flagged
`BROKEN`, because the old check only exempted `add`/`create`. The flat-kind check
(`_note_flat_entry`, used by Patterns/Impact/Custom) already only flagged `BROKEN` when a `path` was
authored but unresolved, so it needed no change.

**Canvas**: `nodeAccent.tsx` gained `noCodeReasonClassName` (a dotted border via
`.no-code-conceptual`/`.no-code-unresolved`, distinct from the Planned block's dashed one — muted
`--text-2` for conceptual, warning `--warning` for unresolved) and `NoCodeChip`
(CONCEPTUAL/UNRESOLVED text pill, reusing `LabeledChip`, same shared `.status-chip` shape as
`PlanKindChip`/`ImpactStatusChip`). `CanvasNodeBox.tsx`'s `activate()` gained a second early branch
right after the `plan_kind` one: `no_code_reason ∈ {conceptual, unresolved}` also opens the existing
`descriptionPopupStore`, with `noCodeReasonMessage()` picking an authored `meta.details`/
`description` first, else a reason-appropriate stock message (the failed path appended for
`unresolved`) — instead of `InspectorPanel`'s generic-and-wrong "no longer exists". `"planned"` is
deliberately excluded from the new chip/class/branch — it keeps its own existing
dashed-border/`PlanKindChip` treatment unchanged.

⚠ **The direct `add_element` canvas-ops authoring path (drawing-rules.md's "Drawing a type this
skill does not know") never goes through `resolve_diagram()` at all**, so nothing computes
`meta.no_code_reason` for a box drawn that way — this is exactly the path a real observed incident
came from (a process-trace diagram with every `node_id` left `null`, failing "no longer exists" on
click). `drawing-rules.md` now tells the authoring skill to set
`"meta": {"no_code_reason": "conceptual"}` by hand on such an `add_element` op, so the canvas
renders it identically to a resolver-authored conceptual box.

## Sequence diagram — messages become elements, not edges

`sequence` is the one diagram type where an authored `relations[]` entry becomes a **dedicated
element**, not an edge. The reason is structural: `Edge` (`canvas/document.py`) has no `meta`/`order`,
but a sequence message needs `order` (its time row), `from`/`to` (which participant columns), and
`async`/`return` (arrow shape). Rather than extend `Edge`, `canvas/recipes.py`'s `reshape()` turns each
sequence relation into a `render: "sequence"` element whose `meta` carries all four, and emits **no
edges** for the layer.

- **Backend wiring is the generic one** — one `DiagramSpec` entry (`DIAGRAMS["sequence"]`) + one
  `DiagramTypeDefinition` (`BUILTIN_TYPES["sequence"]`, `context="sequence"`) gives GET/get-path/
  delete routes and the unified `.../context` envelope for free. It resolves through the shared
  `resolve_diagram()` (flat shape), `has_generate=False` (skill-drawn, like patterns/impact).
- **Context is a recorded-trace scaffold**: `_SequenceContextProvider` (context_providers.py) returns
  the traces list plus a reduced participant/message skeleton of the most recent one
  (`_sequence_scaffold`), collapsing distinct caller→callee hops so the skill draws a readable flow
  rather than a huge loop. The AI fills labels, return arrows, and calls the trace's blind spots hid.
- **Frontend renders one whole layer** via `web/src/canvas/doc/SequenceDiagram.tsx` — an
  own-component renderer (`BLOCK_RULES.sequence.renderer === "sequence"`), like `GroupFrame` but
  whole-diagram. It reads `meta.role` (`participant`/`message`), `meta.order` (row), `meta.from`/
  `meta.to` (column lookup by participant `node_id`/recipe key), `meta.async`/`meta.return`. Because
  it computes all geometry from `meta`, it ignores `element.position`/`size` and is `lockedLayout` —
  `autoLayout`'s dagre pass excludes `render === "sequence"` elements.
- **Self-check**: `check_diagram.py --kind sequence` and `inspect.py`'s `FlatInspector` treat it as a
  flat shape (participants = nodes, messages = relations), so duplicate/dangling/island/orphan rules
  apply unchanged. Its budget row (24 participants / 60 messages) is in both `_BUDGETS` and
  `drawing-rules.md`'s table.
- **Mock**: `mockBridge.ts`'s `runRecipe`/`getDiagramsStatus` gained a `sequence` case so the default
  mock mode demos the frontend.

## Impact status chip (`meta.status`) — the ADD/MODIFY/DELETE label

`type-impact.md`'s `meta.status` vocabulary (`"new"` / `"modified"` / `"deleted"` / `"context"`) used
to drive only a 3px left-edge colour accent — no text, easy to miss, and `"deleted"` didn't exist as a
value at all (the skill only ever taught `reason == "added"`/`"modified"`). It's now a visible label,
mirroring `PlanKindChip` above: `nodeAccent.tsx`'s `ImpactStatusChip` renders an `ADD`/`MODIFY`/
`DELETE` pill (`.impact-status-chip*` in `styles.css`) for a box whose `meta.status` is one of those
three, gated on `element.render === "impact"`. `"context"` gets no chip, same as an unrecognized
`plan_kind` gets no `PlanKindChip` — an unchanged box shouldn't shout as loud as a changed one.

`"deleted"` is deliberately **not** aliased to the "changes" overlay's git-derived `"removed"` status
(`STATUS_CLASS_ALIASES` in `nodeAccent.tsx`): `"removed"` means the box's own entity is gone from the
current graph (struck-through, faded — a ghost you can't drill into). An authored `"deleted"` box is
different: the backend never puts a deleted symbol's own node in `impact/context` at all (there's
nothing left to point at); instead the seed's `"deleted"` `reason` is re-pinned onto a *surviving*
ancestor (the containing file/component, or its directory — `impact_context.py`'s `_source_seeds`, via
`change_cards.py`'s `resolve_target` fallback ladder). That box still exists and is still clickable, so
it gets its own `.block-change--deleted` CSS rule (same red as `removed`, but no strikethrough).

`check_diagram.py --kind impact` also gained `_check_impact_status`: a non-blocking advisory
(`NOSTATUS`/`BADSTATUS`) when a node is missing `meta.status` or carries a value outside the four —
nothing previously validated this field, which is exactly why the gap (a skill draft that never wrote
`"deleted"`, and CSS that predated `"new"`/`"context"` having any rule at all) went unnoticed.

### Feature-plan mode: a sixth entry point (tickets 03/04)

`references/feature-plan-mode.md` is the actual skill mode that authors Planned blocks — a sixth
entry point alongside the four `type id` rows and `highlight-process.md`, pointed at by its own
`SKILL.md` section (not one of the router table rows, same treatment as highlighting). Unlike
highlighting, it **does** write a persisted `.codechroma/<kind>.json` (its own
`feature-plan/<slug>.json`), so it needs the routes/self-check/recipe wiring the four rows have and
highlighting doesn't:

- **Target resolution is a skill-instruction policy, not bridge code** (`feature-plan-mode.md`'s step
  3): always check `GET /repos/{id}/feature-plan/<slug>` first (`has_diagram` decides update-vs-fresh
  — never recreate a feature's existing plan); an empty canvas draws fresh with no question asked; a
  non-empty, unrelated canvas asks the user whether to use one of its diagrams as context or start
  from scratch, rather than picking silently.
- **`check_diagram.py --kind feature-plan --slug <slug>`** is a new self-check kind with no saved
  definition to fetch checks from (unlike `custom --type <id>`) — it always resolves to the same
  flat-shape defaults `custom` falls back to when it has no authored `checks`
  (`_default_flat_checks`, factored out of `_fetch_custom_checks`'s existing tail so the two share one
  implementation). Same budgets as `custom` (60/100/40/50); not a new `_BUDGETS` row, so the
  markdown-table drift test (`test_diagram_check_script.py`) needed no change.
- **Delivery has no "Draw" menu to lean on.** A dynamic `feature-plan/<slug>` layer isn't in
  `BUILTIN_RECIPES` and isn't enumerable the way saved custom types are (`GET /diagram-types`), so
  nothing on the canvas auto-triggers its first render. The mode file instead tells the skill to call
  `POST /repos/{id}/recipes/feature-plan/<slug>/run` itself once the self-check passes — the same
  route every other type's "Draw" click already calls, which is what actually broadcasts the
  `"canvas"` WS event a connected canvas renders from (`commit_canvas_batch`), independent of any
  per-kind ping. This needed `canvas/recipes.py`'s `recipe_for()` to gain a `feature-plan/` branch
  (mirroring its `custom/` one — see `graph-bridge-core.md`) and
  `web/src/canvas/doc/diagramCatalog.ts`'s `isRecipeBackedLayer`/`labelForDiagramLayer` to recognize
  the prefix too, so the Diagrams tab's collapse/expand refresh and label work for it like any other
  recipe-backed layer.
- **The status-reporting convention doesn't apply.** `drawing-rules.md`'s Bridge contract tells every
  type to POST `{"state":"generating"}`/`"idle"` around its write — `feature-plan/<slug>` has no
  generate/status/output routes at all (`has_generate=False`, it never auto-generates), so
  `feature-plan-mode.md` explicitly tells the skill to skip that step instead of 404ing on it.
- **"Survives a regular regenerate" needed no new code**, only documentation: `build_batch_ops`
  already reconciles one recipe's own `layer` and nothing else, so a Planned block under
  `feature-plan/<slug>` was already immune to `c1`/`patterns`/`custom` regenerating, regardless of
  which of them supplied the copied context.

Tests: `tests/contract/test_feature_plan_routes.py` (the two new routes, the recipe run end-to-end,
plus the `context`/`review` reserved-slug regression -- see `graph-bridge-core.md`'s 🔴 ROUTERS-order
note), `test_recipes.py` (`recipe_for`/`render_for`'s `feature-plan/` branch),
`test_feature_plan_check_script.py` (the new self-check kind), `diagramCatalog.test.ts`
(`isRecipeBackedLayer`/`labelForDiagramLayer`), `test_skill_sync.py` (the reference file ships).

## Delivery: making a drawn diagram actually appear

Separate from authoring, and the reason a user could ask for a diagram and see nothing:

- `DrawDiagramButton` (`RecipeMenu.tsx`'s replacement — see `single-canvas.md`) subscribes to the
  per-kind `subscribeDiagram` pings, so a kind flips to ready without any user action needed. ⚠
  Custom sends one coarse `{"type": "custom"}` ping (never `custom/<id>`), so that branch also
  refetches the type list; `DiagramEventKind` gained the bare `"custom"` literal.
- `DrawDiagramButton`'s `refetchStatus` auto-adds **every** kind that becomes ready and isn't yet on
  the canvas, with no pending-request gate (`canvas/doc/pendingDrawRequests.ts` was removed). The
  add is unconditional so a diagram drawn by *any* path appears — the "Draw…" button, a
  terminal/agent-window run on the same workspace, another agent. It stays safe because pings are
  scoped per-workspace (`isForAnotherWorkspace`) and `refetchStatus` only fires on a not-ready→ready
  transition for a kind `!placed.has(kind)`, so an unrelated artifact change never redraws the canvas;
  the `before === null` guard also means a first-ever visit adds nothing.
- The brand-new-draw path is one thing; editing a diagram already on the canvas (e.g. adding a
  `style` to an existing C1 block) is another — a content edit doesn't flip `ready`, so it used to sit
  invisible until the user removed and re-added the layer by hand. `get_diagrams_status` now also
  returns each kind's content `fingerprint` (`_content_fingerprint` in `bridge/routes/diagrams.py`, a
  `hash_lines` hash of the raw diagram JSON); `DrawDiagramButton.tsx`'s `refetchStatus` re-runs the
  recipe for any kind already placed on the canvas whose fingerprint just changed — a recipe re-run
  only ever touches content fields, never position/size (`recipes.py`), so it is never a surprise,
  just the picture catching up with what is already on disk.
- 🔴 A "Draw…" task launched from a **read-only PR workspace** is forked into its own worktree, so the
  skill writes where the canvas is not looking. `agents/agentDiagramsReady.ts` checks that agent's
  own workspace on the working→idle transition and badges its `AgentRail` row
  (`agentStore.diagramsReady`). It skips the check when the agent shares the active workspace, where
  the two mechanisms above already handle it.
- 🔴 **The fingerprint-diff auto-refresh above only fires on a *transition*** (`DrawDiagramButton.tsx`'s
  `refetchStatus`: `before`, the previous status fetch, held in an in-memory `lastStatusRef`). A
  plain in-memory ref resets on every page reload, so the very first status fetch after a reload
  always had `before === null` and the function returned before ever computing `stale` — an edit an
  agent made before the reload stayed invisible until the diagram was removed and re-added by hand
  (the fix this whole section describes never actually covered a reload). Fixed by
  `canvas/doc/diagramStatusCache.ts`, a thin `sessionStorage` cache of the last-seen `DiagramsStatus`:
  `lastStatusRef` now seeds from it instead of `null`, and every fetch writes its result back. A truly
  first-ever visit (nothing cached yet either) still has no baseline and is still skipped, same as
  before — there is nothing to compare it against.
- 🟢 **A first draw never flashes the recipe's transient `(0,0)` pile.** A recipe run creates its boxes at
  `(0,0)` and that commit's canvas ping can land on screen before `runRecipeAndLayout`'s layout pass
  repositions them — the "pile when redrawing" a fresh diagram. `runRecipeAndLayout` defers its layer
  (`canvasDocStore.deferLayout`), and `fetchAndApplyCanvasDoc` withholds any snapshot whose elements
  for a deferred layer are all still at `(0,0)` — so the pile never flashes, while a real move (a
  drag, an edit on another layer) still applies; the layout PATCH that follows lands the laid-out
  positions and applies them through the same shared path. Because the guard checks the *content*
  (origin-piled) rather than mere in-flight-ness, it drops only the transient state, never an
  unrelated user write. The direct-`PATCH` fallback path (`drawing-rules.md`'s "type this skill does
  not know") is separately protected: `apply_batch.py` gives a position-less `add_element` a
  server-side cascade (`_DEFAULT_ADD_STEP_*`) instead of `(0,0)`.
- **A fourth trigger: expanding a collapsed diagram from the Diagrams tab.** `AgentRail.tsx`'s
  `onToggleLayer` calls `runRecipeAndLayout` (`diagramCatalog.ts`'s shared function — also what the
  Diagrams tab's remove-then-redraw flow uses) whenever a click flips a
  layer from collapsed to expanded — never on collapse, which has nothing to refresh. This is an
  unconditional re-run, not a fingerprint check: expanding is a deliberate, low-frequency user action,
  so there is no need to gate it the way the automatic triggers above are gated. `refreshingLayer`
  disables that one row's button while its own refresh is in flight; `diagramRefreshError` renders a
  hard failure inline (`data-testid="diagram-rail-error"`) — this tab has its own error slots per
  action now (add/remove/delete/refresh), unlike `DrawDiagramButton`'s single inline error.
- 🔴 **The Diagrams tab's row list used to hide any layer that wasn't a `BUILTIN_RECIPES` name or a
  `custom/<id>`.** `listActiveDiagramLayers` (`diagramCatalog.ts`) filtered against that fixed
  allow-list, but `PATCH /repos/{id}/canvas` accepts any `layer` string (`routes/canvas.py`,
  `drawing-rules.md`'s "Drawing a type this skill does not know" step 3) — a one-off diagram a
  skill/agent drew straight onto the canvas with its own freeform layer name existed for real but
  never appeared as a row. Fixed to exclude only `hierarchy`/`default` (`NON_DIAGRAM_LAYERS`) instead
  of allow-listing; every other layer is a diagram. That freeform kind of layer has no backing recipe
  to reconcile against, though, so expanding it must not call `runRecipeAndLayout` the way a builtin/
  custom row does — `isRecipeBackedLayer` (same file) gates `onToggleLayer`'s refresh call on exactly
  the old allow-list check, so expanding a freeform row is a pure visibility toggle instead of a 404.
  Regression tests: `diagramCatalog.test.ts`'s freeform-layer case,
  `AgentRail.test.tsx`'s "expands a one-off, non-recipe-backed layer without calling the recipe
  route".

## Corrections from a real trial-and-error run (2026-09)

A real session drawing a `custom` diagram surfaced skill-text gaps the fixes below closed:

- **"Deepen, don't restart" is gone.** SKILL.md and every `type-*.md` used to require reading
  whatever diagram/canvas state already existed before writing, to avoid clobbering hand edits.
  Removed at the user's request (accepted trade-off: a rerun can now overwrite prior edits/ids) —
  `feature-plan-mode.md`'s own target-resolution check (step 3) is untouched, since removing it there
  would also break its slug-collision guard (step 2 depends on it), a different job from "don't lose
  edits".
- **Step 0/Step 1 of the Wiki-first fetch order are now stated as both-mandatory**, not "Step 0, then
  Step 1 if needed" — the real run skipped Step 1 because Step 0 alone looked sufficient.
- **`drawing-rules.md`'s "Drawing a type this skill does not know" step 3 now ships a verified,
  working `PATCH /repos/{id}/canvas` example** (field names checked against `apply_batch.py`/
  `document.py`): `render` must be one of `RENDER_KINDS` (`"custom"` for an ordinary box, not
  `"box"`/`"node"`/`"shape"`), `temp_id` is a self-chosen scratch id for same-batch cross-references,
  and the delete op is `delete_element` (not `remove_element`) keyed by `id`. The real run burned
  ~14 trial-and-error `curl` calls discovering these by hand.
- **SKILL.md's disambiguation table gained a "nothing above fits" row** pointing straight at
  `## Fallback`, instead of that path only being reachable by reading to the bottom of
  `drawing-rules.md`.
- **The fallback path gained a documented manual self-check** (step 6 in "Drawing a type this skill
  does not know") — `BROKEN`/`DANGLING`/`ORPHAN`/`DUPLICATE`, read off a post-batch
  `GET /repos/{id}/canvas` — since there is no `.codechroma/<kind>.json` file for
  `check_diagram.py` to fetch on this path.
