import { useRef, type CSSProperties, type RefObject } from "react";
import { useDragOffset, type DragHandleProps } from "./useDragOffset";
import { useResizableSize, type ResizeHandleProps } from "./useResizableSize";

export interface PanelDragResizeOptions {
  /** Makes the header a drag handle and applies a translate transform from the drag offset. */
  draggable?: boolean;
  /** Adds a resize handle and applies an explicit width/height once the panel has been resized. */
  resizable?: boolean;
}

export interface PanelDragResize {
  panelRef: RefObject<HTMLDivElement>;
  dragHandleProps: DragHandleProps;
  resizeHandleProps: ResizeHandleProps;
  isDragging: boolean;
  isResizing: boolean;
  style: CSSProperties;
}

/** Shared drag/resize scaffold for CodeView and DiffView's panel — both deliberately call the bare
 * (non-collision-aware) useDragOffset/useResizableSize, since a code panel is a window over the map
 * and is meant to overlap other panels/blocks. Returns the ref, live style object and drag/resize
 * state; callers still build their own class list, header and body content since those differ
 * (DiffView's extra class, deleted badge and Accept/error controls). */
export function usePanelDragResize({
  draggable,
  resizable,
}: PanelDragResizeOptions): PanelDragResize {
  const panelRef = useRef<HTMLDivElement>(null);
  const { offset, isDragging, handleProps: dragHandleProps } = useDragOffset();
  const { size, isResizing, handleProps: resizeHandleProps } = useResizableSize(panelRef);

  return {
    panelRef,
    dragHandleProps,
    resizeHandleProps,
    isDragging,
    isResizing,
    style: {
      ...(draggable ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : {}),
      ...(resizable && size
        ? { width: size.width, height: size.height, maxWidth: "none", maxHeight: "none" }
        : {}),
    },
  };
}

/** The "block-code-view" wrapper's class list -- shared by CodeView and CardPanel (each still
 * builds its own header/body, only the frame classes are identical). */
export function blockCodeViewClasses(opts: {
  extra?: string;
  className?: string;
  dragging?: boolean;
  resizing?: boolean;
}): string {
  const classes = ["block-code-view"];
  if (opts.extra) classes.push(opts.extra);
  if (opts.className) classes.push(opts.className);
  if (opts.dragging) classes.push("block-code-view--dragging");
  if (opts.resizing) classes.push("block-code-view--resizing");
  return classes.join(" ");
}

/** Drag-handle grip glyph shown in a draggable panel's header — identical markup in CodeView and
 * DiffView. */
export function PanelDragGrip() {
  return (
    <span className="block-code-view-grip" aria-hidden="true">
      ⠿
    </span>
  );
}

/** Bottom-right resize handle shown on a resizable panel — identical markup and testid in both
 * CodeView and DiffView, so a future accessibility/behavior fix lands in one place. */
export function PanelResizeHandle({ handleProps }: { handleProps: ResizeHandleProps }) {
  return (
    <div
      className="block-code-view-resize-handle"
      data-testid="block-code-view-resize-handle"
      aria-hidden="true"
      {...handleProps}
    />
  );
}
