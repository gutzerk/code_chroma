import { useEffect } from "react";
import type { CanvasElement } from "../../state/types";
import { routeStore, useRouteState } from "../../state/routeStore";
import { RouteLegend } from "./RouteLegend";
import { useLayerRoute, WALKTHROUGH_LAYER } from "./walkthroughLayout";

/** The route legend and the Show/Hide route toggle on a diagram frame header. */
export function RouteFrameActions({ members }: { members: CanvasElement[] }) {
  const { route, layer } = useLayerRoute(members);
  const shown = useRouteState().route?.id === route?.id;
  const isWalkthrough = layer === WALKTHROUGH_LAYER;
  // A walkthrough is read through its route over the code map, so it opens on its own (hiding it sticks until the route changes).
  useEffect(() => {
    if (route && isWalkthrough) routeStore.show(route);
  }, [route, isWalkthrough]);
  if (!route) return null;
  return (
    <span className="canvas-diagram-frame-route">
      {/* A walkthrough's legend lives in its in-diagram ROUTE panel. */}
      {!isWalkthrough && <RouteLegend />}
      <button
        type="button"
        className="sequence-mode-btn"
        data-testid="show-route"
        aria-pressed={shown}
        onClick={() => (shown ? routeStore.clear() : routeStore.show(route))}
      >
        {shown ? "Hide route" : "Show route"}
      </button>
    </span>
  );
}
