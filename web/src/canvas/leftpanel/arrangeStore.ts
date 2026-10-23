import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import type { ArrangeMode } from "./arrangeLayout";

type Positions = Record<string, { x: number; y: number }>;

/** Active mode and Arrange-only translations, so leaving it keeps subsequent user moves. */
class ArrangeStore extends Store {
  private mode: ArrangeMode = "free";
  private translations: Positions = {};

  getMode = (): ArrangeMode => this.mode;

  /** Accumulates only each mode change's translations, excluding intervening user moves. */
  enter = (mode: Exclude<ArrangeMode, "free">, original: Positions, arranged: Positions): void => {
    for (const [id, next] of Object.entries(arranged)) {
      const before = original[id];
      if (!before) continue;
      const prior = this.translations[id] ?? { x: 0, y: 0 };
      this.translations[id] = { x: prior.x + next.x - before.x, y: prior.y + next.y - before.y };
    }
    this.mode = mode;
    this.emit();
  };

  leave = (current: Positions): Positions => {
    const restored: Positions = {};
    for (const [id, translation] of Object.entries(this.translations)) {
      const position = current[id];
      if (position) restored[id] = { x: position.x - translation.x, y: position.y - translation.y };
    }
    this.reset();
    return restored;
  };

  reset = (): void => {
    this.mode = "free";
    this.translations = {};
    this.emit();
  };
}

export const arrangeStore = new ArrangeStore();

export function useArrangeMode(): ArrangeMode {
  return useSyncExternalStore(arrangeStore.subscribe, arrangeStore.getMode);
}
