import { useMemo } from "react";
import type { HierarchyNodeRef } from "../state/types";
import { TreeNode } from "./strategies/tree/TreeNode";
import { ResizableRail } from "./ResizableRail";
import { openFilesStore, useActiveFileId, useOpenFiles } from "./openFilesStore";

const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 180;

/**
 * IDE-style project tree side panel. Reuses `TreeNode` and its shared ExpansionStore/lazy children;
 * the hierarchy layer on the diagrams canvas is collapsed by default.
 *
 * Renders the root node RootCanvas already owns (fetched once there and shared here as a prop), so
 * the sidebar never issues its own getNode. `onActivate` is owned by RootCanvas, which may frame a
 * corresponding canvas element when one is present.
 *
 * Resizable via the shared ResizableRail (right-edge handle, like the inspector); dragging it wider
 * reveals more of a row's name. Clicking a code-capable row opens it in the sibling code sidebar via
 * openFilesStore.
 */
export function ProjectTreePanel({
  rootNode,
  hidden,
  onActivate,
}: {
  rootNode: HierarchyNodeRef;
  hidden: boolean;
  onActivate: (nodeId: string) => void;
}) {
  // Subscribe once here (not per Tree row): the shared row reads `openFileIds`/`activeFileId` from
  // props instead of subscribing to the sidebar store itself, so a tab change re-renders this panel
  // root (which then reconciles the expanded tree — unavoidable without memoizing every row, since
  // `activeFileId` is a global prop each row receives) rather than firing N independent store
  // subscriptions, and each row's lookup is O(1) instead of an O(n) scan. `useMemo` keeps the Set
  // stable across re-renders until the list actually moves.
  const openFiles = useOpenFiles();
  const activeFileId = useActiveFileId();
  const openFileIds = useMemo(
    () => new Set(openFiles.map((f) => f.node_id)),
    [openFiles],
  );
  return (
    <ResizableRail
      className="project-tree-panel"
      resizingClass="project-tree-panel--resizing"
      ariaLabel="Project tree"
      dataTestid="project-tree-panel"
      handleTestid="project-tree-panel-resize-handle"
      defaultWidth={DEFAULT_WIDTH}
      minWidth={MIN_WIDTH}
      hidden={hidden}
    >
      <TreeNode
        node={rootNode}
        onActivate={(node) => onActivate(node.node_id)}
        openCodeOnActivate
        onOpenCode={(node) => openFilesStore.toggle(node)}
        openFileIds={openFileIds}
        activeFileId={activeFileId}
      />
    </ResizableRail>
  );
}
