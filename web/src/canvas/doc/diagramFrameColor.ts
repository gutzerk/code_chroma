import { BUILTIN_RECIPES } from "./diagramCatalog";
import { groupColorIndex } from "./groupColor";

/** The four builtin recipe layers each get their own fixed CSS class (`canvas-diagram-frame-<name>`,
 * see styles.css), reusing the same `--c1`/`--patterns`/`--impact`/`--epics` tokens the rest of the
 * app already keys diagram-kind color off of ("Status / kind hues"). Keyed off `BUILTIN_RECIPES`
 * (`diagramCatalog.ts`) rather than a second hardcoded name list, so a future fifth builtin recipe
 * doesn't need this file updated by hand to get a color at all -- it just falls through to the
 * hashed palette below until someone adds a matching CSS class for it. */
const BUILTIN_FRAME_CLASS: Record<string, string> = Object.fromEntries(
  BUILTIN_RECIPES.map((recipe) => [recipe.name, `canvas-diagram-frame-${recipe.name}`]),
);

/** Resolves a diagram layer key to its frame's color class. Any layer that isn't one of the four
 * fixed builtins -- a saved custom type's `custom/<id>`, or a one-off skill-authored layer with no
 * registered recipe (see `diagramCatalog.ts`'s own note on that) -- is hashed into the same small
 * indexed palette `GroupFrame` already uses for an open-ended label set, so a custom diagram's frame
 * still gets a stable, distinct-looking color instead of falling back to one shared gray for all of
 * them. */
export function diagramFrameColorClass(layer: string): string {
  return BUILTIN_FRAME_CLASS[layer] ?? `canvas-diagram-frame-color-${groupColorIndex(layer)}`;
}
