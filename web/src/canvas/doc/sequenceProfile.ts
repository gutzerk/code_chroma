import type { DiagramProfile } from "./diagramProfiles";
import { layoutSequence, sequenceBoardBounds, sequenceBoardSignature, viewSequenceElements } from "./sequenceBoard";
import { SequenceDiagram } from "./SequenceDiagram";
import { SequenceModeSwitch } from "./SequenceModeSwitch";
import { sequenceViewStore } from "./sequenceViewStore";

/** A4 sequence board: owned by its members' render (sequence layers are named per diagram). */
export const SEQUENCE_PROFILE: DiagramProfile = {
  id: "sequence",
  matches: (_layer, members) => members.some((member) => member.render === "sequence"),
  // The frame encloses the whole board: phase pills above the lanes and the legend below them.
  frameBounds: (_base, { layer, members }) => sequenceBoardBounds([...members], sequenceViewStore.get(layer).expanded),
  boundsKey: (members, layer) => `${sequenceBoardSignature(members)}#${sequenceViewStore.get(layer).expanded.join("|")}`,
  frameClassName: "canvas-diagram-frame-sequence-board",
  HeaderAction: SequenceModeSwitch,
  layout: (doc, ids) => layoutSequence(doc, ids),
  Board: SequenceDiagram,
  // A4: expanded steps grow in place for display only; the layout version ignores the player step.
  viewElements: (doc, ids, layer) => viewSequenceElements(doc, ids, sequenceViewStore.get(layer)),
  viewStore: { subscribe: sequenceViewStore.subscribe, getVersion: sequenceViewStore.getLayoutVersion },
};
