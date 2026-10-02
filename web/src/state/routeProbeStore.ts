import { useSyncExternalStore } from "react";
import { Store } from "./createStore";

/** Snapshot the overlay/trigger render from — same stable-reference discipline as TraceSnapshot. */
export interface RouteProbeSnapshot {
  fromId: string | null;
  toId: string | null;
  path: string[] | null;
  isLoading: boolean;
}

const EMPTY_SNAPSHOT: RouteProbeSnapshot = {
  fromId: null,
  toId: null,
  path: null,
  isLoading: false,
};

/** Global route-probe store: the two selected endpoints, the resolved path (or null if the request
 * hasn't landed yet / found nothing), and a loading flag for the in-flight request. In-memory only,
 * same shape as traceStore — reset on workspace switch since a route never spans workspaces. */
class RouteProbeStore extends Store {
  private fromId: string | null = null;
  private toId: string | null = null;
  private path: string[] | null = null;
  private isLoading = false;
  private snapshot: RouteProbeSnapshot = EMPTY_SNAPSHOT;
  // Bumped on each request so a stale response (an older probe that resolves after a newer one
  // started) can't overwrite the newer request's result.
  private requestId = 0;

  getSnapshot = (): RouteProbeSnapshot => this.snapshot;

  private rebuild(): void {
    this.snapshot = {
      fromId: this.fromId,
      toId: this.toId,
      path: this.path,
      isLoading: this.isLoading,
    };
  }

  private notify(): void {
    this.rebuild();
    this.emit();
  }

  /** Starts a probe between two nodes, calling `fetchRoute` (the caller's EngineClient.getRoute)
   * and recording its result once it lands, unless a newer probe has started meanwhile. */
  probe = (fromId: string, toId: string, fetchRoute: (from: string, to: string) => Promise<string[] | null>): void => {
    this.fromId = fromId;
    this.toId = toId;
    this.path = null;
    this.isLoading = true;
    const requestId = ++this.requestId;
    this.notify();
    fetchRoute(fromId, toId)
      .then((path) => {
        if (requestId !== this.requestId) return;
        this.path = path;
        this.isLoading = false;
        this.notify();
      })
      .catch(() => {
        if (requestId !== this.requestId) return;
        this.path = null;
        this.isLoading = false;
        this.notify();
      });
  };

  clear = (): void => {
    this.requestId++;
    this.fromId = null;
    this.toId = null;
    this.path = null;
    this.isLoading = false;
    this.notify();
  };

  reset = (): void => {
    this.clear();
  };
}

export const routeProbeStore = new RouteProbeStore();

export function useRouteProbeState(): RouteProbeSnapshot {
  return useSyncExternalStore(routeProbeStore.subscribe, routeProbeStore.getSnapshot);
}
