import { useEffect, useState } from "react";
import type { CanvasElement, HierarchyNodeRef } from "../../state/types";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { elementDragPointerDown } from "../useDragOffset";
import { resolveStrategy } from "../strategies/registry";
import { expansionStore } from "../../state/expansionState";
import { useCanvasElementDrag } from "./useCanvasElementDrag";

const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 96;

export interface HierarchyElementProps {
  element: CanvasElement;
  /** Used when the element carries no `meta.strategy` of its own; see the component's own doc. */
  fallbackStrategy?: string;
}

/**
 * A hierarchy subtree pinned onto the one canvas ("Pin to canvas" in the plan's scenarios) — wraps
 * the existing boxes/tree strategy renderer at an (x, y) instead of drawing its own box, so
 * `Block.tsx`/`TreeNode.tsx`, `expansionState.ts` and lazy child fetch stay completely untouched (the
 * plan's own Decision: "the tree just gains an (x, y)"). `element.meta.strategy` picks boxes vs tree
 * (defaults to the app's own default via resolveStrategy(undefined)).
 */
export function HierarchyElement({ element, fallbackStrategy }: HierarchyElementProps) {
  const engineClient = useEngineClient();
  const [node, setNode] = useState<HierarchyNodeRef | null>(null);
  const nodeId = element.node_id;

  useEffect(() => {
    if (!nodeId) return;
    let cancelled = false;
    engineClient.getNode(nodeId).then((next) => {
      if (cancelled || !next) return;
      setNode(next);
      expansionStore.cacheNodeRefs([next]);
    });
    return () => {
      cancelled = true;
    };
  }, [engineClient, nodeId]);

  const { offset, isDragging, handleProps } = useCanvasElementDrag(
    element, engineClient, "canvas hierarchy drag",
  );

  if (!node) return null;
  const authored = typeof element.meta.strategy === "string" ? element.meta.strategy : undefined;
  const strategy = resolveStrategy(authored ?? fallbackStrategy);
  const NodeRenderer = strategy.NodeRenderer;

  return (
    <div
      className={`canvas-hierarchy-element${isDragging ? " canvas-hierarchy-element--dragging" : ""}`}
      data-testid="canvas-hierarchy-element"
      style={{
        position: "absolute",
        left: element.position.x + offset.x,
        top: element.position.y + offset.y,
        minWidth: DEFAULT_WIDTH,
        minHeight: DEFAULT_HEIGHT,
      }}
      {...handleProps}
      // This wrapper spans the whole rendered subtree (every row, every gap between them), so the
      // shift-starts-a-marquee guard below matters more here than elsewhere -- without it a
      // shift-drag started anywhere inside it silently moves the pinned element instead.
      onPointerDown={elementDragPointerDown(handleProps)}
    >
      <NodeRenderer node={node} />
    </div>
  );
}
