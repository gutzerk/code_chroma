import {
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { canvasLayoutStore } from "../../../state/canvasLayoutStore";
import type { HierarchyNodeRef } from "../../../state/types";
import { PAN_IGNORE_SELECTOR } from "../../CanvasViewport";
import { useCollisionParticipant } from "../../collision/collisionStore";
import { useSelectionAwareDrag } from "../../collision/useSelectionAwareDrag";
import { DropGhost } from "../../collision/DropGhost";
import { NODE_SEP, RANK_SEP } from "../../collision/constants";
import { useSavedLayout } from "../../useSavedLayoutAndFitLoop";
import { useMeasuredSizes } from "../../useMeasuredSizes";
import { Block } from "./Block";
import { BLOCK_LAYOUT } from "./layoutConfig";

export interface TopLevelBoxSize {
  width: number;
  height: number;
}

const DEFAULT_SIZE: TopLevelBoxSize = { width: BLOCK_LAYOUT.minWidth, height: BLOCK_LAYOUT.minHeight };

interface PositionedBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A deterministic row-major wrapped grid for the top-level boxes' base position — there's no graph
 * of edges between Systems to lay out against (unlike C1's dagre-based layoutDiagram), so a simple
 * grid is the right amount of complexity for a first drag-to-reposition pass. Columns scale with
 * the count so a handful of systems isn't stretched across one giant row. Exported for direct unit
 * testing, mirroring layoutDiagram/layoutPatterns. */
export function gridLayout(
  nodes: HierarchyNodeRef[],
  sizes: ReadonlyMap<string, TopLevelBoxSize>,
): PositionedBox[] {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const boxes: PositionedBox[] = [];
  let x = 0;
  let y = 0;
  let column = 0;
  let rowHeight = 0;
  for (const node of nodes) {
    const size = sizes.get(node.node_id) ?? DEFAULT_SIZE;
    boxes.push({ id: node.node_id, x, y, width: size.width, height: size.height });
    rowHeight = Math.max(rowHeight, size.height);
    x += size.width + NODE_SEP;
    column += 1;
    if (column >= columns) {
      column = 0;
      x = 0;
      y += rowHeight + RANK_SEP;
      rowHeight = 0;
    }
  }
  return boxes;
}

interface DraggableTopLevelBoxProps {
  box: PositionedBox;
  node: HierarchyNodeRef;
  initialOffset?: { x: number; y: number };
  onOffsetChange: (id: string, offset: { x: number; y: number }) => void;
  onCommit: (id: string, offset: { x: number; y: number }) => void;
  onCommitMany: (offsets: Record<string, { x: number; y: number }>) => void;
  dragOffsets: ReadonlyMap<string, { x: number; y: number }>;
  measure: (id: string, element: HTMLElement | null) => void;
}

/** One top-level System box, positioned at its grid coordinates and freely draggable — mirrors
 * C1View's DraggableAnchor, minus the dagre layout (see gridLayout above) and the per-box accent
 * (top-level hierarchy boxes have none). Selection highlighting and shift/ctrl-click toggling come
 * from the `Block` it wraps via its `selectable` prop (useNodeChrome) — the one place that prop is
 * ever set, since this is the only node either strategy actually group-drags. */
function DraggableTopLevelBox({
  box,
  node,
  initialOffset,
  onOffsetChange,
  onCommit,
  onCommitMany,
  dragOffsets,
  measure,
}: DraggableTopLevelBoxProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const participantId = `hierarchy-box::${box.id}`;
  useCollisionParticipant(participantId, anchorRef);

  const { isDragging, handleProps, ghost, renderOffset } = useSelectionAwareDrag({
    participantId,
    targetRef: anchorRef,
    selectionId: node.node_id,
    dragId: box.id,
    initialOffset,
    dragOffsets,
    onOffsetChange,
    onCommit,
    onCommitMany,
  });

  return (
    <div
      className={`hierarchy-top-box${isDragging ? " hierarchy-top-box--dragging" : ""}`}
      data-testid="hierarchy-top-box"
      ref={(element) => {
        anchorRef.current = element;
        measure(box.id, element);
      }}
      style={{
        position: "absolute",
        left: box.x + renderOffset.x,
        top: box.y + renderOffset.y,
        minWidth: DEFAULT_SIZE.width,
        minHeight: DEFAULT_SIZE.height,
      }}
      {...handleProps}
      onPointerDown={(event: ReactPointerEvent<HTMLElement>) => {
        if ((event.target as HTMLElement).closest(PAN_IGNORE_SELECTOR)) return;
        // A held Shift means the user is starting a marquee, not this box's own drag -- see
        // HierarchyElement.tsx's identical check for why this must reach CanvasViewport instead.
        if (event.shiftKey) return;
        // The box drag owns this gesture — without this the viewport would pan alongside it.
        event.stopPropagation();
        handleProps.onPointerDown(event);
      }}
    >
      <Block node={node} selectable />
      <DropGhost ghost={ghost} />
    </div>
  );
}

export interface TopLevelChildrenProps {
  nodes: HierarchyNodeRef[];
}

/** Renders the true root's direct children (the top-level Systems) as independently positioned,
 * freely draggable boxes instead of the ordinary flow-grid `block-children` container every deeper
 * level still uses — the one place in the main hierarchy canvas that gets Miro-style
 * repositioning, mirroring how C1 only makes its top-rank boxes draggable while their interiors
 * stay flow-laid-out. Each child's own subtree renders through a plain, untouched `Block`, so
 * nested expand/collapse is completely unaffected. */
export function TopLevelChildren({ nodes }: TopLevelChildrenProps) {
  // These boxes are position: absolute, so CanvasViewport's own .canvas-content ResizeObserver never
  // sees them grow -- bump canvasLayoutStore ourselves or the ConnectionsOverlay's arrows freeze at
  // a box's pre-expand geometry.
  const { sizes, observe } = useMeasuredSizes<TopLevelBoxSize>({
    onResize: () => canvasLayoutStore.bump(),
  });
  const layout = useMemo(() => gridLayout(nodes, sizes), [nodes, sizes]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.node_id, node])), [nodes]);

  const { savedOffsets, dragOffsets, handleOffsetChange, handleCommit, handleCommitMany } =
    useSavedLayout("hierarchy");

  const width = Math.max(0, ...layout.map((box) => box.x + box.width));
  const height = Math.max(0, ...layout.map((box) => box.y + box.height));

  if (!savedOffsets) return null;

  return (
    <div
      className="hierarchy-top-level"
      data-testid="hierarchy-top-level"
      style={{ position: "relative", width, height } as CSSProperties}
    >
      {layout.map((box) => {
        const node = nodeById.get(box.id);
        if (!node) return null;
        return (
          <DraggableTopLevelBox
            key={box.id}
            box={box}
            node={node}
            initialOffset={savedOffsets.get(box.id)}
            onOffsetChange={handleOffsetChange}
            onCommit={handleCommit}
            onCommitMany={handleCommitMany}
            dragOffsets={dragOffsets}
            measure={observe}
          />
        );
      })}
    </div>
  );
}
