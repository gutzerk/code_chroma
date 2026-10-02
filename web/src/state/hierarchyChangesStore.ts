import { useSyncExternalStore } from "react";
import { Store } from "./createStore";

export type HierarchyChangeStatus = "added" | "modified" | "removed";

const STATUSES: readonly HierarchyChangeStatus[] = ["added", "modified", "removed"];

/** Per-node added/modified/removed status for the Diff toggle's block-recolor signal — the
 * counterpart to changeCardStore's floating cards. Fed from GET /change-cards' `by_node_status`, the
 * same deterministic cards the change-card layer already renders, so the two can never disagree
 * about a node's status. In-memory only, same FR-018 precedent as changeCardStore.
 *
 * Shared by the plain hierarchy view AND the Patterns view (see PatternNodeBox.tsx) — a pattern
 * participant/context node's id already IS the real hierarchy node id, so it colors straight off
 * this store with no synthetic-id layer of its own. Only C1 opts out (`recolor: false` in
 * refreshDiffs): it has its own dedicated block-review overlay (changesSidecarStore) keyed by
 * synthetic block ids that this one knows nothing about. */
class HierarchyChangesStore extends Store {
  private statusByNode = new Map<string, HierarchyChangeStatus>();

  /** The block-recolor status for one node, or undefined when the diff doesn't touch it. */
  getStatus = (nodeId: string): HierarchyChangeStatus | undefined => this.statusByNode.get(nodeId);

  setStatuses = (byNode: Record<string, string>): void => {
    const next = new Map<string, HierarchyChangeStatus>();
    for (const [nodeId, status] of Object.entries(byNode)) {
      if (STATUSES.includes(status as HierarchyChangeStatus)) {
        next.set(nodeId, status as HierarchyChangeStatus);
      }
    }
    this.statusByNode = next;
    this.emit();
  };

  /** Clears the layer — nothing else on the node depends on this store, so there is no expansion
   * state to preserve, unlike changeCardStore/diffOverlayStore. */
  clear = (): void => {
    this.statusByNode = new Map();
    this.emit();
  };

  /** Full reset — tests and workspace switches (resetWorkspaceStores). */
  reset = (): void => {
    this.clear();
  };
}

export const hierarchyChangesStore = new HierarchyChangesStore();

export function useHierarchyChangeStatus(nodeId: string): HierarchyChangeStatus | undefined {
  return useSyncExternalStore(hierarchyChangesStore.subscribe, () =>
    hierarchyChangesStore.getStatus(nodeId),
  );
}
