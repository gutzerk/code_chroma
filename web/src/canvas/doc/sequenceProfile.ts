import type { DiagramProfile } from "./diagramProfiles";
import { sequenceBoardBounds, sequenceBoardSignature } from "./sequenceBoard";
import { SequenceModeSwitch } from "./SequenceModeSwitch";
import { sequenceViewStore } from "./sequenceViewStore";

/** A4 sequence board: owned by its members' render (sequence layers are named per diagram). */
export const SEQUENCE_PROFILE: DiagramProfile = {
  id: "sequence",
  matches: (_layer, members) => members.some((member) => member.render === "sequence"),
  // The frame encloses the whole board: phase pills above the lanes and the legend below them.
  frameBounds: (base, { layer, members }) => sequenceBoardBounds([...members], sequenceViewStore.get(layer).expanded) ?? base,
  boundsKey: (members, layer) => `${sequenceBoardSignature(members)}#${sequenceViewStore.get(layer).expanded.join("|")}`,
  frameClassName: "canvas-diagram-frame-sequence-board",
  HeaderAction: SequenceModeSwitch,
};
