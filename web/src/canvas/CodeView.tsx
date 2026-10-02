import { useMemo } from "react";
import { renderHighlighted } from "./highlighting/renderHighlighted";
import { usePanelDragResize, blockCodeViewClasses, PanelDragGrip, PanelResizeHandle } from "./usePanelDragResize";
import type { HierarchyNodeRef } from "../state/types";

export interface CodeViewProps {
  node: HierarchyNodeRef;
  /** Extra class appended to the wrapper — lets inline usage (Block/TreeNode) opt into its own
   * positioning/frame styles without affecting the popup's in-flow layout. */
  className?: string;
  /** Makes the header a drag handle that repositions the panel (used inline; the popup has its
   * own draggable title bar instead — its copy of this header is hidden via CSS). */
  draggable?: boolean;
  /** Adds a bottom-right corner handle to stretch the panel past its default max-width/max-height
   * (used inline, where the panel would otherwise clip a full file/function/class behind a
   * scrollbar; the popup has its own resize handle on its outer frame instead). */
  resizable?: boolean;
}

/** Renders a node's highlighted source — shared by the CodePopup overlay and the inline
 * in-block code view, so the two display modes always show identical content. */
export function CodeView({ node, className, draggable, resizable }: CodeViewProps) {
  const { panelRef, dragHandleProps, resizeHandleProps, isDragging, isResizing, style } =
    usePanelDragResize({ draggable, resizable });
  // Memoized through the rendered spans, not just the tokens: usePanelDragResize re-renders this
  // panel on every pointermove while it's dragged or resized, and none of that touches the source.
  const highlighted = useMemo(
    () => renderHighlighted(node.source ?? "", node.language),
    [node.language, node.source],
  );
  const classes = blockCodeViewClasses({
    className,
    dragging: draggable && isDragging,
    resizing: resizable && isResizing,
  });

  return (
    <div ref={panelRef} className={classes} data-testid="block-code-view" style={style}>
      <div
        className="block-code-view-header"
        data-testid="block-code-view-header"
        {...(draggable ? dragHandleProps : {})}
      >
        {draggable && <PanelDragGrip />}
        <span className="block-code-view-name">{node.name}</span>
        {node.params && <span className="block-code-view-params">{node.params}</span>}
      </div>
      <pre className="block-code-view-source" data-testid="block-code-view-source">
        <code>{highlighted}</code>
      </pre>
      {resizable && <PanelResizeHandle handleProps={resizeHandleProps} />}
    </div>
  );
}
