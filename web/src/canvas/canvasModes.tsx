import type { ComponentType } from "react";
import { useIsDiffActive } from "../state/diffOverlayStore";
import { useRouteState } from "../state/routeStore";
import { useTraceState } from "../state/traceStore";
import { ChangeConnectionsOverlay } from "./ChangeConnectionsOverlay";
import { DeletedDiffOverlay } from "./DeletedDiffOverlay";
import { RouteCard } from "./RouteCard";
import { RouteOverlay } from "./RouteOverlay";
import { RouteProbeOverlay } from "./RouteProbeOverlay";
import { TraceControls } from "./TraceControls";
import { TraceFlowOverlay } from "./TraceFlowOverlay";

/** A canvas mode: an overlay drawn inside the viewport and/or controls drawn over the stage while it is active. */
export interface CanvasMode {
  id: string;
  useActive: () => boolean;
  Overlay?: ComponentType;
  Controls?: ComponentType;
}

/** Overlay and controls mount in this order; the route probe is always active. */
export const CANVAS_MODES: readonly CanvasMode[] = [
  { id: "diff", useActive: useIsDiffActive, Overlay: ChangeConnectionsOverlay, Controls: DeletedDiffOverlay },
  { id: "trace", useActive: () => useTraceState().isActive, Overlay: TraceFlowOverlay, Controls: TraceControls },
  { id: "route-probe", useActive: () => true, Overlay: RouteProbeOverlay },
  { id: "route", useActive: () => useRouteState().route !== null, Overlay: RouteOverlay, Controls: RouteCard },
];

/** The modes that are active now; every `useActive` runs on every render so hook order stays fixed. */
export function useActiveModes(): readonly CanvasMode[] {
  const flags = CANVAS_MODES.map((mode) => mode.useActive());
  return CANVAS_MODES.filter((_, index) => flags[index]);
}
