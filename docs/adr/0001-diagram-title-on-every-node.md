# A diagram's title is stamped on every node, not stored on the diagram

The canvas document (`CanvasDoc`) has elements and edges but no record for a diagram or layer, so the bridges (`recipes.py` / `Recipes.cs`) copy a diagram's authored top-level `title` into every node's `meta.diagram_title`, and the web (`diagramDisplay.ts`) reads the first non-empty one. We chose this over adding a layer-metadata record to `CanvasDoc` because that would change the document format, `apply_batch` and both bridges' contract for one field.

## Consequences

- A title change rewrites every node of the diagram; nodes of one diagram must never disagree, since the reader takes the first title it meets.
- The next diagram-level fact (owner, description, frame style) should add a real layer-metadata record to `CanvasDoc` instead of stamping again, and move `diagram_title` onto it.
