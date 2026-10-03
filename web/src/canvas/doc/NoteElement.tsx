import { useState } from "react";
import type { CanvasElement } from "../../state/types";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { elementDragPointerDown } from "../useDragOffset";
import { selectionStore } from "../../state/selectionStore";
import { reportAsyncError } from "../../util/reportError";
import { patchCanvasDoc } from "./canvasDocStore";
import { useCanvasElementDrag } from "./useCanvasElementDrag";

const DEFAULT_WIDTH = 180;
const DEFAULT_HEIGHT = 100;

export interface NoteElementProps {
  element: CanvasElement;
}

/** A free-text sticky note — new UI with no old-view equivalent, so no style-parity claim applies
 * (unlike CanvasNodeBox's five recipe kinds). Click to edit; blur commits the label. */
export function NoteElement({ element }: NoteElementProps) {
  const engineClient = useEngineClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(element.label);
  const width = element.size?.w ?? DEFAULT_WIDTH;
  const height = element.size?.h ?? DEFAULT_HEIGHT;

  const { offset, isDragging, handleProps } = useCanvasElementDrag(
    element, engineClient, "canvas note drag",
  );

  const commit = () => {
    setEditing(false);
    if (draft === element.label) return;
    patchCanvasDoc(engineClient, [{ op: "update_element", id: element.id, label: draft }]).catch(
      (cause: unknown) => reportAsyncError("canvas note edit", cause),
    );
  };

  const startEditing = () => {
    setDraft(element.label);
    setEditing(true);
  };

  return (
    <div
      className={`canvas-note-box${isDragging ? " canvas-note-box--dragging" : ""}`}
      data-testid="canvas-note-box"
      data-canvas-element
      style={{
        position: "absolute",
        left: element.position.x - width / 2 + offset.x,
        top: element.position.y - height / 2 + offset.y,
        minWidth: width,
        minHeight: height,
      }}
      {...handleProps}
      onPointerDown={elementDragPointerDown(handleProps)}
    >
      {editing ? (
        <textarea
          className="canvas-note-box-input"
          data-testid="canvas-note-box-input"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
        />
      ) : (
        <div
          className="canvas-note-box-text"
          data-testid="canvas-note-box-text"
          role="button"
          tabIndex={0}
          onClick={(event) => {
            // A plain click editing this note also clears any active multi-selection, same as
            // clicking a block does -- but not while a modifier is held, since that's the user
            // extending a selection/marquee gesture, not clicking away from one.
            if (!event.shiftKey && !event.ctrlKey && !event.metaKey) selectionStore.clear();
            startEditing();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            startEditing();
          }}
        >
          {element.label || "Note"}
        </div>
      )}
    </div>
  );
}
