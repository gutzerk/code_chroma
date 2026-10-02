import type { CanvasElement } from "../../state/types";
import type { Rect } from "../connectors/orthogonalRoute";
import type { MeasuredBoxSize } from "../useMeasuredSizes";

/** The one canvas-doc box default -- CanvasNodeBox's own left/top/width/height, CanvasEdges'
 * arrow-routing rect, CanvasDocView's page-extent `bounds`, and GroupFrame's member bounds all fall
 * back to this when `element.size` is unset, so it lives in exactly one place. */
export const DEFAULT_ELEMENT_SIZE = { w: 220, h: 72 };

/** An element's real on-screen rect: `element.size` (or the default above) centered on `position`,
 * refined by its real DOM-measured box (`useMeasuredSizes`) once one exists. A box only ever grows
 * right/down past its assumed footprint -- `left`/`top` stay pinned to the *assumed* half-width/
 * height, only `width`/`height` (and the margin `left`/`top` shift with) prefer the measured value
 * -- see useMeasuredSizes.ts's own doc comment for why. Shared by CanvasEdges (arrow routing),
 * CanvasDocView (page extent), and GroupFrame (member bounds). */
export function elementRect(
  element: CanvasElement,
  sizes?: ReadonlyMap<string, MeasuredBoxSize>,
): Rect {
  const assumedWidth = element.size?.w ?? DEFAULT_ELEMENT_SIZE.w;
  const assumedHeight = element.size?.h ?? DEFAULT_ELEMENT_SIZE.h;
  const measured = sizes?.get(element.id);
  return {
    left: element.position.x - assumedWidth / 2 + (measured?.marginLeft ?? 0),
    top: element.position.y - assumedHeight / 2 + (measured?.marginTop ?? 0),
    width: measured?.width ?? assumedWidth,
    height: measured?.height ?? assumedHeight,
  };
}
