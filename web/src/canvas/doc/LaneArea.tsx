import type { CanvasElement } from "../../state/types";
import type { MeasuredBoxSize } from "../useMeasuredSizes";
import { unionBoundsOf } from "./boundingBox";
import { laneColorIndex } from "./laneColor";
import { SoftAreaFrame } from "./SoftAreaFrame";

const PADDING = { side: 24, top: 40, bottom: 24 };

export interface LaneAreaProps {
  /** The authored `meta.lane` value every member below shares -- CONTEXT.md's "Lane" (a performer),
   * not a real structural `group_id`. */
  lane: string;
  /** Every visible element carrying this `meta.lane` value, live-drag-adjusted the same way
   * `GroupFrame`'s own `members` are -- see `CanvasDocView.tsx`. */
  members: CanvasElement[];
  sizes: ReadonlyMap<string, MeasuredBoxSize>;
}

/**
 * A Lane's soft, tinted background area — a derived grouping (054-diagram-flow-order), not a real
 * `group` element: there is no `Lane` entity in the document, only a `meta.lane` string repeated
 * across boxes, so this renders straight off the member list `CanvasDocView` hands it instead of
 * dispatching on `element.render` the way `GroupFrame` does. Deliberately borderless (no dashed
 * outline, unlike `GroupFrame`'s real structural group) so a dense diagram doesn't gain a second kind
 * of hard rectangle to read — the color alone is the signal. Renders through the same `SoftAreaFrame`
 * as `GroupFrame`/`ConcurrencyIslandArea`, with its own hash/palette (`laneColor.ts`) so a Lane's
 * *color* never coincides with theirs even where a box belongs to more than one at once. Renders
 * nothing for an empty member list.
 */
export function LaneArea({ lane, members, sizes }: LaneAreaProps) {
  const bounds = unionBoundsOf(members, sizes);
  if (!bounds) return null;

  return (
    <SoftAreaFrame
      bounds={bounds}
      padding={PADDING}
      className={`canvas-lane-area canvas-lane-area-color-${laneColorIndex(lane)}`}
      testId="canvas-lane-area"
      labelClassName="canvas-lane-area-label"
      label={lane}
    />
  );
}
