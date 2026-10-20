import { useEffect, useRef } from "react";
import { CodeView } from "./CodeView";
import { DiffView } from "./DiffView";
import { PanelCloseButton } from "./PanelCloseButton";
import { useDragOffset } from "./useDragOffset";
import { useResizableSize } from "./useResizableSize";
import { useDiff } from "../state/diffOverlayStore";
import type { HierarchyNodeRef } from "../state/types";

export interface CodePopupProps {
  node: HierarchyNodeRef;
  onClose: () => void;
}

/** Full-viewport overlay showing a node's source via the shared CodeView renderer — the
 * "popup" half of the popup/inline code-view-mode toggle (see codeViewModeStore.ts). The panel
 * is repositioned by dragging its title bar (the source area stays selectable) and resized by
 * dragging its bottom-right corner handle — both are local, transient state, reset every time a
 * fresh popup mounts (RootCanvas keys it per node_id). */
export function CodePopup({ node, onClose }: CodePopupProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { offset, isDragging, handleProps } = useDragOffset();
  const { size, isResizing, handleProps: resizeHandleProps } = useResizableSize(panelRef);
  const diff = useDiff(node.node_id);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="code-popup-backdrop"
      data-testid="code-popup-backdrop"
      // Only a click directly on the dark backdrop closes — never one that bubbled up from the
      // panel (e.g. finishing a drag or a text selection inside it).
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`code-popup${isDragging ? " code-popup-dragging" : ""}${isResizing ? " code-popup-resizing" : ""}`}
        data-testid="code-popup"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          // Once the user has dragged the resize handle, the explicit pixel size (already
          // clamped to ~95% of the viewport in useResizableSize) must win over the smaller
          // default max-width/max-height cap in styles.css, or CSS would silently re-clamp it
          // back down to the default 720px/80vh ceiling.
          ...(size
            ? { width: size.width, height: size.height, maxWidth: "95vw", maxHeight: "95vh" }
            : {}),
        }}
      >
        <div className="code-popup-titlebar" data-testid="code-popup-titlebar" {...handleProps}>
          <span className="code-popup-grip" aria-hidden="true">
            ⠿
          </span>
          <span className="code-popup-title">{node.name}</span>
          {node.params && <span className="code-popup-title-params">{node.params}</span>}
          <PanelCloseButton
            className="code-popup-close"
            ariaLabel={`Close ${node.name} code popup`}
            onClick={onClose}
          />
        </div>
        {diff ? <DiffView node={node} diff={diff} /> : <CodeView node={node} />}
        <div
          className="code-popup-resize-handle"
          data-testid="code-popup-resize-handle"
          aria-hidden="true"
          {...resizeHandleProps}
        />
      </div>
    </div>
  );
}
