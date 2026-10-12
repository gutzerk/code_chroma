import type { EngineClient } from "../../engine-client/EngineClient";
import type { CanvasDoc, CanvasElement, CanvasPosition, CanvasSize } from "../../state/types";
import { layoutNewElements } from "./autoLayout";
import { BLOCK_RULES } from "./elementRules";

// The seeded hierarchy tree is the one layer that is never auto-laid-out here.
const NEVER_PILED_LAYER = "hierarchy";

/** Per layer, the boxes still on the origin -- what any write that carries no positions (a
 * server-side recipe run, a position-less `PATCH /canvas`) leaves behind. When the whole layer is on
 * the origin it is a pile to lay out from scratch; when only some are, those are new boxes to slot in
 * next to the placed ones (`layoutNewElements` goes incremental then). A layer needs two or more boxes
 * so a lone box at (0,0) is not mistaken for one, `done` holds ids already auto-placed (so a finished
 * layout never re-triggers), and a locked-layout layer (sequence, epics) is only ever laid out whole. */
export function findUnplaced(
  doc: CanvasDoc,
  skipLayers: ReadonlySet<string>,
  done: ReadonlySet<string>,
): Record<string, string[]> {
  const byLayer = new Map<string, CanvasElement[]>();
  for (const element of Object.values(doc.elements)) {
    if (element.layer === NEVER_PILED_LAYER || skipLayers.has(element.layer)) continue;
    byLayer.set(element.layer, [...(byLayer.get(element.layer) ?? []), element]);
  }
  const unplaced: Record<string, string[]> = {};
  for (const [layer, elements] of byLayer) {
    if (elements.length < 2) continue;
    const orphans = elements.filter(
      (e) => e.position.x === 0 && e.position.y === 0 && !done.has(e.id),
    );
    const whole = orphans.length === elements.length;
    const locked = elements.some((e) => BLOCK_RULES[e.render].lockedLayout || e.render === "group");
    if (orphans.length > 0 && (whole || !locked)) unplaced[layer] = orphans.map((e) => e.id);
  }
  return unplaced;
}

/** The `update_element` ops that persist a layout's positions (and any derived sizes). */
export function layoutOps(
  positions: Record<string, CanvasPosition>,
  sizes?: Record<string, CanvasSize>,
) {
  return Object.entries(positions).map(([id, position]) => ({
    op: "update_element" as const,
    id,
    position,
    ...(sizes?.[id] ? { size: sizes[id] } : {}),
  }));
}

/** Runs the ELK layout over one layer's unplaced boxes and persists the result, whoever drew it. */
export async function layoutUnplaced(
  engineClient: EngineClient,
  doc: CanvasDoc,
  layer: string,
  ids: readonly string[],
): Promise<void> {
  const { positions, sizes } = await layoutNewElements(doc, ids);
  const ops = layoutOps(positions, sizes);
  if (ops.length === 0) return;
  const result = await engineClient.patchCanvas({
    ops,
    layer,
    explanation: "auto-layout unplaced boxes",
    confirm_mass_delete: false,
  });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "auto-layout rejected");
}
