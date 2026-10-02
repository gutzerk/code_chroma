import type { HTMLAttributes } from "react";
import type { UnionBounds } from "./boundingBox";

export interface SoftAreaFramePadding {
  side: number;
  top: number;
  bottom: number;
}

export interface SoftAreaFrameProps {
  bounds: UnionBounds;
  padding: SoftAreaFramePadding;
  /** Applied to the outer `div` alongside the shared positioning style -- carries both the "what kind
   * of area is this" class and, where one applies, the per-instance color class (e.g.
   * `"canvas-lane-area canvas-lane-area-color-3"`). */
  className: string;
  testId: string;
  labelClassName: string;
  label: string;
  /** Optional pass-through div props for the one interactive caller (`DiagramFrame`'s own drag
   * handle) -- every purely decorative caller (`GroupFrame`/`LaneArea`/`ConcurrencyIslandArea`) omits
   * this and stays exactly as inert as before; it doesn't make any of them interactive on its own. */
  interactiveProps?: HTMLAttributes<HTMLDivElement>;
}

/**
 * The one shared shape behind every member-bounding-box overlay on the canvas — `GroupFrame` (a real
 * structural group), `LaneArea`, `ConcurrencyIslandArea` (both derived, 054-diagram-flow-order), and
 * `DiagramFrame` (a whole diagram's own frame): an absolutely-positioned `div` sized to `bounds` plus
 * padding, with a label `span` inside. Visual differences (border vs. borderless, tint alpha, color)
 * live entirely in each caller's own CSS class — this component only ever computes the shared left/
 * top/width/height arithmetic once, so the four callers can't drift out of sync with each other on
 * that math.
 */
export function SoftAreaFrame({
  bounds,
  padding,
  className,
  testId,
  labelClassName,
  label,
  interactiveProps,
}: SoftAreaFrameProps) {
  const { left, top, right, bottom } = bounds;
  return (
    <div
      className={className}
      data-testid={testId}
      style={{
        position: "absolute",
        left: left - padding.side,
        top: top - padding.top,
        width: right - left + padding.side * 2,
        height: bottom - top + padding.top + padding.bottom,
      }}
      {...interactiveProps}
    >
      <span className={labelClassName}>{label}</span>
    </div>
  );
}
