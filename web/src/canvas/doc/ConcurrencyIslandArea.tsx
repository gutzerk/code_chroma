import type { CanvasElement } from "../../state/types";
import type { MeasuredBoxSize } from "../useMeasuredSizes";
import { unionBoundsOf } from "./boundingBox";
import { concurrencyIslandColorIndex } from "./concurrencyIslandColor";
import { SoftAreaFrame } from "./SoftAreaFrame";

const PADDING = { side: 16, top: 32, bottom: 16 };

export interface ConcurrencyIslandAreaProps {
  /** The shared leading `order` digit run (e.g. `"2"` for both `"2a"` and `"2b"`) every member below
   * carries -- CONTEXT.md's "Concurrency island". Purely derived from parsed `order` values, never
   * its own authored field. */
  digits: string;
  /** Every visible element whose `order` shares this leading digit run, live-drag-adjusted the same
   * way `GroupFrame`'s own `members` are -- see `CanvasDocView.tsx`. Only ever called with 2+
   * members: a lone numbered step has nothing to be concurrent with. */
  members: CanvasElement[];
  sizes: ReadonlyMap<string, MeasuredBoxSize>;
}

/**
 * A Concurrency island's soft, tinted background area — boxes whose `order` shares a leading digit
 * (e.g. `"2a"`/`"2b"`) rendered as one visually grouped zone (054-diagram-flow-order), independent of
 * `Lane`: a box can sit in one Lane and one island at once, so this and `LaneArea` render as two
 * separate, differently-colored areas rather than merging into one. Renders through the same
 * `SoftAreaFrame` as `GroupFrame`/`LaneArea`, with its own hash/palette
 * (`concurrencyIslandColor.ts`) so an island's *color* never coincides with theirs even where a box
 * belongs to more than one at once. Renders nothing for an empty (or single-member — not actually
 * concurrent) group; `CanvasDocView` is what filters those out before this ever mounts.
 */
export function ConcurrencyIslandArea({ digits, members, sizes }: ConcurrencyIslandAreaProps) {
  const bounds = unionBoundsOf(members, sizes);
  if (!bounds) return null;

  return (
    <SoftAreaFrame
      bounds={bounds}
      padding={PADDING}
      className={`canvas-concurrency-island canvas-concurrency-island-color-${concurrencyIslandColorIndex(digits)}`}
      testId="canvas-concurrency-island"
      labelClassName="canvas-concurrency-island-label"
      label={`Concurrent: ${digits}`}
    />
  );
}
