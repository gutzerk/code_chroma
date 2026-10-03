import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import { agentStore } from "../../agents/agentStore";

/** A stable empty snapshot, so `useSyncExternalStore` does not loop while nothing is collapsed. */
const EMPTY: ReadonlySet<string> = new Set();

/** The localStorage namespace, keyed per active workspace so one worktree's collapses never leak
 * onto another's. Split from the value by `::` so a workspace id can't collide with a layer name. */
const STORAGE_PREFIX = "codechroma.collapsedLayers";

/** The storage key for the currently active workspace -- read on demand so the store never needs
 * rebinding when the workspace switches (agentStore is global, non-reset state). */
function storageKey(): string {
  return `${STORAGE_PREFIX}.${agentStore.getActiveWorkspace()}`;
}

/** Parses the persisted id-set for the active workspace, or an empty set when the key is
 * absent/corrupt. Never throws: localStorage can be unavailable (private mode) or hold a
 * hand-edited value. */
function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * Which diagram layers are hidden from the canvas without being deleted -- the Diagrams tab's
 * collapse/expand toggle (AgentRail.tsx), a companion to its own "remove from canvas"/delete row
 * actions. Collapsing
 * never touches `CanvasDoc`: it is a pure client-side render filter (see CanvasDocView.tsx), so
 * re-expanding a diagram is instant and keeps whatever position it was auto-laid-out or dragged to.
 *
 * Persisted to localStorage keyed by the active workspace, so a reload keeps the diagrams the user
 * disabled. Still workspace-scoped by construction (does not call `markGlobalStore()`): a worktree
 * switch restores that workspace's own collapses rather than inheriting the previous one's.
 */
class CollapsedLayersStore extends Store {
  private collapsed: ReadonlySet<string>;

  constructor() {
    super();
    // Seed from localStorage at construction, before any effect runs: React mounts child effects
    // before parent ones, and RootCanvas's own collapse("hierarchy") then persist() must not
    // clobber the persisted set with just {hierarchy} before the restore is read. Seeding here
    // means that later write only ADD to the already-restored set instead of replacing it.
    const next = readCollapsed();
    this.collapsed = next.size === 0 ? EMPTY : next;
  }

  getCollapsed = (): ReadonlySet<string> => this.collapsed;

  isCollapsed = (layer: string): boolean => this.collapsed.has(layer);

  /** Loads the active workspace's persisted collapses into memory. Called at app mount and after a
   * workspace switch's reset -- otherwise the in-memory set starts empty and a reload would show
   * every diagram again. */
  load = (): void => {
    const next = readCollapsed();
    if (next.size === 0) this.collapsed = EMPTY;
    else this.collapsed = next;
    this.emit();
  };

  /** Writes the current set back to localStorage under the active workspace. Non-fatal on write
   * failure (storage full/unavailable). */
  private persist(): void {
    try {
      window.localStorage.setItem(storageKey(), JSON.stringify([...this.collapsed]));
    } catch {
      /* best effort — a failed write only loses the restore, never crashes the toggle */
    }
  }

  collapse = (layer: string): void => {
    if (this.collapsed.has(layer)) return;
    this.collapsed = new Set(this.collapsed).add(layer);
    this.persist();
    this.emit();
  };

  expand = (layer: string): void => {
    if (!this.collapsed.has(layer)) return;
    const next = new Set(this.collapsed);
    next.delete(layer);
    this.collapsed = next;
    this.persist();
    this.emit();
  };

  toggle = (layer: string): void => {
    if (this.isCollapsed(layer)) this.expand(layer);
    else this.collapse(layer);
  };

  reset = (): void => {
    if (this.collapsed === EMPTY) return;
    this.collapsed = EMPTY;
    this.emit();
  };
}

export const collapsedLayersStore = new CollapsedLayersStore();

export function useCollapsedLayers(): ReadonlySet<string> {
  return useSyncExternalStore(collapsedLayersStore.subscribe, collapsedLayersStore.getCollapsed);
}

export function useIsLayerCollapsed(layer: string): boolean {
  return useSyncExternalStore(collapsedLayersStore.subscribe, () =>
    collapsedLayersStore.isCollapsed(layer),
  );
}
