import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";

/** A stable empty snapshot, so `useSyncExternalStore` does not loop while nothing is collapsed. */
const EMPTY: ReadonlySet<string> = new Set();

/**
 * Which diagram layers are hidden from the canvas without being deleted -- the Diagrams tab's
 * collapse/expand toggle (AgentRail.tsx), a companion to its own "remove from canvas"/delete row
 * actions. Collapsing
 * never touches `CanvasDoc`: it is a pure client-side render filter (see CanvasDocView.tsx), so
 * re-expanding a diagram is instant and keeps whatever position it was auto-laid-out or dragged to.
 *
 * Workspace-scoped by construction (does not call `markGlobalStore()`), same category as
 * `diagramHealthStore`: a worktree switch should start every diagram expanded again rather than risk
 * a stale collapse flag leaking onto a different workspace's same-named layer (e.g. "c1").
 */
class CollapsedLayersStore extends Store {
  private collapsed: ReadonlySet<string> = EMPTY;

  getCollapsed = (): ReadonlySet<string> => this.collapsed;

  isCollapsed = (layer: string): boolean => this.collapsed.has(layer);

  collapse = (layer: string): void => {
    if (this.collapsed.has(layer)) return;
    this.collapsed = new Set(this.collapsed).add(layer);
    this.emit();
  };

  expand = (layer: string): void => {
    if (!this.collapsed.has(layer)) return;
    const next = new Set(this.collapsed);
    next.delete(layer);
    this.collapsed = next;
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
