import { useEffect, useState } from "react";
import type { CanvasElement, HierarchyNodeRef } from "../../state/types";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { elementDragPointerDown } from "../useDragOffset";
import { BoxesRenderer } from "../strategies/boxes";
import { expansionStore } from "../../state/expansionState";
import { useCanvasElementDrag } from "./useCanvasElementDrag";

const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 96;

export interface HierarchyElementProps {
  element: CanvasElement;
}

/**
 * A hierarchy subtree pinned onto the one canvas ("Pin to canvas" in the plan's scenarios) — wraps
 * the Boxes renderer at an (x, y) instead of drawing its own box, so `Block.tsx`, `expansionState.ts`
 * and lazy child fetch stay completely untouched (the plan's own Decision: "the tree just gains an
 * (x, y)"). The hierarchy always renders as nested boxes — there is no boxes-vs-tree choice anymore.
 */
export function HierarchyElement({ element }: HierarchyElementProps) {
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
      <BoxesRenderer node={node} />
    </div>
  );
}
