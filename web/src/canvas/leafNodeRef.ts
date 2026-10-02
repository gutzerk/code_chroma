import type { HierarchyNodeRef } from "../state/types";

/** Synthesises a degenerate leaf HierarchyNodeRef for a DiffView whose real node isn't fetchable —
 * pattern boxes and deleted-function overlays both need DiffView to render standalone despite having
 * no full node. The ref only ever feeds DiffView's name + language, so the constant fields are filler
 * required by the shared type, not semantics. */
export function leafNodeRef(
  nodeId: string,
  name: string,
  level: HierarchyNodeRef["level"],
  language?: string,
): HierarchyNodeRef {
  return { node_id: nodeId, name, level, parent_id: null, has_children: false, child_count: 0, language };
}
