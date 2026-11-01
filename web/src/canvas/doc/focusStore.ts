import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import type { CanvasDoc } from "../../state/types";
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
  private litEdges: CanvasDoc["edges"] | null = null;

  getVersion = (): number => this.version;

  current(): { id: string; direction: FocusDirection } | null {
    return this.focus ? { id: this.focus.id, direction: this.focus.direction } : null;
  }

  /** Focuses `id`; focusing the already-focused block clears it. A block with no edges has nothing to focus. */
  toggle(doc: CanvasDoc, id: string): void {
    const lit = litIdsFor(doc, id, "both");
    if (this.focus?.id !== id && lit.size === 1) {
      this.clear();
      return;
    }
    this.litEdges = doc.edges;
    this.focus = this.focus?.id === id ? null : { id, direction: "both", lit };
    this.changed();
  }

  setDirection(doc: CanvasDoc, direction: FocusDirection): void {
    if (!this.focus) return;
    this.litEdges = doc.edges;
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

  /** Recomputes the lit set when the doc's edges change, so a reanalyze or new edge never leaves it stale. */
  refresh(doc: CanvasDoc): void {
    if (!this.focus || doc.edges === this.litEdges) return;
    this.litEdges = doc.edges;
    this.focus = { ...this.focus, lit: litIdsFor(doc, this.focus.id, this.focus.direction) };
    this.changed();
  }

  stateOf(id: string): FocusState {
    if (!this.focus) return "none";
    if (this.focus.id === id) return "self";
    return this.focus.lit.has(id) ? "lit" : "dim";
  }

  /** True when a focus is set and this edge does not join the focused block to a lit neighbour. */
  edgeDimmed(from: string, to: string): boolean {
    const focus = this.focus;
    if (!focus) return false;
    return !((focus.id === from && focus.lit.has(to)) || (focus.id === to && focus.lit.has(from)));
  }

  /** True when a focus is set and none of `ids` is the focused block or one of its lit neighbours. */
  allDimmed(ids: readonly string[]): boolean {
    return this.focus !== null && !ids.some((id) => this.focus?.lit.has(id));
  }

  private changed(): void {
    this.version += 1;
    this.emit();
  }
}

export const focusStore = new FocusStore();

canvasDocStore.subscribe(() => focusStore.refresh(canvasDocStore.getDoc()));

/** Re-renders only when this element's own state changes, and returns it. */
export function useFocusState(id: string): FocusState {
  return useSyncExternalStore(focusStore.subscribe, () => focusStore.stateOf(id));
}

/** Re-renders only when this set of ids flips between "some connected to the focus" and "none". */
export function useAllDimmed(ids: readonly string[]): boolean {
  return useSyncExternalStore(focusStore.subscribe, () => focusStore.allDimmed(ids));
}
