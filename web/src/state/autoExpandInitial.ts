import type { EngineClient } from "../engine-client/EngineClient";
import type { HierarchyNodeRef } from "./types";
import { expansionStore } from "./expansionState";

/** Least number of nodes the first-load view should reveal before it stops descending. */
const MIN_ELEMENTS = 5;
/** Largest level fan-out we'll reveal — beyond this we stop rather than flood the canvas. */
const MAX_FANOUT = 50;

/** Auto-expands the tree downward on first load so the canvas opens on a useful view instead of a
 * single collapsed root. BFS one whole level at a time (folders only — files are terminal, we never
 * auto-open code symbols), stopping at the first level that reveals >= MIN_ELEMENTS nodes, or before
 * revealing a level whose fan-out would exceed MAX_FANOUT. The downward analogue of revealNode.
 * Returns every node_id it revealed (root + each expanded container + the deepest revealed level) so
 * the caller can frame the camera to the whole expanded set, not just the root. */
export async function autoExpandInitial(
  root: HierarchyNodeRef,
  client: EngineClient,
): Promise<string[]> {
  const revealed = new Set<string>([root.node_id]);
  try {
    let currentLevel: HierarchyNodeRef[] = [root];
    let done = false;
    while (!done) {
      const expandable = currentLevel.filter((n) => n.level === "folder" && n.has_children);
      const childArrays = await Promise.all(expandable.map((n) => client.getChildren(n.node_id)));
      const nextLevel = childArrays.flat();

      if (expandable.length === 0 || nextLevel.length === 0 || nextLevel.length > MAX_FANOUT) {
        done = true;
      } else {
        expansionStore.cacheNodeRefs(nextLevel);
        for (const n of expandable) expansionStore.expand(n.node_id);
        for (const n of nextLevel) revealed.add(n.node_id);
        currentLevel = nextLevel;
        done = nextLevel.length >= MIN_ELEMENTS;
      }
    }
  } catch (err) {
    // First render must never break on a fetch failure — log and leave the tree as-is.
    console.warn("[autoExpand] failed to auto-expand initial view", err);
  }
  return [...revealed];
}
