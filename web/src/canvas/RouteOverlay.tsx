import { useEffect, useState } from "react";
import { expansionStore, useExpandedNodeIdsByOrder } from "../state/expansionState";
import { useCanvasLayoutVersion } from "../state/canvasLayoutStore";
import { useRouteState } from "../state/routeStore";
import { BLOCK_HEADER_SELECTOR, borderSegment, countLabel, getToLocal, useOverlaySvgRef } from "./canvasOverlay";
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

function boxOf(nodeId: string) {
  const el = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`);
  if (!el) return null;
  const r = (el.querySelector<HTMLElement>(BLOCK_HEADER_SELECTOR) ?? el).getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
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
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);

  useEffect(() => {
    if (!route) return;
    const lit = new Set(route.steps.flatMap(litIdsOf));
    return applyRouteHighlight(document, lit);
  }, [route, expandedNodeIds, layoutVersion]);

  const svgRef = useOverlaySvgRef(() => {
    const toLocal = svgRef.current ? getToLocal(svgRef.current) : null;
    if (!route || !toLocal) {
      setMarkers([]);
      setSegments([]);
      return;
    }
    const nextMarkers: Marker[] = [];
    const nextSegments: Segment[] = [];
    let previous: { id: string; box: NonNullable<ReturnType<typeof boxOf>> } | null = null;
    route.steps.forEach((step, index) => {
      const id = litIdsOf(step)[0];
      const box = id ? boxOf(id) : null;
      if (!id || !box) return;
      const corner = toLocal(box.left, box.top);
      const active = index === stepIndex;
      nextMarkers.push({ key: step.id, x: corner.x, y: corner.y, order: step.order, kind: step.kind, active });
      if (previous && previous.id !== id) {
        const seg = borderSegment(previous.box, box);
        const a = toLocal(seg.from.x, seg.from.y);
        const b = toLocal(seg.to.x, seg.to.y);
        nextSegments.push({ key: `${previous.id}->${step.id}`, d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, active });
      }
      previous = { id, box };
    });
    setMarkers(nextMarkers);
    setSegments(nextSegments);
  }, [route, stepIndex, expandedNodeIds, layoutVersion]);

  // Walking scrolls the active step's first file into view.
  useEffect(() => {
    const step = route?.steps[stepIndex];
    const id = step ? litIdsOf(step)[0] : undefined;
    if (!id) return;
    document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.scrollIntoView?.({ block: "center", inline: "center" });
  }, [route, stepIndex]);

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
