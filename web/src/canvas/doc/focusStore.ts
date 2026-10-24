import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import type { CanvasDoc } from "../../state/types";
import { agentStore } from "../../agents/agentStore";
import { canvasDocStore } from "./canvasDocStore";
import { litIdsFor, type FocusDirection } from "./focusNeighbors";

export type FocusState = "none" | "self" | "lit" | "dim";

interface Focus {
  id: string;
  direction: FocusDirection;
  lit: Set<string>;
}

/** Click-to-focus on a block: its direct neighbours stay lit, the rest fades. A display state only. */
class FocusStore extends Store {
  private focus: Focus | null = null;
  private version = 0;

  getVersion = (): number => this.version;

  current(): { id: string; direction: FocusDirection } | null {
    return this.focus ? { id: this.focus.id, direction: this.focus.direction } : null;
  }

  /** Focuses `id`; focusing the already-focused block clears it. A block with no edges has nothing to focus. */
  toggle(doc: CanvasDoc, id: string): void {
    if (this.focus?.id !== id && litIdsFor(doc, id, "both").size === 1) {
      this.clear();
      return;
    }
    this.focus = this.focus?.id === id ? null : { id, direction: "both", lit: litIdsFor(doc, id, "both") };
    this.changed();
  }

  setDirection(doc: CanvasDoc, direction: FocusDirection): void {
    if (!this.focus) return;
    this.focus = { ...this.focus, direction, lit: litIdsFor(doc, this.focus.id, direction) };
    this.changed();
  }

  clear(): void {
    if (!this.focus) return;
    this.focus = null;
    this.changed();
  }

  /** A workspace switch drops the previous worktree's focus. */
  reset(): void {
    this.clear();
  }

  /** Recomputes the lit set against the live doc so a reanalyze or new edge never leaves it stale. */
  refresh(doc: CanvasDoc): void {
    if (!this.focus) return;
    const lit = litIdsFor(doc, this.focus.id, this.focus.direction);
    const same = lit.size === this.focus.lit.size && [...lit].every((id) => this.focus?.lit.has(id));
    if (same) return;
    this.focus = { ...this.focus, lit };
    this.changed();
  }

  stateOf(id: string): FocusState {
    if (!this.focus) return "none";
    if (this.focus.id === id) return "self";
    return this.focus.lit.has(id) ? "lit" : "dim";
  }

  private changed(): void {
    this.version += 1;
    this.emit();
  }
}

export const focusStore = new FocusStore();

let focusWorkspace = agentStore.getActiveWorkspace();
agentStore.subscribe(() => {
  const active = agentStore.getActiveWorkspace();
  if (active === focusWorkspace) return;
  focusWorkspace = active;
  focusStore.reset();
});
canvasDocStore.subscribe(() => focusStore.refresh(canvasDocStore.getDoc()));

/** Re-renders only when this element's own state changes, and returns it. */
export function useFocusState(id: string): FocusState {
  return useSyncExternalStore(focusStore.subscribe, () => focusStore.stateOf(id));
}
