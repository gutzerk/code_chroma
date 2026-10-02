import type { CanvasElement } from "../../state/types";
import type { MeasuredBoxSize } from "../useMeasuredSizes";
import { unionBoundsOf } from "./boundingBox";
import { groupColorIndex } from "./groupColor";
import { SoftAreaFrame } from "./SoftAreaFrame";

const PADDING = { side: 32, top: 48, bottom: 32 };

export interface GroupFrameProps {
  element: CanvasElement;
  /** Every element whose `group_id` points at `element.id`, positions already live-drag-adjusted
   * the same way CanvasDocView folds an in-progress drag into `visibleDoc` for edge routing — so
   * the frame tracks a member being dragged instead of only catching up once the drag commits. */
  members: CanvasElement[];
  /** Real DOM-measured sizes (CanvasDocView's `useMeasuredSizes`), same source CanvasEdges routes
   * off — a member's `element.size` is only ever a fallback for one not yet mounted/measured. */
  sizes: ReadonlyMap<string, MeasuredBoxSize>;
}

/**
 * A group's visual frame — a dashed rectangle sized to enclose its members' current on-screen
 * bounds (`unionBoundsOf`, `boundingBox.ts`, rendered via the shared `SoftAreaFrame`), recomputed
 * every render rather than stored on `element.size` (a member drag, resize, or layer toggle all need
 * it to move/grow immediately, not just after a PATCH round trip). Pure display: no drag/click of its
 * own, so it never steals a pointer event from a box it encloses. Renders nothing for a group with no
 * visible members (e.g. every member's layer is collapsed). `LaneArea`/`ConcurrencyIslandArea`
 * (054-diagram-flow-order) render through the same `SoftAreaFrame`, just borderless and with their
 * own color.
 */
export function GroupFrame({ element, members, sizes }: GroupFrameProps) {
  const bounds = unionBoundsOf(members, sizes);
  if (!bounds) return null;

  // Hashed off the group's own label, same as nodeAccent.tsx's per-box `meta.group` accent, so a
  // group with the same name reads as the same color wherever it shows up on the canvas.
  const colorClass = `canvas-group-frame-color-${groupColorIndex(element.label)}`;

  return (
    <SoftAreaFrame
      bounds={bounds}
      padding={PADDING}
      className={`canvas-group-frame ${colorClass}`}
      testId="canvas-group-frame"
      labelClassName="canvas-group-frame-label"
      label={element.label}
    />
  );
}
