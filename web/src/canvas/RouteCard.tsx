import { useEffect, useMemo, useRef, useState } from "react";
import { useCanvasDoc, useRouteCarriers } from "./doc/canvasDocStore";
import { routeOf, type Route } from "./doc/routeStep";
import { isRouteDrawnInDiagram } from "./doc/walkthroughLayout";
import { useCollapsedLayers } from "./doc/collapsedLayersStore";
import { RouteSteps } from "./RouteSteps";
import { routeStore, useRouteState } from "../state/routeStore";
import type { CanvasElement } from "../state/types";

/** Milliseconds a walk stays on one step. */
export const ROUTE_WALK_STEP_MS = 1500;

/** Every distinct route (by id): the carriers first, then any legacy box that still holds its own copy. */
export function collectRoutes(elements: Record<string, CanvasElement>, carriers: readonly CanvasElement[] = []): Route[] {
  const byId = new Map<string, Route>();
  const add = (element: CanvasElement) => {
    const route = routeOf(element);
    if (route && !byId.has(route.id)) byId.set(route.id, route);
  };
  carriers.forEach(add);
  Object.values(elements).forEach(add);
  return [...byId.values()];
}

const CARD_GAP = 12;

/** The card's `right` offset that keeps it on the *visible* canvas: the agents panel floats over its right side. */
function useClearOfActivityPanel(cardRef: { current: HTMLElement | null }, active: boolean): number {
  const [right, setRight] = useState(CARD_GAP);
  useEffect(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="activity-panel"]');
    const stage = cardRef.current?.offsetParent;
    if (!panel || !stage) return;
    const place = () => {
      const overlap = stage.getBoundingClientRect().right - panel.getBoundingClientRect().left;
      setRight(Math.max(overlap, 0) + CARD_GAP);
    };
    place();
    window.addEventListener("resize", place);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(panel);
    return () => {
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
  }, [cardRef, active]);
  return right;
}

/** The docked ROUTE card for a route with no in-diagram panel; it also runs the walk timer for every route. */
export function RouteCard() {
  const { route, stepIndex, walking } = useRouteState();
  const { elements } = useCanvasDoc();
  const carriers = useRouteCarriers();
  const routes = useMemo(() => collectRoutes(elements, carriers), [elements, carriers]);

  useEffect(() => {
    if (!walking) return;
    const timer = setTimeout(() => routeStore.advance(), ROUTE_WALK_STEP_MS);
    return () => clearTimeout(timer);
  }, [walking, stepIndex]);

  // An expanded walkthrough draws this route in its own frame (WalkthroughPanel), so the docked copy stays hidden.
  const collapsedLayers = useCollapsedLayers();
  const docked = route !== null && !isRouteDrawnInDiagram(route, elements, carriers, collapsedLayers);
  const cardRef = useRef<HTMLElement | null>(null);
  const right = useClearOfActivityPanel(cardRef, docked);
  if (!route || !docked) return null;
  return (
    <aside className="route-card" data-testid="route-card" aria-label="Route" ref={cardRef} style={{ right }}>
      <header className="route-card-head">
        <span className="route-card-tag">ROUTE</span>
        <strong>{route.title}</strong>
        <button type="button" className="route-card-close" aria-label="Hide route" onClick={() => routeStore.clear()}>
          ✕
        </button>
      </header>
      {routes.length > 1 && (
        <select
          className="route-card-picker"
          data-testid="route-picker"
          aria-label="Route"
          value={route.id}
          onChange={(event) => {
            const next = routes.find((r) => r.id === event.target.value);
            if (next) routeStore.show(next);
          }}
        >
          {routes.map((r) => (
            <option key={r.id} value={r.id}>{r.title}</option>
          ))}
        </select>
      )}
      <p className="route-card-summary" data-testid="route-card-summary">{route.summary}</p>
      <RouteSteps
        route={route}
        stepIndex={stepIndex}
        walking={walking}
        onStep={(index) => routeStore.setStep(index)}
        onWalk={() => routeStore.toggleWalk()}
      />
    </aside>
  );
}
