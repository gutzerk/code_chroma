import type { CanvasElement } from "../../state/types";
import type { Rect } from "../connectors/orthogonalRoute";
import type { MeasuredBoxSize } from "../useMeasuredSizes";

/** The one canvas-doc box default -- CanvasNodeBox's own left/top/width/height, CanvasEdges'
 * arrow-routing rect, CanvasDocView's page-extent `bounds`, and GroupFrame's member bounds all fall
 * back to this when `element.size` is unset, so it lives in exactly one place. */
export const DEFAULT_ELEMENT_SIZE = { w: 300, h: 72 };

/** An element's real on-screen rect: `element.size` (or the default above) centered on `position`,
 * refined by its real DOM-measured box (`useMeasuredSizes`) once one exists. A box only ever grows
 * right/down past its assumed footprint -- `left`/`top` stay pinned to the *assumed* half-width/
 * height, only `width`/`height` (and the margin `left`/`top` shift with) prefer the measured value
 * -- see useMeasuredSizes.ts's own doc comment for why. Shared by CanvasEdges (arrow routing),
 * CanvasDocView (page extent), and GroupFrame (member bounds). */
/** `epic`/`spec`/`task` are epics-diagram-exclusive renders, so the "position = bottom-left corner"
 * convention can branch on render without touching any other diagram type. */
export const BOTTOM_LEFT_RENDERS = new Set<CanvasElement["render"]>(["epic", "spec", "task"]);

export function elementRect(
  element: CanvasElement,
  sizes?: ReadonlyMap<string, MeasuredBoxSize>,
): Rect {
  const assumedWidth = element.size?.w ?? DEFAULT_ELEMENT_SIZE.w;
  const assumedHeight = element.size?.h ?? DEFAULT_ELEMENT_SIZE.h;
  const measured = sizes?.get(element.id);
  const width = measured?.width ?? assumedWidth;
  const height = measured?.height ?? assumedHeight;
  const useBottomLeft = BOTTOM_LEFT_RENDERS.has(element.render);
  // For an epics box, `position` is its bottom-left corner (left = x, bottom-edge y = y), so the
  // top is `y - assumedHeight`, pinned to the assumed (not measured) footprint — matching how
  // CanvasNodeBox renders it (top = y - height, with height = the assumed default) and keeping
  // center- and bottom-left boxes consistent (center pins top = y - assumedHeight/2). Only width/
  // height prefer the measured value; a box grows down/right, so the group frame covers the whole
  // real box either way. Every other box centers on `position` as before.
  return {
    left: useBottomLeft
      ? element.position.x + (measured?.marginLeft ?? 0)
      : element.position.x - assumedWidth / 2 + (measured?.marginLeft ?? 0),
    top: useBottomLeft
      ? element.position.y - assumedHeight + (measured?.marginTop ?? 0)
      : element.position.y - assumedHeight / 2 + (measured?.marginTop ?? 0),
    width,
    height,
  };
}
