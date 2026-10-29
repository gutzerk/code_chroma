import type { CanvasElement } from "../../state/types";
import type { UnionBounds } from "./boundingBox";
import { useRouteCarriers } from "./canvasDocStore";
import { routeFor, type Route } from "./routeStep";

/** The diagram layer whose ROUTE panel is drawn inside its own frame (B2 board), not docked on the viewport. */
export const WALKTHROUGH_LAYER = "walkthrough";

/** B2 board geometry in canvas px: panel width, gap from the step boxes, and the fixed row/section heights below. */
export const WALKTHROUGH_PANEL = {
  width: 348,
  gap: 80,
  padding: 20,
  sectionGap: 14,
  head: 62,
  row: 47,
  rowGap: 2,
  player: 40,
  legend: 96,
} as const;

/** The panel's height for `route`: every row is one line of each text, so it is exact, not measured. */
export function walkthroughPanelHeight(route: Route): number {
  const p = WALKTHROUGH_PANEL;
  const steps = route.steps.length;
  const list = steps * p.row + Math.max(steps - 1, 0) * p.rowGap;
  return p.padding * 2 + p.head + list + p.player + p.legend + p.sectionGap * 3;
}

/** Where the panel sits: right of the step boxes, top-aligned with them. */
export function walkthroughPanelBox(bounds: UnionBounds, route: Route): { left: number; top: number; width: number; height: number } {
  return { left: bounds.right + WALKTHROUGH_PANEL.gap, top: bounds.top, width: WALKTHROUGH_PANEL.width, height: walkthroughPanelHeight(route) };
}

/** The member bounds grown to enclose the panel, so the diagram frame draws around it. */
export function boundsWithWalkthroughPanel(bounds: UnionBounds, route: Route): UnionBounds {
  const panel = walkthroughPanelBox(bounds, route);
  return { ...bounds, right: panel.left + panel.width, bottom: Math.max(bounds.bottom, panel.top + panel.height) };
}

/** The route the layer's boxes name, through their carrier (every box of a layer names the same route). */
export function useLayerRoute(members: readonly CanvasElement[]): { route: Route | undefined; layer: string | undefined } {
  const carriers = useRouteCarriers();
  const owner = members.find((member) => member.meta?.route_id !== undefined || member.meta?.route !== undefined);
  return { route: owner ? routeFor(owner, carriers) : undefined, layer: owner?.layer };
}

/** True when a walkthrough layer on the canvas draws `route` in its own frame, so no docked card is needed. */
export function isRouteDrawnInDiagram(route: Route, elements: Record<string, CanvasElement>, carriers: readonly CanvasElement[]): boolean {
  return Object.values(elements).some((element) => element.layer === WALKTHROUGH_LAYER && routeFor(element, carriers)?.id === route.id);
}
