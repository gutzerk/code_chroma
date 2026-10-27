import type { CanvasElement } from "../../state/types";
import { routeStore } from "../../state/routeStore";
import { RouteLegend } from "./RouteLegend";
import { routeOf } from "./routeStep";

/** The route legend and the Show route button on a diagram frame header. */
export function RouteFrameActions({ members }: { members: CanvasElement[] }) {
  const route = members.map(routeOf).find(Boolean); // routeOf is cached per meta object, so this is cheap
  if (!route) return null;
  return (
    <span className="canvas-diagram-frame-route">
      <RouteLegend />
      <button type="button" className="sequence-mode-btn" data-testid="show-route" onClick={() => routeStore.show(route)}>
        Show route
      </button>
    </span>
  );
}
