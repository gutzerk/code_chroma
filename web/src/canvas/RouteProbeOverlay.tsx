import { useState } from "react";
import { useExpandedNodeIdsByOrder } from "../state/expansionState";
import { useCanvasLayoutVersion } from "../state/canvasLayoutStore";
import { useRouteProbeState } from "../state/routeProbeStore";
import { countLabel, measureAndRouteEdges, resolveVisibleEdges, useOverlaySvgRef } from "./canvasOverlay";

/** Consecutive-pair segments from a resolved path, mapped to each node's nearest VISIBLE ancestor
 * the same way ConnectionsOverlay resolves its edges — a collapsed hop still draws a visible line. */
function segmentsOf(path: string[] | null) {
  if (!path || path.length < 2) return [];
  const pairs = path.slice(0, -1).map((from, i) => [from, path[i + 1]] as const);
  return resolveVisibleEdges(pairs, (pair) => pair);
}

/** Draws the dependency path between two probed nodes (feature 019: route probing) as a distinct
 * overlay on top of ConnectionsOverlay's plain connections — same measure-live-boxes/route-around-
 * obstacles pipeline, but for one ordered chain instead of an unordered edge set. Renders nothing
 * once the probe resolves to no path. */
export function RouteProbeOverlay() {
  const { path } = useRouteProbeState();
  const expandedNodeIds = useExpandedNodeIdsByOrder();
  const layoutVersion = useCanvasLayoutVersion();
  const [paths, setPaths] = useState<{ key: string; d: string }[]>([]);

  const svgRef = useOverlaySvgRef(() => {
    const routed = measureAndRouteEdges(svgRef.current, segmentsOf(path));
    setPaths(routed.map(({ item, d }) => ({ key: item.key, d })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, expandedNodeIds, layoutVersion]);

  const label = countLabel(paths.length, "hop", { prefix: "Route across", emptyText: "No route" });

  return (
    <svg
      ref={svgRef}
      className="route-probe-overlay"
      data-testid="route-probe-overlay"
      role="img"
      aria-label={label}
    >
      {paths.map(({ key, d }) => (
        <path key={key} d={d} className="route-probe-edge" />
      ))}
    </svg>
  );
}
