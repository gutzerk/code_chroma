import type { CanvasElement } from "../../state/types";
import { routeStore, useRouteState } from "../../state/routeStore";
import type { MeasuredBoxSize } from "../useMeasuredSizes";
import { RouteSteps } from "../RouteSteps";
import { unionBoundsOf } from "./boundingBox";
import type { Route } from "./routeStep";
import { useLayerRoute, walkthroughPanelBox } from "./walkthroughLayout";

export interface WalkthroughPanelProps {
  layer: string;
  /** The layer's visible boxes, live-drag-adjusted like DiagramFrame's, so the panel moves with the diagram. */
  members: CanvasElement[];
  sizes: ReadonlyMap<string, MeasuredBoxSize>;
}

/** Shows `route` over the code map first when another route (or none) is active. */
function ensureShown(route: Route): void {
  if (routeStore.getSnapshot().route?.id !== route.id) routeStore.show(route);
}

/** The walkthrough's ROUTE panel, drawn on the canvas inside the diagram frame right of the step boxes (B2 board). */
export function WalkthroughPanel({ layer, members, sizes }: WalkthroughPanelProps) {
  const { route } = useLayerRoute(members);
  const snapshot = useRouteState();
  const bounds = unionBoundsOf(members, sizes);
  if (!route || !bounds) return null;
  const box = walkthroughPanelBox(bounds, route);
  const active = snapshot.route?.id === route.id;
  return (
    <aside
      className="walkthrough-panel"
      data-testid="walkthrough-panel"
      data-layer={layer}
      aria-label="Route"
      style={{ position: "absolute", left: Math.round(box.left), top: Math.round(box.top), width: box.width, height: box.height }}
    >
      <header className="walkthrough-panel-head">
        <span className="route-card-tag">ROUTE</span>
        <strong className="walkthrough-panel-title">{route.title}</strong>
        <span className="walkthrough-panel-summary" data-testid="route-card-summary">{route.summary}</span>
      </header>
      <RouteSteps
        route={route}
        stepIndex={active ? snapshot.stepIndex : -1}
        walking={active && snapshot.walking}
        onStep={(index) => {
          ensureShown(route);
          routeStore.setStep(index);
        }}
        onWalk={() => {
          ensureShown(route);
          routeStore.toggleWalk();
        }}
      />
    </aside>
  );
}
