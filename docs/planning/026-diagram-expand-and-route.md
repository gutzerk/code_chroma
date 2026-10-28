# 026 — Diagram expand in place (A4) and route overlay on the code map (B2)

Status: In progress (Stages 1-3 built and tested; Stage 4, drawing the real wiki-general flow through the skill, is open)

Source: two boards of the "Diagram Readability Options" design canvas (https://claude.ai/artifact/JBQvJ1EMpwBCNPRAd4eSbQ): "A4 · Glance + expand in place" (`VariantExpand.dc.html`) and "B2 · Code map + route overlay" (`AltRouteMap.dc.html`). Both were deliberately left out of `docs/planning/022-diagram-readability.md` ("revisit after Stage 2; they depend on lanes being reliable"). Stage 2 (lanes, `order`, block anatomy) and the ▶ player have landed, so this plan picks them up. Builds on `docs/architecture/diagram-skills.md`, `web-canvas-shell.md`, `trace.md`, `wiki-general.md`.

Both boards draw the same example: the "Update the architecture map" flow of wiki-general (click Update, refresh graph, re-cluster, diff vs manifest, apply edits, rewrite pages with Claude, self-check, verify, stamp). Use it as the acceptance fixture.

## Problem

A process diagram shows steps, but the reader cannot see what code runs inside a step without leaving the diagram, and a code map (the folder/file hierarchy) shows where code lives but not in which order it runs. The two boards solve this from opposite ends:

- **A4** keeps the process diagram and lets one step expand in place into the functions it calls (with `file:line` links).
- **B2** keeps the code map and lays the process route over it, so the route lights up the files it touches and the rest of the code stays visible but dimmed.

## Delivery order

Stage 1 first (data), then Stages 2 and 3 in parallel or either order, then Stage 4 as the acceptance pass. Each stage lands as its own PR with its docs; the Python and C# resolvers change together in Stage 1.

## Goal

After 5 seconds a reader can name the first step, the AI step, and the result (the 022 test), and in 10 more seconds can open the function behind any step (A4) or see which files a flow touches (B2).

## Decision: two features, one shared data model

Both need the same new data: a **route** — an ordered list of steps, each step pointing at the code it runs. Build the data first (Stage 1), then the two views on top of it. They ship independently after Stage 1.

| | A4 expand in place | B2 route overlay |
|---|---|---|
| Base view | the process diagram (lanes, steps) | the code map (folder/file hierarchy) |
| What a step shows | a one-line summary; expands into its functions | a numbered marker on the file(s) it runs in |
| Rest of the code | not shown | dimmed but present |
| Interaction | `▸` expands a step, `↗` opens the source | `▶ Walk the route`, a ROUTE card with the step list |
| Needs | steps with children and `file:line` | steps with the files they touch |

## Data model (new, shared)

A route lives in the process diagram JSON (type `process` / `custom`), next to the existing `order` and `lane` on nodes. Do not invent a second file.

- Top-level `route`: `{ id, title, summary, steps: [...] }`. `summary` is the "8 steps · 5 files · 1 AI step" line on the ROUTE card and is derived, not authored.
- Each step: `{ id, order, lane, title, kind, node_ids: [...], children: [...] }`.
  - `kind`: `trigger | decide | ai | check | data | failure` (the lanes and legend of A4: actor/trigger, logic with no AI, AI step, check, data written, failure).
  - `node_ids`: graph node ids of the files/functions the step runs in (this is what B2 lights up).
  - `children`: ordered sub-calls `{ id, label, node_id, line }`, e.g. `ComputeDelta()` `:184` with the one-line "what it does" (A4's expanded step).
- Edges keep the existing `kind` vocabulary (`calls`, `spawns`, `data`, `minor`, `removed`) and `hero` for the main path. A `failure` branch is an edge with `kind: "error"` semantics on a `failure`-kind step.

Decided (Decisions 1): `route` stays inside the diagram file. B2 reads it from the diagram through `routeStore`, so one authored route serves both views without a second file or a second staleness fingerprint.

## Stage 1 — Route data from the skill and the resolvers (about 2-3 days)

Files: `skills/codechroma-draw-diagram/` (`SKILL.md`, `references/type-custom.md` or a new `type-process.md`, `process-bare.md`, `references/drawing-rules.md`, `scripts/check_diagram.py`), `src/codechroma/diagrams/`, `src/codechroma/bridge/diagram_diagnostics.py`, `dotnet/CodeChroma.Bridge/Diagrams/DiagramResolver.cs`, `dotnet/CodeChroma.Bridge/Stores/Recipes.cs`, `tests/fixtures/bridge_contract/`.

1. Document `route`, step `kind`, `node_ids`, `children` in the skill references, with the wiki-general update flow as the worked example.
2. `check_diagram.py`: validate step ids/orders are unique and contiguous, `node_ids` exist in the context cache or are flagged as unresolved (advisory), `children[*].line` is a positive integer. Do not require a fixed number of steps per lane or per `kind`. Keep every new check advisory-only like `BADEDGEKIND`.
3. Both resolvers pass `route` into the canvas element `meta` of the step nodes and the diagram frame (same pattern as `phases`/`frames`/`notes` for sequence). Python and C# stay in step; add a shared case in `tests/fixtures/bridge_contract/`. Record any deliberate gap in `docs/planning/012-csharp-bridge.md` and say so in the final report.
4. Resolve `node_ids` and `children[*].node_id` to graph nodes through the existing context cache / `resolve` path (`docs/architecture/context-tool.md`) so each step carries a real `path` and `line` where the resolver can find one.
5. Tests: `tests/unit/test_diagram_check_script.py`, `tests/unit/test_diagram_advisories.py`, the C# contract tests. Docs: `diagram-skills.md`.

Exit check: re-draw the wiki-general update flow and confirm `route.steps[*].children` and `node_ids` land in `meta` in both bridges.

## Stage 2 — A4: expand a step in place (about 3 days, after Stage 1)

Files: `web/src/canvas/doc/CanvasNodeBox.tsx` (or a new `RouteStepBox.tsx` rendered through the existing role/variant path), `web/src/canvas/doc/nodeAccent.tsx`, `web/src/canvas/connectors/elkLayout.ts`, `web/src/canvas/doc/canvasDocStore.ts`, `web/src/styles.css`.

1. A step box in `glance` form: number, title (4 words or fewer), one-line summary, `kind` colour (reuse the role colours from the 022 board pass), `▸ N calls` chip and `↗` to open the source. This is the 022 block anatomy plus the chip.
2. Expansion state: a small store (like `impactExpandStore`, per diagram layer, in memory only) so an expanded step survives re-render but not reload. There is no expand-in-place mechanism on diagram boxes today (the 022 block pass could only open the inspector from the members chip); this is the first one, so build it once and reuse it for the `▸ N members` chip.
3. Expanded form: the step grows into a list of its `children` (label, `:line`, short note) with each row a click target (`↗` opens that function in the inspector). Layout must grow the box and push neighbours; do it through the layout pass, not by overlaying (a derived geometry, never persisted per mode, same rule as the sequence modes in 022).
4. Lanes: the A4 board is lane-banded (01 You / Git, 02 Bridge, 03 Claude CLI, 04 data, EX failures). Use the Stage 2 lane layout in `elkLayout.ts`; add a `Failures` band for `failure` steps.
5. Legend card as drawn on the board (step order, expand, open source, actor, entry route, logic, AI step, check, data written, failure, main path, call inside a step, side effect, failure branch).
6. Tests: unit tests next to the new component; a Playwright journey that draws the fixture, expands a step, opens a child, and checks no console error. Docs: `web-canvas-shell.md`, `diagram-skills.md`.

## Stage 3 — B2: route overlay on the code map (about 3-4 days, after Stage 1; independent of Stage 2)

Files: the code map is the hierarchy canvas, not the diagram layer. Look at `web/src/canvas/RouteProbeOverlay.tsx`, `TraceFlowOverlay.tsx`, `TraceControls.tsx`, `canvasOverlay.ts`, `web/src/state/expansionState.ts`, `traceStore.ts`, `routeProbeStore.ts` and the existing `▶` player in `SequenceReadable.tsx`/`sequenceViewStore.ts` before designing; they already solve "draw an ordered path over visible nodes with collapsed ancestors" and "walk it step by step".

1. A `routeStore` (active route, current step, walking flag), modelled on `traceStore`/`routeProbeStore`.
2. Overlay: for the active route, light up the files/folders in `steps[*].node_ids` (reuse `resolveVisibleEdges` so a hop to a collapsed file lands on its nearest visible ancestor), draw numbered markers and the connecting path, and dim every other block to the existing "faded" level (35%, same token as focus mode). The rest of the code must stay present and clickable.
3. ROUTE card (the board's right panel): title, "N steps · N files · N AI steps", the step list with kind colours, `Click Update` / failure rows (`✕ busy → 409`), and a `▶ Walk the route` button that steps through `order` and scrolls/zooms to each step's files. Reuse the player logic from the sequence ▶ player where possible.
4. Entry point: a "Show route" action on a process diagram (and a route picker when a repo has several), so the user can jump from a process step to the code map with the route already active.
5. Tests: store tests, overlay tests (jsdom has no `getBBox`; follow how `TraceFlowOverlay.test.tsx` mocks it), a Playwright journey. Docs: `web-canvas-shell.md`, `trace.md` (state the difference from the execution trace: this route is authored, the trace is captured).

## Stage 4 — Wire the wiki-general flow as the real fixture (about 1 day)

Draw the wiki-general update flow for real through the skill (not hand-written JSON), commit nothing generated, and check both views read it. Compare with the two boards side by side; list remaining gaps in this file.

### Stage 4 result (run against the C# bridge on this repo)

The flow was drawn as a custom `update-map` diagram (9 steps over 5 real files, lanes You / Bridge / Claude CLI / Failures, children with real `file:line` from `WikiGeneralUpdate.cs`, `WikiGeneral.cs`, `SkillAgent.cs`, `WikiGeneralRoutes.cs`, `WikiGeneralNotice.tsx`) and `check_diagram.py` printed `OK`. In the browser it rendered with lanes, `▸ N calls` chips and an expanded `Diff against manifest` listing `ComputeDelta() :184` with neighbours pushed down. Nothing generated was committed. Gaps found:

- The recipe route (`/recipes/.../run`) loaded the raw artifact, so `meta.route_step.resolved` and a child's `path`/`resolved_line` were absent on canvas elements. Closed by `026-tasks/01-single-route-copy.md`: the C# recipe route now resolves custom diagrams, and the route rides once on a `render: "route"` carrier element (nodes keep `route_id` and `route_step`).
- Ids are `component::<path>` (file level), so `resolved` has `path` but no `line`, and `line_mismatch` cannot fire; the authored `:line` stays the only line.
- The code-map half could not be shown on this repo: expanding `dotnet/` in the Files tree failed with a JSON parse error from the bridge (`children of dir::dotnet`), unrelated to routes. The overlay is covered by the unit and Playwright tests instead.
- The ROUTE card sat under the agents panel on a wide canvas; it is now offset by the left panel like the other canvas notes. Diagram boxes sharing a `data-node-id` are no longer lit or faded.
- The 5-second test and the side-by-side comparison with the two boards were not done (needs a person).

## Out of scope

- The Avalonia canvas (`dotnet/CodeChroma.Canvas*`): `web/` stays the reference. Track the port in `013-avalonia-canvas.md` after Stages 2-3 land.
- Executing or tracing the route automatically: the route is authored by the skill; the execution trace (`docs/architecture/trace.md`) stays a separate feature.
- Inter font and other global theme changes.

## Decisions

1. **Route location: inside the process diagram JSON.** One file, and the existing fingerprint staleness (`skill-artifact-merge.md`) covers it. "Show route" on a diagram hands that diagram's `route` to `routeStore`, so no redraw is needed. If a route must later exist without a diagram, extracting it into `route.json` is a mechanical move because the shape is self-contained; not built now.
2. **B2 base map: the existing hierarchy canvas** (folders/files). The board labels (`dotnet/CodeChroma.Bridge`, `Routes/WikiGeneralRoutes.cs`) match it, and `resolveVisibleEdges` plus the trace/route-probe overlays already work there. The wiki-general C2/C3 map is not a target.
3. **`children`: written by the skill by hand first.** Keep the shape `{ id, label, node_id, line }` so a later resolver pass can fill or refresh it from the context cache without a format change. Stage 1 step 4 resolves `node_id` to a real `path`/`line` where it can, and the advisory check flags a child whose resolved line differs from the authored one (stale hint).
4. **Expanded-step state: in memory only**, per diagram layer, lost on reload, like other expansion state.

No open questions remain; Stage 1 can start.

## Done when

- A re-drawn wiki-general update flow carries `route`, step `kind`, `node_ids` and `children` in both bridges, and the self-check validates them.
- On the process diagram, a step expands in place into its functions with working `↗` links, and the layout makes room without overlap.
- On the code map, "Show route" lights up the files of the route in order, dims the rest, and `▶ Walk the route` steps through them with no console error.
- The 5-second test passes on the wiki-general flow in both views.
- All affected architecture docs are updated in the same changes.
