import type { DiagramProfile } from "./diagramProfiles";

/** A4 sequence board: owned by its members' render (sequence layers are named per diagram). */
export const SEQUENCE_PROFILE: DiagramProfile = {
  id: "sequence",
  matches: (_layer, members) => members.some((member) => member.render === "sequence"),
};
