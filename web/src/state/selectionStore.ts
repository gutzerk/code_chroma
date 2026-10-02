import { useSyncExternalStore } from "react";
import { arraysEqual, Store } from "./createStore";

/**
 * Global multi-select store, useSyncExternalStore-backed and in-memory only — a Miro-style
 * selection of canvas node ids, built by shift/ctrl-click or a marquee drag, then moved together by
 * a group drag. Never persisted, never reflected in the URL, same convention as ExpansionStore.
 */
class SelectionStore extends Store {
  private selected = new Set<string>();
  private snapshot: string[] = [];

  private notify(): void {
    const next = [...this.selected];
    if (!arraysEqual(next, this.snapshot)) this.snapshot = next;
    this.emit();
  }

  /** Every currently selected node id, in insertion order — stable reference between notifications. */
  getSelectedIds = (): string[] => this.snapshot;

  isSelected = (nodeId: string): boolean => this.selected.has(nodeId);

  size = (): number => this.selected.size;

  /** Adds/removes one id (shift/ctrl-click) without touching the rest of the selection. */
  toggle = (nodeId: string): void => {
    if (this.selected.has(nodeId)) this.selected.delete(nodeId);
    else this.selected.add(nodeId);
    this.notify();
  };

  /** Replaces the whole selection — a plain click/drag on an unselected block collapsing the
   * selection down to just that one id. */
  replace = (nodeIds: readonly string[]): void => {
    const next = new Set(nodeIds);
    if (next.size === this.selected.size && [...next].every((id) => this.selected.has(id))) return;
    this.selected = next;
    this.notify();
  };

  /** Unions the given ids into the existing selection, leaving the rest untouched — a shift-drag
   * marquee's result, which extends rather than replaces (matching shift/ctrl-click's add semantics
   * for a single id). */
  addMany = (nodeIds: readonly string[]): void => {
    const next = new Set(this.selected);
    for (const nodeId of nodeIds) next.add(nodeId);
    if (next.size === this.selected.size) return;
    this.selected = next;
    this.notify();
  };

  clear = (): void => {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.notify();
  };

  /** Full reset — workspace switches (resetWorkspaceStores); a selection never spans workspaces. */
  reset = (): void => {
    this.clear();
  };
}

export const selectionStore = new SelectionStore();

export function useIsSelected(nodeId: string): boolean {
  return useSyncExternalStore(selectionStore.subscribe, () => selectionStore.isSelected(nodeId));
}

export function useSelectedCount(): number {
  return useSyncExternalStore(selectionStore.subscribe, selectionStore.size);
}

/** Every currently selected id, re-rendering only when the set actually changes (stable ref). */
export function useSelectedIds(): string[] {
  return useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedIds);
}
