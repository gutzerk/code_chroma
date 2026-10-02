import { diffLines } from "diff";
import { useMemo } from "react";
import { renderHighlighted } from "./highlighting/renderHighlighted";
import { usePanelDragResize, PanelDragGrip, PanelResizeHandle } from "./usePanelDragResize";
import type { FunctionDiff, HierarchyNodeRef } from "../state/types";

export interface DiffViewProps {
  node: HierarchyNodeRef;
  diff: FunctionDiff;
  /** Extra class appended to the wrapper — mirrors CodeViewProps so inline usage (Block/TreeNode)
   * opts into its own positioning/frame styles without affecting the popup's in-flow layout. */
  className?: string;
  /** Makes the header a drag handle, same convention as CodeView's inline usage. */
  draggable?: boolean;
  /** Adds a bottom-right corner resize handle, same convention as CodeView's inline usage. */
  resizable?: boolean;
  /** Renders the panel as a deleted-function marker (blurred source) — the node is gone from the
   * graph, so this is shown standalone in the diff-mode deleted overlay, not on a live block. */
  deleted?: boolean;
  /** Commits this diff's node_id to git (bridge/git_accept.py) — the corner "Accept" button. */
  onAccept?: (nodeId: string) => void;
  /** Disables the Accept button and swaps its label while the commit is in flight. */
  isAccepting?: boolean;
  /** Renders below the header when the last accept attempt failed. */
  acceptError?: string;
}

/** Renders a function's git-HEAD-vs-disk diff — sibling to CodeView.tsx, swapped in for it at
 * every call site (CodePopup, Block, TreeNode) whenever the global Diff toggle has revealed a
 * diff for the node, so both popup and inline placement get diff rendering for free from one
 * implementation. The corner Accept button commits this node's change to git (bridge/git_accept.py). */
export function DiffView({
  node,
  diff,
  className,
  draggable,
  resizable,
  deleted,
  onAccept,
  isAccepting,
  acceptError,
}: DiffViewProps) {
  const { panelRef, dragHandleProps, resizeHandleProps, isDragging, isResizing, style } =
    usePanelDragResize({ draggable, resizable });
  const classes = ["block-code-view", "diff-view"];
  if (className) classes.push(className);
  if (deleted) classes.push("diff-view--deleted");
  if (draggable && isDragging) classes.push("block-code-view--dragging");
  if (resizable && isResizing) classes.push("block-code-view--resizing");

  // Both the diff and the per-line highlighting are memoized together: usePanelDragResize re-renders
  // this panel on every pointermove while it's dragged or resized, and none of that touches the diff.
  const lines = useMemo(
    () =>
      diffLines(diff.original_source, diff.proposed_source).flatMap((chunk, chunkIndex) => {
        const lineType = chunk.added ? "add" : chunk.removed ? "remove" : "context";
        const marker = chunk.added ? "+" : chunk.removed ? "-" : " ";
        const chunkLines = chunk.value.replace(/\n$/, "").split("\n");
        return chunkLines.map((line, lineIndex) => (
          <span key={`${chunkIndex}-${lineIndex}`} className={`diff-line diff-line-${lineType}`}>
            <span className="diff-line-marker">{marker}</span>
            {renderHighlighted(line, node.language)}
          </span>
        ));
      }),
    [diff.original_source, diff.proposed_source, node.language],
  );

  return (
    <div ref={panelRef} className={classes.join(" ")} data-testid="diff-view" style={style}>
      <div
        className="block-code-view-header diff-view-header"
        data-testid="diff-view-header"
        {...(draggable ? dragHandleProps : {})}
      >
        {draggable && <PanelDragGrip />}
        <span className="block-code-view-name">{node.name}</span>
        {node.params && <span className="block-code-view-params">{node.params}</span>}
        {deleted && <span className="diff-view-deleted-badge">deleted</span>}
        {onAccept && (
          <button
            type="button"
            className="diff-accept-button"
            data-testid="diff-accept-button"
            disabled={isAccepting}
            onClick={() => onAccept(diff.node_id)}
          >
            {isAccepting ? "Committing…" : "Accept"}
          </button>
        )}
        {acceptError && (
          <span className="diff-accept-error" data-testid="diff-accept-error">
            {acceptError}
          </span>
        )}
      </div>
      <pre className="block-code-view-source diff-view-source" data-testid="diff-view-source">
        <code>{lines}</code>
      </pre>
      {resizable && <PanelResizeHandle handleProps={resizeHandleProps} />}
    </div>
  );
}
