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

/** Key identifying a bundled (collapsed, count > 1) edge in `layoutDiagramEdges`'s output. */
export function bundleKeyOf(edge: Pick<CanvasEdge, "from" | "to" | "kind" | "label">): string {
  return [edge.from, edge.to, edge.kind, edge.label].join("\u0000");
}

/** The keys (`bundleKeyOf`) of the edges `bundleEdges` collapsed from several parallel ones. */
export function bundledKeys(original: readonly CanvasEdge[], bundled: readonly CanvasEdge[]): Set<string> {
  const singles = new Set(original.map((edge) => bundleKeyOf(edge)));
  return new Set(bundled.filter((edge) => !singles.has(bundleKeyOf(edge))).map(bundleKeyOf));
}
