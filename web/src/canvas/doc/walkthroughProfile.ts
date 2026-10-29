import type { DiagramProfile } from "./diagramProfiles";
import { WALKTHROUGH_LAYER } from "./walkthroughLayout";

/** B2 walkthrough board: the one layer whose ROUTE panel is drawn inside its own frame. */
export const WALKTHROUGH_PROFILE: DiagramProfile = {
  id: "walkthrough",
  matches: (layer) => layer === WALKTHROUGH_LAYER,
  // The route arrows take the board's smaller green head and carry no kind word.
  edgeMarker: (visual) => (visual === "call" || visual === "spawn" ? "route" : undefined),
  edgeLabel: (edge) => edge.label || "",
};
