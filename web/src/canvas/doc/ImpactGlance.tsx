import { useSyncExternalStore } from "react";
import type { CanvasDoc, ImpactBlockChange } from "../../state/types";
import { canvasDocStore } from "./canvasDocStore";
import { beforeAfterLine, callerCountsOf } from "./impactGlanceLogic";

/** This box's caller count; subscribes to a number, so a doc change re-renders only boxes whose count moved. */
function useCallerCount(elementId: string, doc: CanvasDoc | undefined): number {
  const live = useSyncExternalStore(
    canvasDocStore.subscribe,
    () => callerCountsOf(canvasDocStore.getDoc()).get(elementId) ?? 0,
  );
  return doc ? (callerCountsOf(doc).get(elementId) ?? 0) : live;
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
  const callers = useCallerCount(elementId, doc);
  if (!change) return null;
  const line = beforeAfterLine(change);
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
