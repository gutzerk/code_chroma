import type { ComponentType } from "react";
import type { HierarchyNodeRef } from "../../state/types";

export interface CanvasNodeRendererProps {
  node: HierarchyNodeRef;
}

/** NodeRenderer must stamp data-node-id={node.node_id} on a real positioned element (CanvasViewport/ConnectionsOverlay rely on it). */
export interface CanvasRenderStrategy {
  id: string;
  label: string;
  NodeRenderer: ComponentType<CanvasNodeRendererProps>;
}
