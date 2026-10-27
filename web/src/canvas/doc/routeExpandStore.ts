import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";

/** Which route-step boxes are expanded in place: in memory only, so it survives a re-render, not a reload. */
class RouteExpandStore extends Store {
  private expanded: ReadonlySet<string> = new Set();

  get = (): ReadonlySet<string> => this.expanded;

  toggle(id: string): void {
    const next = new Set(this.expanded);
    if (!next.delete(id)) next.add(id);
    this.expanded = next;
    this.emit();
  }

  reset(): void {
    if (this.expanded.size === 0) return;
    this.expanded = new Set();
    this.emit();
  }
}

export const routeExpandStore = new RouteExpandStore();

export function useRouteExpanded(): ReadonlySet<string> {
  return useSyncExternalStore(routeExpandStore.subscribe, routeExpandStore.get);
}

/** Subscribes to one id only, so toggling a step re-renders that box alone. */
export function useIsRouteExpanded(id: string): boolean {
  return useSyncExternalStore(routeExpandStore.subscribe, () => routeExpandStore.get().has(id));
}
