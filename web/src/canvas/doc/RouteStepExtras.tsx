import type { CanvasElement } from "../../state/types";
import { inspectorStore } from "../inspectorStore";
import { routeExpandStore, useIsRouteExpanded } from "./routeExpandStore";
import type { RouteStep } from "./routeStep";

interface RouteStepExtrasProps {
  element: CanvasElement;
  step: RouteStep;
}

/** The `N calls` chip of a route step and, when expanded, its list of calls. */
export function RouteStepExtras({ element, step }: RouteStepExtrasProps) {
  const expanded = useIsRouteExpanded(element.id);
  return (
    <>
      <button
        type="button"
        className="route-step-chip"
        data-testid="route-step-chip"
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation();
          routeExpandStore.toggle(element.id);
        }}
      >
        {expanded ? "▾" : "▸"} {step.children.length} calls
      </button>
      {expanded && (
        <ul className="route-step-children" data-testid="route-step-children">
          {step.children.map(({ id, label, nodeId, line }) => (
            <li key={id} className="route-step-child">
              <span className="route-step-child-label">{label}</span>
              <span className="route-step-child-line">:{line}</span>
              {nodeId && (
                <button
                  type="button"
                  className="route-step-child-open"
                  data-testid="route-step-child-open"
                  aria-label={`Open ${label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    inspectorStore.open(nodeId, label, element.id);
                  }}
                >
                  ↗
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
