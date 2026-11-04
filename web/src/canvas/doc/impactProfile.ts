import type { DiagramProfile } from "./diagramProfiles";
import { IMPACT_LAYER, impactBoardNeedsReflow, impactFrameBounds, layoutImpactBoard } from "./impactBoardLayout";
import { ImpactFolderFrames } from "./ImpactFolderFrames";

/** The Impact "change at a glance" board: folder-grouped cards, a summary bar above and the outside strip below. */
export const IMPACT_PROFILE: DiagramProfile = {
  id: "impact",
  matches: (layer) => layer === IMPACT_LAYER,
  // The frame holds the folders plus the summary bar above them and the outside strip below them (ImpactBoard).
  frameBounds: impactFrameBounds,
  frameClassName: "canvas-diagram-frame-impact-board",
  hideLaneBands: true,
  // Neutral grey heads for plain links, the walkthrough's green route head for the hero edge.
  edgeMarker: (visual, edge) => (edge.hero ? "route" : visual === "bundle" ? undefined : "impact"),
  Overlay: ImpactFolderFrames,
  layout: layoutImpactBoard,
  needsReflow: impactBoardNeedsReflow,
};
