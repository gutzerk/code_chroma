import { useEffect, useState } from "react";
import type { Connection } from "../state/types";
import { useCodeVisibleNodeIdsByOrder, useExpandedNodeIdsByOrder } from "../state/expansionState";
import { useCanvasLayoutVersion } from "../state/canvasLayoutStore";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { mapWithConcurrency } from "../util/mapWithConcurrency";
import { reportAsyncError } from "../util/reportError";
import { countLabel, measureAndRouteEdges, resolveVisibleEdges, useOverlaySvgRef } from "./canvasOverlay";

// Enough to keep the overlay snappy without hammering the bridge once per visible node at once.
const MAX_PARALLEL_CONNECTION_FETCHES = 8;

interface ResolvedConnection {
  key: string;
  fromId: string;
  toId: string;
  bundled: boolean;
}

function resolveConnections(connections: Connection[]): ResolvedConnection[] {
  return resolveVisibleEdges(connections, (c) => [c.from_id, c.to_id]).map((edge) => ({
    key: edge.key,
    fromId: edge.fromId,
    toId: edge.toId,
    bundled: edge.fromId !== edge.item.from_id || edge.toId !== edge.item.to_id,
  }));
}

/** Draws connection lines between arbitrary nodes' live on-screen boxes, independent of DOM
 * nesting depth — Block.tsx's parent/child containment is untouched. Recomputes on expand/collapse
 * and window resize, never on pan/zoom (this component lives inside .canvas-content, so it inherits
 * the shared pan/zoom transform for free, same as every Block). */
export function ConnectionsOverlay() {
  const engineClient = useEngineClient();
  const expandedNodeIds = useExpandedNodeIdsByOrder();
  const codeVisibleNodeIds = useCodeVisibleNodeIdsByOrder();
  const layoutVersion = useCanvasLayoutVersion();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [paths, setPaths] = useState<{ key: string; d: string; bundled: boolean }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const visibleIds = Array.from(document.querySelectorAll<HTMLElement>("[data-node-id]"))
      .map((el) => el.dataset.nodeId)
      .filter((id): id is string => Boolean(id));
    // Bounded fan-out with allSettled: a wide tree used to fire one uncapped request per visible
    // node, and a single failure discarded every other node's result as an unhandled rejection.
    mapWithConcurrency(visibleIds, MAX_PARALLEL_CONNECTION_FETCHES, (id) =>
      engineClient.getConnections(id),
    ).then((results) => {
      if (cancelled) return;
      const fulfilled = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) reportAsyncError(`connections (${failed}/${results.length} nodes)`, "fetch");
      setConnections(fulfilled);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineClient, expandedNodeIds]);

  // Children mount async (useNodeChildren), so useOverlaySvgRef's extra next-frame pass catches
  // layout settle — same trick as ChangeConnectionsOverlay.
  const svgRef = useOverlaySvgRef(() => {
    const routed = measureAndRouteEdges(svgRef.current, resolveConnections(connections));
    setPaths(routed.map(({ item, d }) => ({ key: item.key, d, bundled: item.bundled })));
  }, [connections, expandedNodeIds, codeVisibleNodeIds, layoutVersion]);

  const label = countLabel(paths.length, "connection", { suffix: "between nodes" });

  return (
    <svg
      ref={svgRef}
      className="connections-overlay"
      data-testid="connections-overlay"
      role="img"
      aria-label={label}
    >
      {paths.map(({ key, d, bundled }) => (
        <path
          key={key}
          d={d}
          className={`connection-path ${bundled ? "connection-path-bundled" : ""}`}
        />
      ))}
    </svg>
  );
}
