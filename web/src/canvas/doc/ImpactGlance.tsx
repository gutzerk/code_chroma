import type { CanvasDoc, ImpactBlockChange } from "../../state/types";
import { useCanvasDoc } from "./canvasDocStore";
import { neighboursOf } from "./focusNeighbors";

/** The one-line "before → after" for a touched box, or null when the review wrote neither side. */
export function beforeAfterLine(change: ImpactBlockChange): string | null {
  const before = change.before?.trim();
  const after = change.after?.trim();
  if (before && after) return `${before} → ${after}`;
  return after || before || null;
}

/** Impact at a glance (022 Stage 4): per touched box, the one-line before/after and its caller count. */
export function ImpactGlance({
  change,
  doc,
  elementId,
}: {
  change: ImpactBlockChange | undefined;
  doc?: CanvasDoc;
  elementId: string;
}) {
  const liveDoc = useCanvasDoc();
  if (!change) return null;
  const line = beforeAfterLine(change);
  const callers = neighboursOf(doc ?? liveDoc, elementId).calledBy.length;
  if (!line && callers === 0) return null;
  return (
    <div className="canvas-node-box-glance" data-testid="impact-glance">
      {line && (
        <span className="canvas-node-box-glance-line" title={line}>
          {line}
        </span>
      )}
      {callers > 0 && (
        <span className="canvas-node-box-glance-callers" data-testid="impact-glance-callers">
          {`${callers} caller${callers === 1 ? "" : "s"}`}
        </span>
      )}
    </div>
  );
}
