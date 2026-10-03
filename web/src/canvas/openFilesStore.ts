import { useSyncExternalStore } from "react";
import type { HierarchyNodeRef } from "../state/types";
import { Store } from "../state/createStore";

/**
 * The set of files opened in the code sidebar, in most-recently-viewed (MRU) order. Every
 * `open()` moves the file to the front; `activate(id)` just re-marks the tab active without
 * reordering (used by the overflow dropdown, which lists ALL open files). In-memory only, resets on
 * reload — same FR-018 precedent as ExpansionStore.
 */
class OpenFilesStore extends Store {
  private files: HierarchyNodeRef[] = [];
  private activeId: string | null = null;

  getFiles = (): readonly HierarchyNodeRef[] => this.files;

  getActiveId = (): string | null => this.activeId;

  /** Opens (or re-activates) a file, moving it to the MRU front. */
  open = (node: HierarchyNodeRef): void => {
    this.files = [node, ...this.files.filter((f) => f.node_id !== node.node_id)];
    this.activeId = node.node_id;
    this.emit();
  };

  /** Activates an already-open file without reordering its MRU position. */
  activate = (nodeId: string): void => {
    if (this.activeId === nodeId) return;
    if (!this.files.some((f) => f.node_id === nodeId)) return;
    this.activeId = nodeId;
    this.emit();
  };

  /** Re-clicking the file that is currently open in the code panel closes it (so a second click
   * removes its code); clicking any other file (or an open-but-inactive one) opens/activates it. */
  toggle = (node: HierarchyNodeRef): void => {
    if (this.activeId === node.node_id) {
      this.close(node.node_id);
    } else {
      this.open(node);
    }
  };

  close = (nodeId: string): void => {
    const next = this.files.filter((f) => f.node_id !== nodeId);
    if (next.length === this.files.length) return;
    this.files = next;
    // Closing the active tab activates the next most-recent one — after the filter above removed
    // nodeId, `this.files[0]` is simply the MRU front (or null when none remain).
    if (this.activeId === nodeId) this.activeId = this.files[0]?.node_id ?? null;
    this.emit();
  };

  reset = (): void => {
    if (this.files.length === 0 && this.activeId === null) return;
    this.files = [];
    this.activeId = null;
    this.emit();
  };
}

export const openFilesStore = new OpenFilesStore().markGlobalStore();

export function useOpenFiles(): readonly HierarchyNodeRef[] {
  return useSyncExternalStore(openFilesStore.subscribe, openFilesStore.getFiles);
}

export function useActiveFileId(): string | null {
  return useSyncExternalStore(openFilesStore.subscribe, openFilesStore.getActiveId);
}
