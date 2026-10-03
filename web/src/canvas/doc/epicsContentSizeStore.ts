import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";

/** One epics-layer box's ideal content height -- the natural height its header (name + meta +
 * description) needs, ignoring the box's forced `minHeight`. Held in a store because the box
 * border-box measurement (useMeasuredSizes) can never report shrink: `.diagram-node-box` pins
 * `minHeight` to the reserved height, so an over-reserved box's border-box always equals the
 * reservation even when its content is shorter -- the empty dark band under the text. The header
 * element has no such constraint, so its height is the honest content footprint useReflowEpics
 * needs to re-fit (shrink AND grow) an epics box. */
interface EpicsContentSize {
  height: number;
}

class EpicsContentSizeStore extends Store {
  private sizes: Record<string, EpicsContentSize> = {};
  // A stable ReadonlyMap snapshot -- rebuilt only when `sizes` actually changes, so consecutive
  // `getSnapshot()` identities differ iff the contents did (useSyncExternalStore's Object.is check
  // would otherwise see a fresh Map every call and refuse to settle, looping React's renderer).
  private cached: ReadonlyMap<string, EpicsContentSize> = new Map();

  get = (): ReadonlyMap<string, EpicsContentSize> => this.cached;

  set(id: string, height: number): void {
    const existing = this.sizes[id];
    if (existing && existing.height === height) return;
    this.sizes = { ...this.sizes, [id]: { height } };
    this.rebuild();
    this.emit();
  }

  clear(id: string): void {
    if (!(id in this.sizes)) return;
    const next = { ...this.sizes };
    delete next[id];
    this.sizes = next;
    this.rebuild();
    this.emit();
  }

  reset(): void {
    this.sizes = {};
    this.rebuild();
    this.emit();
  }

  /** Rebuilds `cached` from `sizes` after any mutation. */
  private rebuild(): void {
    const next = new Map<string, EpicsContentSize>();
    for (const [id, size] of Object.entries(this.sizes)) next.set(id, size);
    this.cached = next;
  }
}

export const epicsContentSizeStore = new EpicsContentSizeStore();

/** The live map of epics-box id → content height, for useReflowEpics. */
export function useEpicsContentSizes(): ReadonlyMap<string, EpicsContentSize> {
  return useSyncExternalStore(epicsContentSizeStore.subscribe, epicsContentSizeStore.get);
}
