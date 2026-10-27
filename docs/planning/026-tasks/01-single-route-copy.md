# 026 task 01: store a route once per diagram, not on every node

Status: Done (branch `feat/026-single-route-copy`). Decision: option (b), a carrier element per layer; the web store splits carriers out of `doc.elements`, so no per-consumer exclusions were needed. Parent plan: `docs/planning/026-diagram-expand-and-route.md`. Branch base: PR #317 (`feat/diagram-board-styles`), where the route feature already lives.

## Problem

Today the bridge copies the whole authored `route` (all steps, their `children`, `resolved`) into the `meta.route` of **every** node of the diagram, and `meta.route_step` into the node whose id equals a step id. For a diagram with N nodes and S steps the canvas document, the websocket payload and every saved file carry N full copies of the route. The "N steps · N files · N AI steps" summary is also computed in the canvas reshape step, not next to where steps are resolved.

Where it happens now:

- Python: `src/codechroma/canvas/recipes.py` - `_route_summary`, `_with_route`, called from `reshape()`.
- C#: `dotnet/CodeChroma.Bridge/Stores/Recipes.cs` - `RouteSummary`, `WithRoute`, called from `Reshape()` (one `DeepClone` of the route per node).
- Resolution of steps (`resolved`, child `path`/`resolved_line`/`line_mismatch`): `src/codechroma/bridge/diagram_resolver.py` (`_resolve_route`, `_locate`) and `dotnet/CodeChroma.Bridge/Diagrams/DiagramResolver.cs` (`ResolveRoute`, `Locate`).
- Web readers: `web/src/canvas/doc/routeStep.ts` (`routeOf`, `routeStepOf`, cached per raw meta object with a `WeakMap`), `DiagramFrame.tsx` (finds the route on any member), `RouteCard.tsx` (`collectRoutes` over all elements), `CanvasNodeBox.tsx` (reads `routeStepOf`).

## Goal

The route exists **once** in the canvas document. A node carries only what is its own: `meta.route_step` (its step) and a reference `meta.route_id`. The derived summary is computed once, in the resolver, from the resolved steps.

## Design (decide, then do)

1. **Where the single copy lives.** Pick one and write the choice into the plan doc before coding:
   - (a) a document-level map `routes: { <route_id>: Route }` on `CanvasDoc` (needs a doc schema bump and an `apply_batch` op), or
   - (b) a dedicated carrier element per diagram layer (`render: "route"`, not drawn, `meta.route`), found by layer.
   Recommendation: (b), because it needs no document schema change and layer deletion already removes it with the diagram. Check `docs/architecture/single-canvas.md` for how layer-owned elements and `created_by` reconciliation work (`Recipes.cs` `BuildBatchOps`, `recipes.py` `build_batch_ops`) so a re-run updates it in place and a removed route deletes it.
2. **Summary in the resolver.** Move `_route_summary`/`RouteSummary` into the resolver (`resolve_diagram` / `DiagramResolver.Resolve`), computed from resolved steps; count **distinct** resolved `path`s for "files" (today it counts distinct `node_ids`). Stamp it as `route.summary`. The recipe route (`/recipes/<kind>/run`) loads the raw artifact through `RawDiagramResolver` (`Routes/RecipeRoutes.cs`) and never calls the resolver, which is also why `resolved` is absent on canvas elements today. Fix that here: the recipe path must run the same resolution as `GET /custom/<id>`, or the carrier element never gets resolved data.
3. **Wire format.** Per-node `meta.route_step` keeps its current shape (id, order, lane, title, kind, node_ids, children, resolved). Add `meta.route_id`. Remove `meta.route` from nodes.

## Both bridges, one contract

Repo rule (`AGENTS.md`): bridge changes land in Python and C# together with a shared case in `tests/fixtures/bridge_contract/*.cases.json`.

- Update the existing case `a_route_rides_on_each_node_meta_with_a_derived_summary` in `tests/fixtures/bridge_contract/recipes.cases.json` (rename it) to assert: one carrier element per layer with `meta.route.summary`, nodes have `route_step` and `route_id`, and **no** node has `meta.route`.
- Add a case in `tests/fixtures/bridge_contract/diagrams_resolved.cases.json` asserting the summary counts distinct paths.
- Unit tests: `tests/unit/test_recipes.py`, `tests/unit/test_diagram_resolver.py`, `dotnet/CodeChroma.Bridge.Tests/Stores/CanvasUnitTests.cs`, `dotnet/CodeChroma.Bridge.Tests/Diagrams/RouteResolveTests.cs`.

## Web side

- `routeStep.ts`: `routeOf(element)` becomes a lookup by `meta.route_id` against the carrier element (pass the doc or a selector; keep the `WeakMap` cache for parsing).
- `DiagramFrame.tsx`: read the layer's carrier instead of scanning members.
- `RouteCard.tsx`: `collectRoutes` iterates carrier elements only (cheap, no per-node parse).
- The carrier must not render: add `route` to `BLOCK_RULES` in `web/src/canvas/doc/elementRules.ts` with `renderer: "none"` (see how `"hierarchy"` is treated in `CanvasDocView.tsx`), and exclude it from `diagramDisplayName` box counts, `unionBoundsOf`, lane/island buckets, marquee select and `FocusPanel`.
- Update tests that seed `meta.route` per box: `web/e2e/route-steps.spec.ts`, `RouteStepBox.test.tsx`, `RouteOverlay.test.tsx`, `RouteCard.test.tsx`, `routeExpansion.test.ts`.

## Done when

- A 40-node diagram with a 10-step route serializes the route once (assert in a test by counting occurrences in the canvas JSON).
- Python and C# produce identical canvas output for the shared cases.
- `resolved`, child `path` and `resolved_line` reach the canvas (closes the gap recorded under "Stage 4 result" in the plan).
- `dotnet test dotnet/CodeChroma.Bridge.Tests`, `pytest tests/unit tests/contract -k "route or recipes or diagrams_resolved"`, `npx vitest run`, `npx tsc -b`, `npm run e2e -- e2e/route-steps.spec.ts` all pass.
- `docs/architecture/diagram-skills.md` ("Route (026)" section) and `docs/architecture/web-canvas-shell.md` describe the new shape.

## Out of scope

Route authoring format in the skill (`skills/codechroma-draw-diagram/references/type-custom.md`) does not change; `route` stays inside the diagram JSON.

## Risks

- Existing canvases hold old documents with `meta.route` on nodes; keep `routeOf` tolerant of the old shape for one release, or the next recipe run replaces them anyway (reconciliation updates elements it owns).
- Reconciliation deletes elements missing from a run: make sure the carrier is part of every run's output so it is not mass-deleted by the guard in `BuildBatchOps`.
