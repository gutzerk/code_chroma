import { useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";

export interface LiveDragOffset {
  x: number;
  y: number;
}

/** The in-flight drag offset of whichever canvas elements are currently being dragged, keyed by
 * element id -- local UI state, never written to canvas.json. Exists so CanvasEdges can route an
 * arrow off a box's live on-screen position instead of its last-saved one: the box itself already
 * moves smoothly under the cursor via its own useDragOffset state, but that offset is private to
 * the dragged component, so without this store an edge stays anchored to the pre-drag position
 * until the drag ends and the PATCH round trip resolves. */
class DragOffsetStore extends Store {
  private offsets: Record<string, LiveDragOffset> = {};

  getAll = (): Record<string, LiveDragOffset> => this.offsets;

  set(id: string, offset: LiveDragOffset): void {
    // Same-value no-op: solo drags now write on the render clock (see useCollisionAvoidance's
    // onLiveOffset), and multiple raw pointermoves can map to the same offset before any frame
    // is painted -- a broadcast without a value change is pure wasted re-render for every
    // subscriber (frames, arrows, and the box itself).
    const existing = this.offsets[id];
    if (existing && existing.x === offset.x && existing.y === offset.y) return;
    this.offsets = { ...this.offsets, [id]: offset };
    this.emit();
  }

  /** Same effect as calling `set` once per entry, but ONE spread + ONE emit for the whole group --
   * a group/frame drag with N members previewing through a per-id `set` loop instead broadcasts N
   * full re-renders to every subscribed box on the canvas per pointer-move frame (not just the N
   * that moved), which is what made dragging a diagram frame with many members visibly lag behind
   * the cursor. */
  setMany(entries: Record<string, LiveDragOffset>): void {
    if (Object.keys(entries).length === 0) return;
    this.offsets = { ...this.offsets, ...entries };
    this.emit();
  }

  clear(id: string): void {
    if (!(id in this.offsets)) return;
    const next = { ...this.offsets };
    delete next[id];
    this.offsets = next;
    this.emit();
  }

  reset(): void {
    this.offsets = {};
    this.emit();
  }
}

export const dragOffsetStore = new DragOffsetStore();

export function useLiveDragOffsets(): Record<string, LiveDragOffset> {
  return useSyncExternalStore(dragOffsetStore.subscribe, dragOffsetStore.getAll);
}
