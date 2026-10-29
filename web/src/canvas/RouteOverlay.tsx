import { useEffect, useMemo, useState } from "react";
import { expansionStore, useExpandedNodeIdsByOrder } from "../state/expansionState";
import { useCanvasLayoutVersion } from "../state/canvasLayoutStore";
import { useRouteState } from "../state/routeStore";
import { countLabel, getToLocal, nodeBox, useOverlaySvgRef } from "./canvasOverlay";
import { routePathBetween, type LocalBox } from "./routePath";
import { applyRouteHighlight } from "./routeHighlight";
import type { RouteStep } from "./doc/routeStep";

interface Marker {
  key: string;
  x: number;
  y: number;
  label: string;
  kind: string;
  active: boolean;
}

interface Segment {
  key: string;
  d: string;
  active: boolean;
}

/** The number chip is 22px and sits centred just inside the lit block's top-left corner (B2 board). */
const CHIP_RADIUS = 11;
const CHIP_INSET = 2;

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

  // A block several steps run in takes the AI colour if any of them is an AI step.
  const kindById = useMemo(() => {
    const kinds = new Map<string, string>();
    route?.steps.forEach((step, index) => {
      for (const id of litByStep[index] ?? []) if (step.kind === "ai" || !kinds.has(id)) kinds.set(id, step.kind);
    });
    return kinds;
  }, [route, litByStep]);

  useEffect(() => {
    if (!route) return;
    return applyRouteHighlight(document, new Set(litByStep.flat()), kindById);
  }, [route, litByStep, kindById, layoutVersion]);

  const svgRef = useOverlaySvgRef(() => {
    const toLocal = svgRef.current ? getToLocal(svgRef.current) : null;
    if (!route || !toLocal) {
      setShapes({ markers: [], segments: [] });
      return;
    }
    const markers: Marker[] = [];
    const segments: Segment[] = [];
    let previous: { id: string; box: LocalBox } | null = null;
    const last = route.steps.length - 1;
    route.steps.forEach((step, index) => {
      const id = litByStep[index]?.[0];
      const screen = id ? nodeBox(id, { codeMapOnly: true }) : null;
      if (!id || !screen) return;
      const topLeft = toLocal(screen.left, screen.top);
      const bottomRight = toLocal(screen.right, screen.bottom);
      const box: LocalBox = { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
      const active = index === stepIndex;
      // The final step of a flow reads as done; a failure keeps its number.
      const label = index === last && step.kind !== "failure" ? "✓" : String(step.order);
      markers.push({ key: step.id, x: box.left + CHIP_INSET, y: box.top + CHIP_INSET, label, kind: step.kind, active });
      if (previous && previous.id !== id) {
        segments.push({ key: `${previous.id}->${step.id}`, d: routePathBetween(previous.box, box), active });
      }
      previous = { id, box };
    });
    setShapes({ markers, segments });
  }, [route, litByStep, stepIndex, layoutVersion]);

  // Walking scrolls the active step's first file into view.
  useEffect(() => {
    const id = litByStep[stepIndex]?.[0];
    if (!id) return;
    document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]:not([data-canvas-element])`)?.scrollIntoView?.({ block: "center", inline: "center" });
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
      <defs>
        <marker id="route-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="route-overlay-arrow" />
        </marker>
      </defs>
      <g className="route-overlay-glow">
        {segments.map(({ key, d }) => (
          <path key={key} d={d} />
        ))}
      </g>
      {segments.map(({ key, d, active }) => (
        <path
          key={key}
          d={d}
          markerEnd="url(#route-arrow)"
          className={`route-overlay-path${active || stepIndex < 0 ? " route-overlay-path--active" : ""}`}
        />
      ))}
      {markers.map(({ key, x, y, label, kind, active }) => (
        <g key={key} className={`route-overlay-marker route-step--${kind}${active ? " route-overlay-marker--active" : ""}`}>
          <circle cx={x} cy={y} r={CHIP_RADIUS} />
          <text x={x} y={y} textAnchor="middle" dominantBaseline="central">{label}</text>
        </g>
      ))}
    </svg>
  );
}
