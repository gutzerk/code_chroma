import { useEffect, useMemo } from "react";
import { useCanvasDoc } from "./doc/canvasDocStore";
import { routeOf, type Route } from "./doc/routeStep";
import { routeStore, useRouteState } from "../state/routeStore";
import type { CanvasElement } from "../state/types";

/** Milliseconds a walk stays on one step. */
export const ROUTE_WALK_STEP_MS = 1500;

/** Every distinct route (by id) carried by the canvas diagrams, in first-seen order. */
export function collectRoutes(elements: Record<string, CanvasElement>): Route[] {
  const byId = new Map<string, Route>();
  for (const element of Object.values(elements)) {
    const route = routeOf(element);
    if (route && !byId.has(route.id)) byId.set(route.id, route);
  }
  return [...byId.values()];
}

/** The ROUTE card: title, derived summary, the step list and `▶ Walk the route`. */
export function RouteCard() {
  const { route, stepIndex, walking } = useRouteState();
  const { elements } = useCanvasDoc();
  const routes = useMemo(() => collectRoutes(elements), [elements]);

  useEffect(() => {
    if (!walking) return;
    const timer = setTimeout(() => routeStore.advance(), ROUTE_WALK_STEP_MS);
    return () => clearTimeout(timer);
  }, [walking, stepIndex]);

  if (!route) return null;
  return (
    <aside className="route-card" data-testid="route-card" aria-label="Route">
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
      <ol className="route-card-steps">
        {route.steps.map((step, index) => (
          <li
            key={step.id}
            className={`route-card-step route-step--${step.kind}${index === stepIndex ? " route-card-step--active" : ""}`}
            data-testid="route-card-step"
          >
            <button type="button" onClick={() => routeStore.setStep(index)}>
              <span className="route-card-step-order">{step.kind === "failure" ? "✕" : step.order}</span> {step.title}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="route-card-walk" data-testid="route-walk" onClick={() => routeStore.toggleWalk()}>
        {walking ? "■ Stop" : "▶ Walk the route"}
      </button>
    </aside>
  );
}
