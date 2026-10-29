import { useEffect, useMemo, useRef, useState } from "react";
import { useCanvasDoc, useRouteCarriers } from "./doc/canvasDocStore";
import { routeOf, type Route, type RouteStep } from "./doc/routeStep";
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

/** The badge on a step row: ✕ for a failure, ✓ for the last step of a flow, else its number. */
function stepMark(step: RouteStep, isLast: boolean): string {
  if (step.kind === "failure") return "✕";
  return isLast ? "✓" : String(step.order);
}

/** The row's second line: the authored `detail`, else the first call it makes, else its lane. */
function stepDetail(step: RouteStep): string | undefined {
  return step.detail ?? step.children[0]?.label ?? step.lane;
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

/** The ROUTE card: title, derived summary, the step list and `▶ Walk the route`. */
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

  const cardRef = useRef<HTMLElement | null>(null);
  const right = useClearOfActivityPanel(cardRef, route !== null);
  if (!route) return null;
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
      <ol className="route-card-steps">
        {route.steps.map((step, index) => (
          <li
            key={step.id}
            className={`route-card-step route-step--${step.kind}${index === stepIndex ? " route-card-step--active" : ""}`}
            data-testid="route-card-step"
          >
            <button type="button" onClick={() => routeStore.setStep(index)}>
              <span className="route-card-step-badge" aria-hidden="true">{stepMark(step, index === route.steps.length - 1)}</span>
              <span className="route-card-step-text">
                <span className="route-card-step-title">{step.title}</span>
                {stepDetail(step) && <span className="route-card-step-detail">{stepDetail(step)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="route-card-player">
        <button type="button" className="route-card-nav" aria-label="Previous step" data-testid="route-prev" onClick={() => routeStore.setStep(stepIndex - 1)}>
          ←
        </button>
        <button type="button" className="route-card-walk" data-testid="route-walk" onClick={() => routeStore.toggleWalk()}>
          {walking ? "■ Stop" : "▶ Walk the route"}
        </button>
        <button type="button" className="route-card-nav" aria-label="Next step" data-testid="route-next" onClick={() => routeStore.setStep(stepIndex + 1)}>
          →
        </button>
      </div>
      <div className="route-card-legend" data-testid="route-card-legend">
        <span className="route-card-legend-title">LEGEND</span>
        <span><i className="route-card-swatch route-card-swatch--route" />on the route</span>
        <span><i className="route-card-swatch route-card-swatch--dim" />rest of the code, dimmed but still there</span>
        <span><i className="route-card-swatch route-card-swatch--frame" />folder / file, ↗ opens it</span>
      </div>
    </aside>
  );
}
