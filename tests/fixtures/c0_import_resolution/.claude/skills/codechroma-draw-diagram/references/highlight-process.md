# Highlighting or expanding a process — not a new diagram

Read `drawing-rules.md` first — the bridge contract, density budgets, icons and the per-box
`style` rule live there and are not repeated here.

Use this when the request is to **explain, show, or trace a specific process or flow** on a
diagram already on the canvas — "show me how a request gets saved to the database", "highlight
the auth check", "walk me through the retry path". This is **not** one of the four `type id`
rows in `SKILL.md`'s router: you are not writing a new `.codechroma/diagrams/<kind>/<kind>.json`, you are editing
boxes that already exist on the canvas.

## Steps

1. **See what's already there.** `GET /repos/${CODECHROMA_WORKSPACE_ID:-default}/canvas` for the
   current elements — their `id`, `node_id`, and `meta.recipe_key`. You can only highlight or
   extend boxes that already exist; if nothing relevant is on the canvas yet, tell the user to
   draw the diagram first (the router table) instead of inventing boxes from nothing.
2. **Trace the real process.** Same context sources every type already uses — `dependency-digest`
   and `structure` (plus `patterns/context`/`impact/context` if the current diagram is one of
   those kinds) — to find the real call chain. Never guess an id; copy `node_id`/`path` verbatim,
   same rule as every other type.
3. **Highlight the matched boxes.** `PATCH /repos/{id}/canvas` with one `update_element` op per
   matched box, setting `style` to an allow-listed `background`/`color`/`border-color`/
   `border-style` (prefer theme vars, e.g. `var(--accent)`) — see `drawing-rules.md`'s style rule.
   Leave every other box untouched: don't touch `position`/`size`, and don't re-run the diagram's
   recipe. Only the boxes on the path should visibly change.
4. **Expand a box that's too coarse.** If a matched box collapses several real steps of the
   process (e.g. one "Backend" box hides handler → service → repository → db client), decompose
   it exactly the way `type-c1.md`'s "Decomposing a box into layers" already does: `add_element`/
   `add_edge` ops for the missing steps, real `node_id`s copied verbatim, tagged
   `created_by: "ai"` and a `meta.recipe_key` like normal recipe output. Stay inside the current
   diagram kind's own density budget — zooming into one flow is not a license to redraw the
   whole thing.
5. **This is a temporary annotation, not new authored content.** Because the added/highlighted
   boxes carry a normal `meta.recipe_key`, the next time the user fully regenerates that diagram
   kind, the ordinary reconciliation rule in `canvas/recipes.py` (`build_batch_ops`) cleans them
   up automatically — an AI-owned box whose key the fresh result no longer has gets deleted. If
   the user wants a decomposition to stick around permanently, that's a real authoring request:
   send it through the diagram's own `type-*.md` flow instead of this shortcut.
6. **Clearing a highlight.** `update_element` with `style: null` on a highlighted box restores
   it to normal; `delete_element` removes a box added purely for the expansion.

## No dedicated self-check

This isn't a persisted `.codechroma/diagrams/<kind>/<kind>.json`, so `check_diagram.py` has no mode for it. Just
confirm the `PATCH` response has `"ok": true` — a rejected batch changes nothing.
