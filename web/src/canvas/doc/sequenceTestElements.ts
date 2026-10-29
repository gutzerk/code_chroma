import type { CanvasDoc, CanvasElement } from "../../state/types";
import { layoutSequence } from "./autoLayout";

/** A sequence-layer element for tests; `meta` carries the role/from/to/order a diagram writes. */
export function seqElement(id: string, meta: Record<string, unknown>, overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    render: "sequence",
    layer: "seq",
    label: id,
    description: "",
    node_id: null,
    position: { x: 0, y: 0 },
    size: null,
    group_id: null,
    meta,
    created_by: "ai",
    ...overrides,
  };
}

export const participantEl = (id: string, kind?: string, overrides: Partial<CanvasElement> = {}): CanvasElement =>
  seqElement(id, { role: "participant", recipe_key: id, ...(kind ? { kind } : {}) }, { label: id.toUpperCase(), ...overrides });

export const messageEl = (id: string, from: string, to: string, order: string, extra: Record<string, unknown> = {}): CanvasElement =>
  seqElement(id, { role: "message", from, to, order, ...extra });

/** Places the elements the way the canvas persists them (layoutSequence), shifted by `at`. */
export function laidOut(elements: CanvasElement[], at = { x: 0, y: 0 }): CanvasElement[] {
  const doc = { elements: Object.fromEntries(elements.map((e) => [e.id, e])) } as unknown as CanvasDoc;
  const { positions, sizes } = layoutSequence(doc, elements.map((e) => e.id));
  return elements.map((e) => ({
    ...e,
    position: { x: positions[e.id].x + at.x, y: positions[e.id].y + at.y },
    size: sizes[e.id],
  }));
}
