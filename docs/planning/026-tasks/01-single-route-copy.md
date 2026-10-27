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

## Design (as shipped)

1. **Where the single copy lives.** A carrier element per diagram layer (`render: "route"`, key `__route__::<route id>`, `meta.route` + `meta.route_id`). No document schema change; layer deletion removes it with the diagram. Both bridges append it in `reshape` after the nodes, parsing the route once (`_route_parts` / `RouteParts`).
2. **Summary in the resolver.** `route_summary` / `DiagramResolver.RouteSummary` count distinct resolved `path`s; a step with no string path falls back to its `node_ids` (same rule in both bridges). A raw (unresolved) artifact gets the summary filled at reshape time.
3. **Recipe path resolves.** `RawDiagramResolver` resolves `custom/<id>` (with a definition) and `feature-plan/<slug>` like their `GET` routes, so `resolved`, child `path` and `resolved_line` reach the canvas. c1/patterns/impact/epics stay raw in the C# recipe path until their resolvers are ported (gap, recorded in `docs/planning/012-csharp-bridge.md` terms: Python resolves them through `resolve_diagram`).
4. **Wire format.** Nodes carry `meta.route_step` and `meta.route_id`; `meta.route` lives only on the carrier.

## Both bridges, one contract

Repo rule (`AGENTS.md`): bridge changes land in Python and C# together with a shared case in `tests/fixtures/bridge_contract/*.cases.json`.

- Update the existing case `a_route_rides_on_each_node_meta_with_a_derived_summary` in `tests/fixtures/bridge_contract/recipes.cases.json` (rename it) to assert: one carrier element per layer with `meta.route.summary`, nodes have `route_step` and `route_id`, and **no** node has `meta.route`.
- Add a case in `tests/fixtures/bridge_contract/diagrams_resolved.cases.json` asserting the summary counts distinct paths.
- Unit tests: `tests/unit/test_recipes.py`, `tests/unit/test_diagram_resolver.py`, `dotnet/CodeChroma.Bridge.Tests/Stores/CanvasUnitTests.cs`, `dotnet/CodeChroma.Bridge.Tests/Diagrams/RouteResolveTests.cs`.

## Web side

- `canvasDocStore.setDoc` splits carriers out of `doc.elements` (exposed via `useRouteCarriers`), so layout, bounds, lanes, marquee and `FocusPanel` never see them; `CanvasDocView` also returns null for the `"none"` renderer as a backstop.
- `routeStep.ts`: `routeFor(box, carriers)` resolves the layer's carrier by `meta.route_id`; a box without a `route_id` still reads a legacy `meta.route` (old saved documents).
- `DiagramFrame.tsx` asks `routeFor` once, for the first member that names a route.

## Done when

- A 40-node diagram with a 10-step route serializes the route once (assert in a test by counting occurrences in the canvas JSON).
- Python and C# produce identical canvas output for the shared cases.
- `resolved`, child `path` and `resolved_line` reach the canvas (closes the gap recorded under "Stage 4 result" in the plan).
- `dotnet test dotnet/CodeChroma.Bridge.Tests`, `pytest tests/unit tests/contract -k "route or recipes or diagrams_resolved"`, `npx vitest run`, `npx tsc -b`, `npm run e2e -- e2e/route-steps.spec.ts` all pass.
- `docs/architecture/diagram-skills.md` ("Route (026)" section) and `docs/architecture/web-canvas-shell.md` describe the new shape.

## Out of scope

Route authoring format in the skill (`skills/codechroma-draw-diagram/references/type-custom.md`) does not change; `route` stays inside the diagram JSON.

## Risks

- Existing canvases hold old documents with `meta.route` on nodes; `routeFor` tolerates that shape and the next recipe run replaces it.
- Reconciliation deletes elements missing from a run, so the carrier is part of every run's output and is not mass-deleted.
