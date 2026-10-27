import { useSyncExternalStore } from "react";
import { Store } from "./createStore";
import type { Route } from "../canvas/doc/routeStep";

export interface RouteSnapshot {
  route: Route | null;
  /** Index into `route.steps` of the step the walk is on, or -1 before it starts. */
  stepIndex: number;
  walking: boolean;
}

const EMPTY: RouteSnapshot = { route: null, stepIndex: -1, walking: false };

/** The active authored route shown over the code map: in memory only (unlike the captured trace, nothing is recorded). */
class RouteStore extends Store {
  private snapshot: RouteSnapshot = EMPTY;

  getSnapshot = (): RouteSnapshot => this.snapshot;

  private set(next: RouteSnapshot): void {
    this.snapshot = next;
    this.emit();
  }

  show(route: Route): void {
    this.set({ route, stepIndex: -1, walking: false });
  }

  clear(): void {
    if (this.snapshot !== EMPTY) this.set(EMPTY);
  }

  setStep(stepIndex: number): void {
    const { route } = this.snapshot;
    if (!route) return;
    this.set({ ...this.snapshot, stepIndex: Math.min(Math.max(stepIndex, -1), route.steps.length - 1) });
  }

  /** Starts (or stops) the walk; starting on the last step restarts from the first. */
  toggleWalk(): void {
    const { route, walking, stepIndex } = this.snapshot;
    if (!route || route.steps.length === 0) return;
    if (walking) return this.set({ ...this.snapshot, walking: false });
    const restart = stepIndex < 0 || stepIndex >= route.steps.length - 1;
    this.set({ ...this.snapshot, walking: true, stepIndex: restart ? 0 : stepIndex });
  }

  /** Advances one step; the walk stops itself on the last one. */
  advance(): void {
    const { route, stepIndex } = this.snapshot;
    if (!route) return;
    const next = stepIndex + 1;
    if (next >= route.steps.length) return this.set({ ...this.snapshot, walking: false });
    this.set({ ...this.snapshot, stepIndex: next, walking: next < route.steps.length - 1 });
  }

  reset(): void {
    this.clear();
  }
}

export const routeStore = new RouteStore();

export function useRouteState(): RouteSnapshot {
  return useSyncExternalStore(routeStore.subscribe, routeStore.getSnapshot);
}
