import type { CanvasElement, CanvasPosition } from "../../state/types";
import { recipeChromeKey } from "../../state/useSidecar";

/**
 * Remembers a layer's element positions across a remove-then-re-add cycle.
 *
 * `AgentRail`'s Diagrams tab "remove from canvas" row action (`removeLayerAndRefresh`) `delete_element`s every box in a layer, so a
 * user-dragged position has nowhere left to live once its element is gone — picking the same recipe
 * again (`runRecipeAndLayout`) used to always fall through to a fresh dagre pass (`autoLayout.ts`),
 * silently discarding wherever the user had put things. This cache is the fix: `removeLayerAndRefresh`
 * snapshots every element's position keyed by its own `meta.recipe_key` (the same key
 * `build_batch_ops` reconciles by) right before deleting it, and `runRecipeAndLayout` checks this
 * cache for each freshly-added element before handing it to `layoutNewElements` — a hit restores the
 * old spot instead of a new dagre-computed one.
 *
 * Module-level, not a `Store`: nothing renders off this, it only feeds a one-shot decision inside
 * `runRecipeAndLayout`. Entries are consumed on read so a stale position can never resurface once
 * used, and re-removing the same layer always re-captures the latest positions.
 */

const cache = new Map<string, Map<string, CanvasPosition>>();

/** Snapshots `layerElements` (every element already known to belong to `layer` -- the caller has
 * usually just filtered `doc.elements` for its own delete-op list, so this takes that same array
 * rather than re-filtering the whole document) by each element's `meta.recipe_key`, overwriting any
 * earlier snapshot. */
export function captureLayerPositions(layerElements: readonly CanvasElement[], layer: string): void {
  const snapshot = new Map<string, CanvasPosition>();
  for (const element of layerElements) {
    const recipeKey = recipeChromeKey(element);
    if (recipeKey) snapshot.set(recipeKey, element.position);
  }
  if (snapshot.size > 0) cache.set(layer, snapshot);
  else cache.delete(layer);
}

/** Returns and forgets `layer`'s cached position for `recipeKey`, if one was captured. */
export function takeCachedPosition(layer: string, recipeKey: string): CanvasPosition | undefined {
  const snapshot = cache.get(layer);
  if (!snapshot) return undefined;
  const position = snapshot.get(recipeKey);
  if (position === undefined) return undefined;
  snapshot.delete(recipeKey);
  if (snapshot.size === 0) cache.delete(layer);
  return position;
}

/** Test-only: clears every captured layer. */
export function reset(): void {
  cache.clear();
}
