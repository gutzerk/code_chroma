import { useEffect, useMemo, useState } from "react";
import { expansionStore, useExpandedNodeIdsByOrder } from "../state/expansionState";
import { useCanvasLayoutVersion } from "../state/canvasLayoutStore";
import { useRouteState } from "../state/routeStore";
import { borderSegment, countLabel, getToLocal, nodeBox, useOverlaySvgRef } from "./canvasOverlay";
import { applyRouteHighlight } from "./routeHighlight";
import type { RouteStep } from "./doc/routeStep";

interface Marker {
  key: string;
  x: number;
  y: number;
  order: number;
  kind: string;
  active: boolean;
}

interface Segment {
  key: string;
  d: string;
  active: boolean;
}

/** The visible block ids a step lights: each `node_id` snapped to its nearest visible ancestor. */
export function litIdsOf(step: RouteStep): string[] {
  const ids = step.nodeIds
    .map((id) => expansionStore.getNearestVisibleAncestor(id))
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

/**
 * Lays the authored route over the code map: lights the files its steps run in, fades the rest to the
 * faded level, numbers each step on its first file and joins consecutive steps with a path. Authored,
 * not captured -- the trace overlay is the recorded counterpart.
 */
export function RouteOverlay() {
  const { route, stepIndex } = useRouteState();
  const expandedNodeIds = useExpandedNodeIdsByOrder();
  const layoutVersion = useCanvasLayoutVersion();
  const [shapes, setShapes] = useState<{ markers: Marker[]; segments: Segment[] }>({ markers: [], segments: [] });

  // Each step's lit blocks, recomputed only when the route or the expansion changes.
  const litByStep = useMemo(
    () => (route ? route.steps.map(litIdsOf) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- expandedNodeIds is expansionStore's change signal
    [route, expandedNodeIds],
  );

  useEffect(() => {
    if (!route) return;
    return applyRouteHighlight(document, new Set(litByStep.flat()));
  }, [route, litByStep, layoutVersion]);

  const svgRef = useOverlaySvgRef(() => {
    const toLocal = svgRef.current ? getToLocal(svgRef.current) : null;
    if (!route || !toLocal) {
      setShapes({ markers: [], segments: [] });
      return;
    }
    const markers: Marker[] = [];
    const segments: Segment[] = [];
    let previous: { id: string; box: NonNullable<ReturnType<typeof nodeBox>> } | null = null;
    route.steps.forEach((step, index) => {
      const id = litByStep[index]?.[0];
      const box = id ? nodeBox(id) : null;
      if (!id || !box) return;
      const corner = toLocal(box.left, box.top);
      const active = index === stepIndex;
      markers.push({ key: step.id, x: corner.x, y: corner.y, order: step.order, kind: step.kind, active });
      if (previous && previous.id !== id) {
        const seg = borderSegment(previous.box, box);
        const a = toLocal(seg.from.x, seg.from.y);
        const b = toLocal(seg.to.x, seg.to.y);
        segments.push({ key: `${previous.id}->${step.id}`, d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, active });
      }
      previous = { id, box };
    });
    setShapes({ markers, segments });
  }, [route, litByStep, stepIndex, layoutVersion]);

  // Walking scrolls the active step's first file into view.
  useEffect(() => {
    const id = litByStep[stepIndex]?.[0];
    if (!id) return;
    document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.scrollIntoView?.({ block: "center", inline: "center" });
  }, [litByStep, stepIndex]);

  const { markers, segments } = shapes;
  return (
    <svg
      ref={svgRef}
      className="route-overlay"
      data-testid="route-overlay"
      role="img"
      aria-label={countLabel(markers.length, "route step")}
    >
      {segments.map(({ key, d, active }) => (
        <path key={key} d={d} className={`route-overlay-path${active ? " route-overlay-path--active" : ""}`} />
      ))}
      {markers.map(({ key, x, y, order, kind, active }) => (
        <g key={key} className={`route-overlay-marker route-step--${kind}${active ? " route-overlay-marker--active" : ""}`}>
          <circle cx={x} cy={y} r={10} />
          <text x={x} y={y} textAnchor="middle" dominantBaseline="central">{order}</text>
        </g>
      ))}
    </svg>
  );
}
