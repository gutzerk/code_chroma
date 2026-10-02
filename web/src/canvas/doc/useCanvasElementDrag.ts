import { useEffect } from "react";
import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasElement } from "../../state/types";
import { reportAsyncError } from "../../util/reportError";
import { useDragOffset, type DragOffset } from "../useDragOffset";
import { canvasDocStore, patchCanvasDoc } from "./canvasDocStore";
import { dragOffsetStore } from "./dragOffsetStore";

/** Drag-to-reposition for a plain canvas-doc element (no group/collision system of its own) --
 * shared by HierarchyElement and NoteElement. CanvasNodeBox has its own solo/group-aware version
 * instead, since a group drag needs to commit every selected box's position in one batch. */
export function useCanvasElementDrag(
  element: CanvasElement,
  engineClient: EngineClient,
  label: string,
): DragOffset {
  const { offset, isDragging, handleProps, resetOffset } = useDragOffset({
    suppressClickAfterDrag: true,
    onPreview: (liveOffset) => dragOffsetStore.set(element.id, liveOffset),
    onEnd: (dragOffset) => {
      dragOffsetStore.clear(element.id);
      const prior = element.position;
      const next = { x: prior.x + dragOffset.x, y: prior.y + dragOffset.y };
      // See CanvasNodeBox.tsx's onEnd for why this must happen before the delta is folded in.
      resetOffset?.();
      canvasDocStore.moveElement(element.id, next);
      patchCanvasDoc(engineClient, [{ op: "update_element", id: element.id, position: next }])
        .then((result) => {
          if (!result.ok) canvasDocStore.moveElement(element.id, prior);
        })
        .catch((cause: unknown) => {
          canvasDocStore.moveElement(element.id, prior);
          reportAsyncError(label, cause);
        });
    },
  });

  // Runs once, only on true unmount -- clears this element's own live offset (harmless no-op if a
  // drag was never in flight), so an aborted gesture (this component unmounts mid-drag) never leaves
  // it rendering permanently offset from its real position.
  useEffect(() => {
    return () => dragOffsetStore.clear(element.id);
  }, [element.id]);

  return { offset, isDragging, handleProps, resetOffset };
}
