import { useEffect } from "react";
import { undoStore } from "../state/undoStore";
import type { LayoutKind } from "../state/types";
import type { Offset } from "./useDragOffset";

/** The id of the window-level event UndoManager dispatches so the right diagram view restores its
 * saved layout — see useSavedLayoutAndFitLoop's subscription. */
export const UNDO_EVENT = "codechroma:undo";

export interface UndoEventDetail {
  kind: LayoutKind;
  layout: Record<string, Offset>;
}

export interface UndoManagerProps {
  /** Every layout kind Ctrl/Cmd+Z should be able to undo, in no particular order — RootCanvas
   * passes every kind with boxes actually on screen (e.g. "hierarchy" and "canvas") so one shortcut
   * undoes whichever of them was genuinely dragged most recently, not a single fixed kind. */
  kinds: readonly LayoutKind[];
}

/**
 * Owns Ctrl/Cmd+Z for the canvas — no UI of its own, mounted once inside RootCanvas. On the
 * shortcut it pops the most-recently-committed entry across every given kind (undoStore.undoLatest)
 * and dispatches it as a window event tagged with that kind; whichever view owns that kind reacts
 * (see useSavedLayoutAndFitLoop's subscription, or CanvasDocView's for "canvas") and restores its
 * layout through its own shared apply path. History lives in the module-global undoStore, so
 * switching views or diagrams does NOT clear it. Fires on the capture phase so it can
 * `preventDefault()` the browser's own undo; text inputs and the embedded terminal that want their
 * own Ctrl+Z handling stop the event before it reaches document here.
 */
export function UndoManager({ kinds }: UndoManagerProps): null {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const popped = undoStore.undoLatest(kinds);
      if (!popped) return;
      event.preventDefault();
      window.dispatchEvent(
        new CustomEvent<UndoEventDetail>(UNDO_EVENT, {
          detail: { kind: popped.kind, layout: popped.layout },
        }),
      );
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [kinds]);

  return null;
}
