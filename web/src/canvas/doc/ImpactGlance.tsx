import { useSyncExternalStore } from "react";
import type { CanvasDoc, ImpactBlockChange } from "../../state/types";
import { canvasDocStore } from "./canvasDocStore";
import { barWidths, beforeAfterLine, callerCountsOf, changeSizeOf, sizeLabels } from "./impactGlanceLogic";

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
  const size = changeSizeOf(change);
  const labels = sizeLabels(size);
  const isGhost = change.status === "removed" && !size.known && !size.testKnown;
  if (!line && callers === 0 && !labels.main && !labels.test && !isGhost) return null;
  const isSymbol = /::(function|class|method)::/.test(change.node_id);
  const bar = barWidths(size.add, size.del);
  return (
    <div className="canvas-node-box-glance" data-testid="impact-glance">
      {line && (
        <span className="canvas-node-box-glance-line" title={line}>
          {line}
        </span>
      )}
      {isGhost && (
        <span className="impact-size impact-size--removed" data-testid="impact-size">
          removed
        </span>
      )}
      {(labels.main || labels.test) && (
        <span className="impact-size" data-testid="impact-size">
          {labels.main && (
            <>
              <span className="impact-size-bar" aria-hidden="true">
                <span className="impact-size-add" style={{ width: bar.add }} />
                <span className="impact-size-del" style={{ width: bar.del }} />
              </span>
              {isSymbol && (
                <span className="impact-size-scope" title="The diff is counted per file, not per symbol">
                  file
                </span>
              )}
              <span className="impact-size-plus">{`+${size.add}`}</span>
              <span className="impact-size-minus">{`−${size.del}`}</span>
            </>
          )}
          {labels.test && <span className="impact-size-test">{labels.test}</span>}
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
