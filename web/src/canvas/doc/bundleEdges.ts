import type { CanvasEdge } from "../../state/types";

/** Collapses parallel edges (same from → to, layer, kind, origin and transport) into one carrying a `×N` count and every distinct label; singles pass through. */
export function bundleEdges(edges: readonly CanvasEdge[]): CanvasEdge[] {
  const groups = new Map<string, CanvasEdge[]>();
  for (const edge of edges) {
    const key = [edge.from, edge.to, edge.layer, edge.kind, edge.origin ?? "", edge.transport ?? ""].join("\u0000");
    const group = groups.get(key);
    if (group) group.push(edge);
    else groups.set(key, [edge]);
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const first = group[0];
    const labels = [...new Set(group.map((edge) => edge.label).filter(Boolean))];
    const base = labels.length ? labels.join(" · ") : first.kind || "";
    return {
      ...first,
      label: base ? `${base} ×${group.length}` : `×${group.length}`,
      hero: group.some((edge) => edge.hero),
    };
  });
}
