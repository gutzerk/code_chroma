import { useEffect, useRef } from "react";
import type { CanvasElement } from "../../state/types";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import type { MeasuredBoxSize } from "../useMeasuredSizes";
import { useGroupDrag } from "../collision/useGroupDrag";
import { elementDragPointerDown } from "../useDragOffset";
import { unionBoundsOf } from "./boundingBox";
import { canvasDocStore, commitCanvasPositions } from "./canvasDocStore";
import { diagramFrameColorClass } from "./diagramFrameColor";
import { dragOffsetStore } from "./dragOffsetStore";
import { SoftAreaFrame } from "./SoftAreaFrame";

// The larger of GroupFrame's/LaneArea's/ConcurrencyIslandArea's own padding on each side (currently
// GroupFrame's 32/48/32) plus NESTED_GAP: this frame is meant to enclose all three, and any of them
// can legitimately sit at a diagram's own outer edge (its topmost/bottommost/etc. members) -- equal
// padding cleared that but left the two borders flush, reading as one merged box; NESTED_GAP is the
// deliberate breathing room between an inner frame's edge and this one's.
const NESTED_GAP = 8;
// This frame's own title label (`.canvas-diagram-frame-label`: `top: 12px`, `font-size: 0.85rem`)
// sits inside the top padding band, above the topmost member's own title -- the border-nesting term
// above never reserved room for that, so a plain (non-nested) topmost member's title could sit close
// enough to visually crowd the diagram's own title. Add the label's own rendered height (offset +
// an assumed 1.4 line-height, matching this file's own text conventions) plus 15% of its font size
// as breathing room, so the two titles never read as touching.
const DIAGRAM_LABEL_FONT_PX = 13.6; // 0.85rem at the project's unscaled 16px root
const DIAGRAM_LABEL_TOP_OFFSET_PX = 12; // matches `.canvas-diagram-frame-label`'s `top: 12px`
const DIAGRAM_LABEL_LINE_HEIGHT_PX = Math.ceil(DIAGRAM_LABEL_FONT_PX * 1.4);
const DIAGRAM_LABEL_CLEARANCE_PX = Math.ceil(
  (DIAGRAM_LABEL_TOP_OFFSET_PX + DIAGRAM_LABEL_LINE_HEIGHT_PX) * 1.15,
);
const PADDING = {
  side: 32 + NESTED_GAP,
  top: 48 + NESTED_GAP + DIAGRAM_LABEL_CLEARANCE_PX,
  bottom: 32 + NESTED_GAP,
};

export interface DiagramFrameProps {
  /** The diagram's own layer key (`c1`/`patterns`/`impact`/`epics`/`custom/<id>`/a one-off
   * skill-authored layer) -- both the color lookup and the drag's own membership test key off this. */
  layer: string;
  /** The diagram's display name (`diagramCatalog.ts`'s `labelForDiagramLayer`) -- shown top-left on
   * the frame, the same label the Diagrams tab already uses for this layer. */
  label: string;
  /** Every visible element on this layer, positions already live-drag-adjusted the same way
   * GroupFrame's own `members` are (CanvasDocView's `visibleDoc`) -- so the frame tracks a member
   * being dragged individually, not just once that drag commits. */
  members: CanvasElement[];
  sizes: ReadonlyMap<string, MeasuredBoxSize>;
}

/**
 * A dashed frame around one whole diagram (a canvas layer), sized to enclose every visible member's
 * current bounds -- rendered through the same shared `SoftAreaFrame` `GroupFrame`/`LaneArea`/
 * `ConcurrencyIslandArea` use (so the bounding-box arithmetic lives in exactly one place), but it is
 * deliberately its own component rather than a fourth entry in that family: unlike them, it is
 * genuinely interactive (the whole frame is a drag handle), which would break the "purely decorative,
 * steals no pointer event" contract the other three share. `SoftAreaFrame`'s own `interactiveProps`
 * is what lets this stay a real caller of the shared shape without making any of the other three
 * interactive by accident -- they simply never pass it.
 *
 * Dragging anywhere on the frame (its dashed border/background, wherever no box already covers that
 * spot) moves every element on this layer together with one shared pointer delta -- the same
 * no-collision-solving group move `CanvasNodeBox`'s own multi-select group drag already does
 * (`collision/useGroupDrag.ts`), just keyed by "shares this layer" instead of a manual selection.
 * Renders nothing once its layer has no visible members left (collapsed via the Diagrams tab, or
 * every element removed).
 */
export function DiagramFrame({ layer, label, members, sizes }: DiagramFrameProps) {
  const engineClient = useEngineClient();
  const bounds = unionBoundsOf(members, sizes);

  // Every id this gesture has pushed a live offset for, so an aborted drag (this component unmounts
  // mid-gesture -- e.g. another window/agent deletes the diagram while someone is dragging its frame)
  // can still be cleaned up: onGroupCommit deletes an id from here the instant it clears the store for
  // it, so only a genuinely still-in-flight id is left by the time the unmount effect below runs.
  const trackedIdsRef = useRef<Set<string>>(new Set());

  const group = useGroupDrag({
    suppressClickAfterDrag: true,
    selectedIds: () => members.map((member) => member.id),
    // Only ever read once, at drag-start (useGroupDrag's own pointerdown handler) -- an imperative
    // store read here, rather than a reactive useLiveDragOffsets() subscription, means dragging one
    // diagram's frame doesn't re-render every OTHER diagram's frame on every pointer-move frame.
    getOffset: (id) => dragOffsetStore.getAll()[id] ?? { x: 0, y: 0 },
    onGroupPreview: (offsets) => {
      // One batched store write for every member (see dragOffsetStore.setMany) -- a per-id `set`
      // loop here used to fan out into one full-canvas re-render broadcast per member, per frame,
      // which is what made a diagram with more than a couple of boxes visibly lag behind the cursor.
      dragOffsetStore.setMany(offsets);
      for (const id of Object.keys(offsets)) trackedIdsRef.current.add(id);
    },
    onGroupCommit: (offsets) => {
      const doc = canvasDocStore.getDoc();
      const positions: Record<string, { x: number; y: number }> = {};
      for (const [id, offset] of Object.entries(offsets)) {
        const el = doc.elements[id];
        if (!el) continue;
        positions[id] = { x: el.position.x + offset.x, y: el.position.y + offset.y };
        dragOffsetStore.clear(id);
        trackedIdsRef.current.delete(id);
      }
      commitCanvasPositions(engineClient, positions);
    },
  });

  // Runs once, only on true unmount -- clears whatever a drag this component's own handle started
  // never got to commit, so an aborted gesture never leaves a box rendering permanently offset.
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a mutable id Set, not a DOM node ref
      for (const id of trackedIdsRef.current) dragOffsetStore.clear(id);
    };
  }, []);

  if (!bounds) return null;

  const classes = [
    "canvas-diagram-frame",
    diagramFrameColorClass(layer),
    group.isDragging ? "canvas-diagram-frame--dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <SoftAreaFrame
      bounds={bounds}
      padding={PADDING}
      className={classes}
      testId="canvas-diagram-frame"
      labelClassName="canvas-diagram-frame-label"
      label={label}
      interactiveProps={{
        role: "button",
        tabIndex: 0,
        "aria-label": `Drag to move the ${label} diagram`,
        onPointerDown: elementDragPointerDown(group.handleProps),
      }}
    />
  );
}
