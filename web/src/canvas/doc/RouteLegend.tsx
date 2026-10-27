import type { RouteKind } from "./routeStep";

const KIND_LABELS: Record<RouteKind, string> = {
  trigger: "Actor / trigger",
  decide: "Logic, no AI",
  ai: "AI step",
  check: "Check",
  data: "Data written",
  failure: "Failure",
};

/** The route legend as a collapsible card on the diagram frame: step kinds plus the expand/open cues. */
export function RouteLegend() {
  return (
    <details className="route-legend" data-testid="route-legend">
      <summary>Legend</summary>
      <ul className="route-legend-list">
        {(Object.keys(KIND_LABELS) as RouteKind[]).map((kind) => (
          <li key={kind}>
            <span className={`route-legend-swatch route-step--${kind}`} aria-hidden="true" />
            {KIND_LABELS[kind]}
          </li>
        ))}
        <li>▸ N calls: expand a step in place</li>
        <li>↗ open the source</li>
      </ul>
    </details>
  );
}
