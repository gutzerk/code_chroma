import { useSelectedIds } from "../state/selectionStore";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { routeProbeStore, useRouteProbeState } from "../state/routeProbeStore";

/** Button label for a pair currently being probed: found/loading/not-found. */
function labelForActivePair(path: string[] | null, isLoading: boolean): string {
  if (path) return "Clear traced route";
  if (isLoading) return "Tracing route…";
  return "No route found — clear";
}

/** The "Trace route" action for feature 019's route probing: appears only while exactly two nodes
 * are selected (the existing Miro-style multi-select in canvas/collision/), and asks the bridge for
 * the dependency path between them. A second click while a route is already showing clears it,
 * mirroring how the Diff/Plan toggles behave elsewhere on this rail. */
export function RouteProbeTrigger() {
  const selectedIds = useSelectedIds();
  const engineClient = useEngineClient();
  const { fromId, toId, path, isLoading } = useRouteProbeState();

  if (selectedIds.length !== 2) return null;

  const [a, b] = selectedIds;
  const isShowingThisPair =
    (fromId === a && toId === b) || (fromId === b && toId === a);

  const handleClick = () => {
    if (isShowingThisPair) {
      routeProbeStore.clear();
      return;
    }
    routeProbeStore.probe(a, b, (from, to) => engineClient.getRoute(from, to));
  };

  const label = isShowingThisPair
    ? labelForActivePair(path, isLoading)
    : "Trace route between the two selected nodes";

  return (
    <button
      type="button"
      className="route-probe-trigger-button"
      data-testid="route-probe-trigger"
      onClick={handleClick}
      disabled={isShowingThisPair && isLoading}
    >
      {label}
    </button>
  );
}
