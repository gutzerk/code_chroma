import { useEffect } from "react";
import { routeStore, useRouteState } from "../state/routeStore";

/** Milliseconds a walk stays on one step. */
export const ROUTE_WALK_STEP_MS = 1500;

/** The ROUTE card: title, derived summary, the step list and `▶ Walk the route`. */
export function RouteCard() {
  const { route, stepIndex, walking } = useRouteState();

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
