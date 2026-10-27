const NODE_SELECTOR = "[data-node-id]";
const LIT_ATTR = "data-route-lit";
const DIM_ATTR = "data-route-dim";

/**
 * Lights the blocks in `litIds` and fades every other top-most block to the faded level, leaving the
 * rest present and clickable. A lit block's ancestors and descendants stay un-faded so nothing is
 * dimmed twice. Returns the cleanup that removes every attribute it set.
 */
export function applyRouteHighlight(root: ParentNode, litIds: ReadonlySet<string>): () => void {
  const all = [...root.querySelectorAll<HTMLElement>(NODE_SELECTOR)];
  const lit = all.filter((el) => litIds.has(el.dataset.nodeId ?? ""));
  const related = new Set<HTMLElement>();
  for (const el of lit) {
    el.setAttribute(LIT_ATTR, "true");
    for (let up: HTMLElement | null = el; up; up = up.parentElement?.closest<HTMLElement>(NODE_SELECTOR) ?? null) {
      related.add(up);
    }
    for (const inner of el.querySelectorAll<HTMLElement>(NODE_SELECTOR)) related.add(inner);
  }
  const dimmed: HTMLElement[] = [];
  for (const el of all) {
    if (related.has(el)) continue;
    const parent = el.parentElement?.closest<HTMLElement>(NODE_SELECTOR);
    if (parent && !related.has(parent)) continue;
    el.setAttribute(DIM_ATTR, "true");
    dimmed.push(el);
  }
  return () => {
    for (const el of lit) el.removeAttribute(LIT_ATTR);
    for (const el of dimmed) el.removeAttribute(DIM_ATTR);
  };
}
