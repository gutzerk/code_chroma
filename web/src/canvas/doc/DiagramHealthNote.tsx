import { useState } from "react";
import { useEngineClient } from "../../engine-client/EngineClientContext";
import { useDiagramHealth } from "../../state/diagramHealthStore";
import { useDiagramGeneration } from "../../state/useDiagramGeneration";
import type { DiagramDrop } from "../../state/types";

/** Plain-English label per bridge reason slug (`diagram_diagnostics.py`'s `REASONS`). */
const REASON_LABELS: Record<string, string> = {
  invalid_shape: "wrong shape",
  unknown_kind: "unrecognized kind",
  dangling_endpoint: "points at a box that isn't there",
  self_relation: "connects a box to itself",
  duplicate_sibling_id: "repeats a sibling's id",
  depth_capped: "below the depth limit",
  unresolved_path: "its path matches no code",
  status_coerced: "unrecognized status",
};

/** At most this many individual reasons before the note collapses to a bare count. */
const REASONS_SHOWN = 3;

/**
 * The "this diagram is not all there" line, and the one place a failed generation's error is shown.
 *
 * 🔴 Both existed and were invisible. Every resolver dropped a malformed node or a dangling arrow
 * silently, so a skill that wrote twenty typo'd nodes produced the same blank canvas as one that
 * wrote nothing. Separately, `DiagramGenerationStatus.error` reached the browser over two transports
 * and was rendered by no component at all.
 *
 * Same chrome contract as `SidecarSummaryCard`'s "coverage" variant (mounted beside it in `RootCanvas`, outside
 * `CanvasViewport`): screen-fixed rather than a child of `.canvas-content`, so it neither zooms with
 * the camera nor drifts as blocks expand. Silent unless there is something to say.
 *
 * Never blocks a render: by the time the store has anything, `apply_batch` has already committed and
 * the canvas has already drawn whatever parsed. This is a note about the drawing, not the drawing.
 */
export function DiagramHealthNote() {
  const engineClient = useEngineClient();
  const health = useDiagramHealth();
  const generation = useDiagramGeneration(engineClient, "c1");
  const [dismissed, setDismissed] = useState<string[]>([]);

  const layers = Object.keys(health)
    .filter((layer) => !dismissed.includes(layer))
    .sort();
  const generationError = generation.state === "error" ? generation.error : null;
  if (layers.length === 0 && !generationError) return null;

  return (
    <div className="diagram-health-note" role="status" data-testid="diagram-health-note">
      {generationError && (
        <div className="diagram-health-error" data-testid="diagram-health-error">
          Last diagram run failed: {generationError}
        </div>
      )}
      {layers.map((layer) => (
        <div className="diagram-health-row" key={layer} data-testid={`diagram-health-${layer}`}>
          <span>
            <strong>{layer}</strong> — {summarize(health[layer].dropped, health[layer].dropped_count)}
          </span>
          <button
            type="button"
            className="diagram-health-dismiss"
            aria-label={`Dismiss the ${layer} diagram warning`}
            data-testid={`diagram-health-dismiss-${layer}`}
            onClick={() => setDismissed((current) => [...current, layer])}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** "3 parts not drawn: points at a box that isn't there, wrong shape" — count first, then why. */
function summarize(dropped: DiagramDrop[], total: number): string {
  const noun = total === 1 ? "part" : "parts";
  const reasons = [...new Set(dropped.map((drop) => REASON_LABELS[drop.reason] ?? drop.reason))];
  if (reasons.length === 0) return `${total} ${noun} not drawn`;
  const shown = reasons.slice(0, REASONS_SHOWN).join(", ");
  const more = reasons.length > REASONS_SHOWN ? ", …" : "";
  return `${total} ${noun} not drawn: ${shown}${more}`;
}
