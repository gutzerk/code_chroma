import { useEngineClient } from "../../engine-client/EngineClientContext";
import { useCoverageSidecar } from "../../state/useSidecar";
import { useDiagramGeneration } from "../../state/useDiagramGeneration";

/** The "your blocks name 312 of 418 files" line for the C1 layer -- the only place a curated diagram
 * admits it is curated, so it points at the "Unmapped code" block that holds the rest. Screen-fixed
 * chrome, not canvas furniture (see the file docstring below for why). Silent unless there is both a
 * diagram and something outside it. */
function CoverageLine() {
  const engineClient = useEngineClient();
  const coverage = useCoverageSidecar(engineClient);
  const generation = useDiagramGeneration(engineClient, "c1");
  // A run in flight is rewriting the very blocks these counts describe.
  if (generation.state === "generating") return null;
  if (!coverage?.has_diagram || coverage.unmapped_files === 0) return null;
  return (
    <div className="c1-coverage-note" role="status" data-testid="c1-coverage-note">
      Diagram covers {coverage.covered_files} of {coverage.total_files} files ·{" "}
      {coverage.unmapped_files} in <strong>Unmapped code</strong> inside the system box
    </div>
  );
}

/**
 * Replaces `C1CoverageNote.tsx` (037, US2) -- a generic read of the coverage sidecar store instead
 * of a bespoke component. Mounted in `RootCanvas`, outside `CanvasViewport` -- deliberately
 * screen-fixed chrome (unlike `ImpactChangeSummary`, which pans/zooms with the diagram it annotates):
 * an absolutely-positioned child of `.canvas-content` would drift as blocks expand. Used to also
 * carry a "review" variant (the Impact judgmental review's floating panel), removed rather than
 * left half-wired (038 follow-up) once the review sidecar itself was removed.
 */
export function SidecarSummaryCard() {
  return <CoverageLine />;
}
