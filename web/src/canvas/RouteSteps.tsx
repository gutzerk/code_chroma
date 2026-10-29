import type { Route, RouteStep } from "./doc/routeStep";

/** The badge on a step row: ✕ for a failure, ✓ for the last step of a flow, else its number. */
export function stepMark(step: RouteStep, isLast: boolean): string {
  if (step.kind === "failure") return "✕";
  return isLast ? "✓" : String(step.order);
}

/** The row's second line: the authored `detail`, else the first call it makes, else its lane. */
export function stepDetail(step: RouteStep): string | undefined {
  return step.detail ?? step.children[0]?.label ?? step.lane;
}

export interface RouteStepsProps {
  route: Route;
  /** The highlighted row, or -1 when the walk has not started (or another route is shown). */
  stepIndex: number;
  walking: boolean;
  onStep: (index: number) => void;
  onWalk: () => void;
}

/** The ROUTE body shared by the docked card and the walkthrough's in-diagram panel: steps, player and legend. */
export function RouteSteps({ route, stepIndex, walking, onStep, onWalk }: RouteStepsProps) {
  const last = route.steps.length - 1;
  return (
    <>
      <ol className="route-card-steps">
        {route.steps.map((step, index) => {
          const detail = stepDetail(step);
          // A step with code names a function (mono, link blue); an actor step says who, in plain text.
          const detailClass = step.nodeIds.length > 0 || step.kind === "ai" ? "route-card-step-detail route-card-step-detail--code" : "route-card-step-detail";
          return (
            <li
              key={step.id}
              className={`route-card-step route-step--${step.kind}${index === stepIndex ? " route-card-step--active" : ""}`}
              data-testid="route-card-step"
            >
              <button type="button" aria-current={index === stepIndex ? "step" : undefined} onClick={() => onStep(index)}>
                <span className={`route-card-step-badge${index === last && step.kind !== "failure" ? " route-card-step-badge--done" : ""}`} aria-hidden="true">
                  {stepMark(step, index === last)}
                </span>
                <span className="route-card-step-text">
                  <span className="route-card-step-title">{step.title}</span>
                  {detail && <span className={detailClass}>{detail}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="route-card-player">
        <button type="button" className="route-card-nav" aria-label="Previous step" data-testid="route-prev" onClick={() => onStep(stepIndex - 1)}>
          ←
        </button>
        <button type="button" className="route-card-walk" data-testid="route-walk" onClick={onWalk}>
          {walking ? "■ Stop" : "▶ Walk the route"}
        </button>
        <button type="button" className="route-card-nav" aria-label="Next step" data-testid="route-next" onClick={() => onStep(stepIndex + 1)}>
          →
        </button>
      </div>
      <div className="route-card-legend" data-testid="route-card-legend">
        <span className="route-card-legend-title">LEGEND</span>
        <span><i className="route-card-swatch route-card-swatch--route" />on the route</span>
        <span><i className="route-card-swatch route-card-swatch--dim" />rest of the code, dimmed but still there</span>
        <span><i className="route-card-swatch route-card-swatch--frame" />folder / file, ↗ opens it</span>
      </div>
    </>
  );
}
