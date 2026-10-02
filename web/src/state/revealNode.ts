import { isAbortError, type EngineClient } from "../engine-client/EngineClient";
import type { HierarchyNodeRef } from "./types";
import { expansionStore } from "./expansionState";

/** Shared getNode memo for one caller's batch of reveals; see revealNode's `cache` argument. */
export type NodeRefCache = Map<string, Promise<HierarchyNodeRef | null>>;

/** Walks a bare node_id's ancestor chain up to the root and expands every container ancestor, so
 * a diff on a function the user never manually navigated to (the AI can target any function in
 * the repo, not just one already visible) has somewhere to render. Leaves the target node itself
 * alone — functions aren't "expanded" the way folders/files/classes are; their diff visibility is
 * handled separately by diffOverlayStore.setDiffs.
 *
 * 🔴 The walk costs one getNode per level, so a caller revealing many nodes at once (refreshDiffs
 * and loadPlan both do) must pass a `cache` shared across the whole batch: siblings share nearly
 * every ancestor, and without it N changed symbols at depth D issued N*D uncached requests — the
 * storm that made the Diff toggle never finish. A one-off caller can leave it out and get a private
 * one, which costs nothing: within a single chain no id repeats.
 *
 * `signal` aborts the walk's own requests — a cancelled Diff activation really stops fetching,
 * rather than letting the storm run on while the UI pretends it stopped. */
export async function revealNode(
  nodeId: string,
  client: EngineClient,
  cache: NodeRefCache = new Map(),
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  // Free when the ancestor chain is already in expansionStore's parentLinks (populated by every
  // children fetch and by earlier reveals), which is the common case on a re-reveal after a ping.
  const cached = expansionStore.getCachedAncestorPath(nodeId);
  if (cached !== null) {
    for (const id of cached) {
      if (id !== nodeId) expansionStore.expand(id);
    }
    return;
  }

  const fetchNode = (id: string): Promise<HierarchyNodeRef | null> => {
    let pending = cache.get(id);
    if (pending === undefined) {
      // Evicted on rejection, or every later reveal in the batch reuses the same failure.
      pending = client.getNode(id, signal).catch((err: unknown) => {
        cache.delete(id);
        throw err;
      });
      cache.set(id, pending);
    }
    return pending;
  };

  try {
    const path: HierarchyNodeRef[] = [];
    let current = await fetchNode(nodeId);
    while (current) {
      path.unshift(current);
      if (current.parent_id === null) break;
      current = await fetchNode(current.parent_id);
    }

    // A walk whose last fetch landed just before the abort must not expand anything: the canceller
    // has already put the pre-diff expansion state back, and this would re-pollute it.
    if (signal?.aborted) return;

    if (path.length === 0) {
      console.warn(`[plan] revealNode: no node found for ${nodeId} (nothing to reveal)`);
      return;
    }

    expansionStore.cacheNodeRefs(path);
    for (const ref of path) {
      if (ref.node_id !== nodeId) expansionStore.expand(ref.node_id);
    }
  } catch (err) {
    // A cancelled batch is not a failure — staying quiet keeps a Diff cancel from filling the
    // console with one warning per pending node.
    if (isAbortError(err)) return;
    // A single unresolvable id must not abort the caller's whole loop (e.g. every plan step) —
    // log which node failed and let the rest proceed.
    console.warn(`[plan] revealNode failed for ${nodeId}`, err);
  }
}

/** The enclosing block's synthetic id, one trail segment up — same rule
 * C1InternalConnections.parentNodeId uses to bundle an arrow endpoint to its nearest visible
 * ancestor. Duplicated rather than imported: that function lives in canvas/, and state/ doesn't
 * otherwise depend on it. */
function parentC1NodeId(nodeId: string): string | null {
  if (!nodeId.startsWith("c1-sub::")) return null;
  const trail = nodeId.slice("c1-sub::".length);
  const head = trail.slice(0, trail.lastIndexOf("/"));
  if (!head) return null;
  if (head.includes("/")) return `c1-sub::${head}`;
  return head === "system" ? "c1-system" : `c1-actor::${head}`;
}

/** Walks a C1 block's ancestor chain (derived purely by string-parsing its id trail — a c1-* node
 * is never fetched over the wire the way a real hierarchy node is) and expands every ancestor, so a
 * plan step resolved several authored layers deep (c1-sub::system/domain/orders/checkout) mounts its
 * TreeNode instead of staying hidden until the user manually clicks down through each box/row. Leaves
 * the target itself alone, same convention as revealNode. The two top-level anchors (c1-system,
 * c1-actor::*) are always mounted by dagre, so this is a no-op once it reaches one of them. */
export function revealC1Node(nodeId: string): void {
  let current = parentC1NodeId(nodeId);
  while (current) {
    expansionStore.expand(current);
    current = parentC1NodeId(current);
  }
}
