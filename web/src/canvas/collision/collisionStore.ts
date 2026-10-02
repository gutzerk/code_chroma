import { useEffect } from "react";
import type { RefObject } from "react";
import type { Obstacle } from "./resolveDrop";

/** Hands back the element this participant currently occupies, or null when it isn't mounted. The
 * registry deliberately holds the ELEMENT rather than a plain rectangle getter: it needs the node
 * itself to drop a participant that contains (or is contained by) the block being dragged — a plan
 * panel lives inside a C1 box, and a block must never be shoved out of its own ancestor. */
export type ElementSource = () => HTMLElement | null;

/** An obstacle plus the node it was measured from, needed for the nesting check above. */
type Participant = Obstacle & { element: HTMLElement };

/**
 * Registry of the rectangles the drop solver treats as hard obstacles — the C1 box anchors and the
 * floating plan / change-review panels. In-memory only, ExpansionStore-style: nothing persists.
 *
 * Rectangles are read from the live DOM through `getBoundingClientRect`, which reports SCREEN pixels
 * already multiplied by `.canvas-content`'s zoom transform, and divided by the caller's scale — the
 * same `measureScale` value `useDragOffset` uses for the drag delta, so the two can never diverge.
 * A gesture freezes the whole set on the first frame: the scene doesn't move while one block is
 * being dragged, and re-reading every rectangle per frame would force a layout each time.
 */
class CollisionStore {
  private readonly participants = new Map<string, ElementSource>();
  private frozen: Participant[] | null = null;

  /** Returns its own unregister, so a caller can wire it straight into an effect cleanup. */
  register = (id: string, getElement: ElementSource): (() => void) => {
    this.participants.set(id, getElement);
    return () => this.unregister(id);
  };

  unregister = (id: string): void => {
    this.participants.delete(id);
  };

  /** Freezes the rectangle set for the duration of one drag. */
  beginGesture = (scale: number): void => {
    this.frozen = this.readAll(scale);
  };

  endGesture = (): void => {
    this.frozen = null;
  };

  /** Every participant rectangle except the dragged block's own and anything it is nested inside (or
   * that is nested inside it), in canvas coordinates. */
  rectsExcept = (id: string, scale: number, movingElement?: HTMLElement | null): Obstacle[] => {
    const all = this.frozen ?? this.readAll(scale);
    return all.filter((entry) => {
      if (entry.id === id) return false;
      if (!movingElement) return true;
      return !entry.element.contains(movingElement) && !movingElement.contains(entry.element);
    });
  };

  /** Test-only. */
  reset = (): void => {
    this.participants.clear();
    this.frozen = null;
  };

  private readAll(scale: number): Participant[] {
    const rects: Participant[] = [];
    for (const [id, getElement] of this.participants) {
      const element = getElement();
      if (!element) continue;
      // Only elements under the zoom transform share the boxes' coordinate space. This is also what
      // exempts a plan panel opened inside CodePopup, which is positioned in screen pixels.
      if (!element.closest(".canvas-content")) continue;
      const rect = element.getBoundingClientRect();
      // jsdom and not-yet-laid-out elements report an empty box; a 0×0 rectangle at the origin would
      // otherwise read as a real obstacle every other participant has to escape.
      if (rect.width === 0 || rect.height === 0) continue;
      rects.push({
        id,
        element,
        x: rect.left / scale,
        y: rect.top / scale,
        width: rect.width / scale,
        height: rect.height / scale,
      });
    }
    return rects;
  }
}

export const collisionStore = new CollisionStore();

/** Registers an element as a solver participant for as long as it is mounted. Unregistering on
 * unmount is what stops a closed panel from leaving behind a phantom obstacle nothing can land on. */
export function useCollisionParticipant(
  id: string,
  ref: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return undefined;
    return collisionStore.register(id, () => ref.current);
  }, [id, ref, enabled]);
}
