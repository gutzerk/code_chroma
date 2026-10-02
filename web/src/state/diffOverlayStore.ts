import { useSyncExternalStore } from "react";
import type { FunctionDiff } from "./types";
import { Store } from "./createStore";

/** Global "Diff" toggle store, keyed per node_id. In-memory only, same FR-018 precedent as
 * ExpansionStore — a diff's visibility is orthogonal to a block's expand/collapse state, so it
 * can't live on BlockView. `isActive` is tracked separately from the map's size so the button
 * stays correctly toggled even when a diff run legitimately finds zero changed functions. */
class DiffOverlayStore extends Store {
  private diffs = new Map<string, FunctionDiff>();
  private deletedSnapshot: FunctionDiff[] = [];
  private isActiveState = false;

  getDiff = (nodeId: string): FunctionDiff | undefined => this.diffs.get(nodeId);

  getIsActive = (): boolean => this.isActiveState;

  /** Diffs for functions deleted vs HEAD — they have no live block, so RootCanvas renders them as
   * floating blurred panels. Cached as a stable array so useSyncExternalStore doesn't loop. */
  getDeletedDiffs = (): FunctionDiff[] => this.deletedSnapshot;

  setDiffs = (entries: FunctionDiff[]): void => {
    this.diffs = new Map(entries.map((entry) => [entry.node_id, entry]));
    this.deletedSnapshot = entries.filter((entry) => entry.status === "deleted");
    this.isActiveState = true;
    this.emit();
  };

  /** Clears every diff without touching expansionStore's code_visible — the windows a Diff run
   * revealed/opened stay open, just showing plain code instead of a diff from here on. */
  clear = (): void => {
    this.diffs = new Map();
    this.deletedSnapshot = [];
    this.isActiveState = false;
    this.emit();
  };

  /** Full reset — tests and workspace switches (resetWorkspaceStores). */
  reset = (): void => {
    this.clear();
  };
}

export const diffOverlayStore = new DiffOverlayStore();

export function useDiff(nodeId: string): FunctionDiff | undefined {
  return useSyncExternalStore(diffOverlayStore.subscribe, () => diffOverlayStore.getDiff(nodeId));
}

export function useIsDiffActive(): boolean {
  return useSyncExternalStore(diffOverlayStore.subscribe, diffOverlayStore.getIsActive);
}

export function useDeletedDiffs(): FunctionDiff[] {
  return useSyncExternalStore(diffOverlayStore.subscribe, diffOverlayStore.getDeletedDiffs);
}
