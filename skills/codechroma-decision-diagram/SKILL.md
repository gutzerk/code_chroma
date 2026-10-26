---
name: codechroma-decision-diagram
description: Draw a small abstract decision diagram per option for a question you are about to ask the user on the CodeChroma canvas -- components, data flow, ownership or trade-offs of an option that may not exist in the code yet. Use before calling `ask_user` with `kind: "diagram"` for any question that changes structure (boundaries, data flow, ownership, a new component), and when a `[CodeChroma request` message says the user asked for diagrams. You draw through the `draw_option_diagram` MCP tool of the `codechroma` server.
---

A decision diagram helps the user pick between options. It is not a view of the repository: for the
C1, patterns or impact views use `codechroma-draw-diagram` instead.

## Draw

1. One small diagram per option, or one shared diagram with the option's own part marked `new`.
   At most **12 nodes** each (the tool rejects more), labelled in the user's language.
2. Call `draw_option_diagram` (server `codechroma`, may appear as
   `mcp__codechroma__draw_option_diagram`) once per option:
   `title` (the option's title), `nodes` as `{id, label, description?, status?}`, `edges` as
   `{from, to, label?}`. Set `status: "new"` on parts that do not exist yet. Give every node a
   `description` and every edge a verb `label` (see the reference); the tool warns when more than
   half the nodes lack a description.
3. The result is `{diagram_ref}`. Pass it as `diagram_ref` on that option in `ask_user`.
4. Call `ask_user` with `kind: "diagram"` and the full option contract (see `codechroma-grill`).

If a `[CodeChroma request ...]` message arrives, draw the diagrams, then call `ask_user` again with the same
`session_id` and the same question text, now with each option's `diagram_ref`. The card updates in place.

See `references/drawing-decision-diagrams.md` for what to draw. To check a draft before drawing, put
it in a JSON file `{"title", "nodes", "edges"}` and run
`python scripts/check_decision_diagram.py <file>`; it prints `OK` or the problems.
