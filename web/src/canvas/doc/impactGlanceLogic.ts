import type { CanvasDoc, ImpactBlockChange } from "../../state/types";

/** The one-line "before → after" for a touched box, or null when the review wrote neither side. */
export function beforeAfterLine(change: ImpactBlockChange): string | null {
  const before = change.before?.trim();
  const after = change.after?.trim();
  if (before && after) return `${before} → ${after}`;
  return after || before || null;
}

const callerCountCache = new WeakMap<CanvasDoc["edges"], Map<string, number>>();

/** Distinct callers per element id, built in one pass per edges object and shared by every box. */
export function callerCountsOf(doc: CanvasDoc): Map<string, number> {
  const cached = callerCountCache.get(doc.edges);
  if (cached) return cached;
  const callers = new Map<string, Set<string>>();
  for (const edge of Object.values(doc.edges)) {
    if (edge.from === edge.to) continue;
    const set = callers.get(edge.to) ?? new Set<string>();
    set.add(edge.from);
    callers.set(edge.to, set);
  }
  const counts = new Map([...callers].map(([id, set]) => [id, set.size] as const));
  callerCountCache.set(doc.edges, counts);
  return counts;
}
