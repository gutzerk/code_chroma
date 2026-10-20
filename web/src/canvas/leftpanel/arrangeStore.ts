import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import type { ArrangeMode } from "./arrangeLayout";

type Positions = Record<string, { x: number; y: number }>;

/** Active arrange mode plus the pre-arrange positions that clicking the active mode restores. */
class ArrangeStore extends Store {
  private mode: ArrangeMode = "free";
  private snapshot: Positions = {};

  getMode = (): ArrangeMode => this.mode;
  getSnapshot = (): Positions => this.snapshot;

  /** Records the original positions only on the first arrange out of free; later switches keep them. */
  enter = (mode: Exclude<ArrangeMode, "free">, original: Positions): void => {
    if (this.mode === "free") this.snapshot = original;
    else this.snapshot = { ...original, ...this.snapshot };
    this.mode = mode;
    this.emit();
  };

  leave = (): Positions => {
    const restored = this.snapshot;
    this.reset();
    return restored;
  };

  reset = (): void => {
    this.mode = "free";
    this.snapshot = {};
    this.emit();
  };
}

export const arrangeStore = new ArrangeStore();

export function useArrangeMode(): ArrangeMode {
  return useSyncExternalStore(arrangeStore.subscribe, arrangeStore.getMode);
}
