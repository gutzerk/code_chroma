import type { DiagramProfile } from "./diagramProfiles";
import { boundsWithWalkthroughPanel, WALKTHROUGH_LAYER } from "./walkthroughLayout";

/** B2 walkthrough board: the one layer whose ROUTE panel is drawn inside its own frame. */
export const WALKTHROUGH_PROFILE: DiagramProfile = {
  id: "walkthrough",
  matches: (layer) => layer === WALKTHROUGH_LAYER,
  // The ROUTE panel is part of the diagram (WalkthroughPanel), so the frame encloses it too.
  frameBounds: (base, { route }) => (route ? boundsWithWalkthroughPanel(base, route) : base),
  // The route arrows take the board's smaller green head and carry no kind word.
  edgeMarker: (visual) => (visual === "call" || visual === "spawn" ? "route" : undefined),
  edgeLabel: (edge) => edge.label || "",
};
