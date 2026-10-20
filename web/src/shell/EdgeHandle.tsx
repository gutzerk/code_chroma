import type { PointerEvent } from "react";
import type { ResizeHandleProps } from "../canvas/useResizableSize";
import "./edgeHandle.css";

export interface EdgeHandleAction {
  label: string;
  glyph: string;
  onClick: () => void;
}

export interface EdgeHandleProps {
  /** The panel edge the handle sits on: a left panel's right edge is "right". */
  edge: "left" | "right";
  testId: string;
  /** Drag-to-resize pointer handlers (useResizableSize); omitted when the panel is not resizable. */
  resizeHandleProps?: ResizeHandleProps;
  /** The "‹" / "›" buttons, top to bottom (the agents panel has two: full screen and collapse). */
  actions: EdgeHandleAction[];
}

/** The mockup's panel edge handle: a column of resize dots plus the chevron action buttons. */
export function EdgeHandle({ edge, testId, resizeHandleProps, actions }: EdgeHandleProps) {
  return (
    <div className={`edge-handle edge-handle-${edge}`} data-testid={testId} {...resizeHandleProps}>
      <span className="edge-handle-dots" aria-hidden="true" />
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className="edge-handle-button"
          aria-label={action.label}
          data-testid={`${testId}-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
          onPointerDown={(event: PointerEvent<HTMLButtonElement>) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            action.onClick();
          }}
        >
          <span aria-hidden="true">{action.glyph}</span>
        </button>
      ))}
    </div>
  );
}
