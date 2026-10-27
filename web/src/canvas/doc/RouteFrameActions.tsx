import type { CanvasElement } from "../../state/types";
import { routeStore } from "../../state/routeStore";
import { RouteLegend } from "./RouteLegend";
import { useRouteCarriers } from "./canvasDocStore";
import { routeFor } from "./routeStep";

/** The route legend and the Show route button on a diagram frame header. */
export function RouteFrameActions({ members }: { members: CanvasElement[] }) {
  const carriers = useRouteCarriers();
  const owner = members.find((member) => member.meta?.route_id !== undefined || member.meta?.route !== undefined);
  const route = owner ? routeFor(owner, carriers) : undefined; // every box of a layer names the same route
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
