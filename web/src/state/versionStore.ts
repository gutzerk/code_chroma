import { useSyncExternalStore } from "react";
import { Store } from "./createStore";

/**
 * A monotonically increasing counter with useSyncExternalStore subscription — the shape shared by
 * every "something changed, re-read the DOM/refetch" signal on the canvas (liveStore's bridge
 * pings, canvasLayoutStore's block resizes, changeCardStore's panel drags). Consumers only ever compare
 * the number to the last one they saw, so the value itself carries no meaning beyond "it moved".
 * In-memory only, same FR-018 precedent as ExpansionStore.
 */
export class VersionStore extends Store {
  private version = 0;

  getVersion = (): number => this.version;

  /** Advances the version and notifies subscribers. */
  bump = (): void => {
    this.version += 1;
    this.emit();
  };

  /** Back to the initial version — consumers treat 0 as "nothing has happened yet". */
  reset = (): void => {
    this.version = 0;
    this.emit();
  };
}

/** Binds a VersionStore to React — re-renders the caller whenever the counter moves. */
export function useVersion(store: VersionStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}

/**
 * A Store with a second, geometry-only channel, for the overlay stores whose cards live in a
 * draggable panel (CardStore, C1ChangesStore). A drag/resize lives in the panel's local transform,
 * invisible to the expand/collapse triggers `subscribe` fires on, and only the connector overlay
 * cares — so it gets its own counter rather than re-rendering every block's badge.
 */
export abstract class GeometryStore extends Store {
  readonly geometry = new VersionStore();

  notifyGeometryChange = (): void => {
    this.geometry.bump();
  };
}
