import { useEffect, useState } from "react";
import type { HierarchyLevel, HierarchyNodeRef } from "./types";
import { expansionStore } from "./expansionState";
import { useLiveVersion } from "./liveStore";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { reportAsyncError } from "../util/reportError";

/** Fetches a node's children lazily on first expand and caches their refs — shared by Block.tsx
 * (canvas) and InspectorPanel.tsx so both surfaces load the same data the same way. Re-fetches
 * (surgically) whenever the bridge reports a live change, so on-disk edits appear without reload. */
export function useNodeChildren(nodeId: string, isExpanded: boolean): HierarchyNodeRef[] | null {
  const engineClient = useEngineClient();
  const liveVersion = useLiveVersion();
  const [children, setChildren] = useState<HierarchyNodeRef[] | null>(null);

  useEffect(() => {
    if (!isExpanded) return;
    let cancelled = false;
    engineClient.getChildren(nodeId).then((result) => {
      if (cancelled) return;
      // Group folders first, then code files, then symbol nodes — a stable sort keeps the bridge's
      // alphabetical order within each bucket. Sort a copy so the client's array is left untouched.
      const ordered = [...result].sort(byLevel);
      // Reconcile in place rather than blanking to null first: unchanged children keep their
      // node_id key (so React never remounts them and the camera doesn't flash), added nodes mount
      // collapsed, and any child that vanished is collapsed out of the shared expansion state.
      setChildren((previous) => reconcile(previous, ordered));
      expansionStore.cacheNodeRefs(ordered);
      // The next live ping (liveVersion bump) re-runs this effect, so a failed fetch self-retries.
    }).catch((cause: unknown) => reportAsyncError(`children of ${nodeId}`, cause));
    return () => {
      cancelled = true;
    };
  }, [nodeId, isExpanded, liveVersion, engineClient]);

  return children;
}

/** Render order: folders (0) before code files (1) before symbol nodes — class/function/code (2). */
const LEVEL_RANK: Record<HierarchyLevel, number> = {
  folder: 0,
  file: 1,
  class: 2,
  function: 2,
  code: 2,
};

/** Orders children by level bucket only; equal ranks stay in the bridge's alphabetical order. */
function byLevel(a: HierarchyNodeRef, b: HierarchyNodeRef): number {
  return LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
}

/** Returns the fresh list, first collapsing any previously-present child that's now gone so stale
 * expansion/breadcrumb state can't point at an unmounted node. */
function reconcile(
  previous: HierarchyNodeRef[] | null,
  next: HierarchyNodeRef[],
): HierarchyNodeRef[] {
  if (previous) {
    const nextIds = new Set(next.map((child) => child.node_id));
    for (const child of previous) {
      if (!nextIds.has(child.node_id)) expansionStore.collapse(child.node_id);
    }
  }
  return next;
}
