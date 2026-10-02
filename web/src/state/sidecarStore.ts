import { useSyncExternalStore } from "react";
import { GeometryStore } from "./versionStore";

/**
 * One overlay layer of records pinned onto blocks, keyed per node_id -- generalizes the old
 * `c1ChangesStore` (037, US2) the same way `CardStore<T>` already generalizes the plan/change-card
 * layers. `T` is the per-node record shape; `S` is the whole payload's shape (for the summary card),
 * since that's richer than "every record" (a fingerprint/summary/stale flag alongside the list). A
 * ghost record (a block the change removed) is just another `T` some caller mixes into `records`
 * before calling `setSnapshot` -- it needs no separate channel here, since nothing on the canvas
 * reads ghosts any other way than `getForNode` (037 research: the old `c1ChangesStore.getGhosts`
 * had zero callers). Only `impactChangesSidecarStore` (`useSidecar.ts`) instantiates this today --
 * a same-shaped `impactReviewStore` for the judgmental axis was removed, 038 follow-up.
 */
export class SidecarStore<T extends { node_id: string }, S> extends GeometryStore {
  private byNode = new Map<string, T>();
  private snapshotValue: S;
  private isActiveState = false;

  constructor(private readonly emptySnapshot: S) {
    super();
    this.snapshotValue = emptySnapshot;
  }

  /** The record for one node, or undefined when this overlay doesn't touch it. */
  getForNode = (nodeId: string): T | undefined => this.byNode.get(nodeId);

  /** The whole payload, for a summary card (stable identity between setSnapshot calls). */
  getSnapshot = (): S => this.snapshotValue;

  getIsActive = (): boolean => this.isActiveState;

  setSnapshot = (snapshot: S, records: T[]): void => {
    this.byNode = new Map(records.map((record) => [record.node_id, record]));
    this.snapshotValue = snapshot;
    this.isActiveState = true;
    this.emit();
  };

  /** Clears the layer without touching expansion state -- blocks a review revealed stay open, they
   * just lose their badges. */
  clear = (): void => {
    this.byNode = new Map();
    this.snapshotValue = this.emptySnapshot;
    this.isActiveState = false;
    this.emit();
  };

  /** Full reset -- tests and workspace switches (resetWorkspaceStores). */
  reset = (): void => {
    this.clear();
  };
}

export function useSidecarRecord<T extends { node_id: string }, S>(
  store: SidecarStore<T, S>,
  nodeId: string,
): T | undefined {
  return useSyncExternalStore(store.subscribe, () => store.getForNode(nodeId));
}

export function useSidecarSnapshot<T extends { node_id: string }, S>(
  store: SidecarStore<T, S>,
): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
