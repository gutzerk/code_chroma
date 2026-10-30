import type { CanvasDoc, CanvasElement } from "../../state/types";
import type { LiveDragOffset } from "./dragOffsetStore";
import { questionAgentId } from "./question/questionAdapter";
import { expandRouteElements } from "./routeExpansion";

type Elements = Record<string, CanvasElement>;

/** What the display stages read; every field is optional so a group can run alone. */
export interface DisplayContext {
  collapsedLayers?: ReadonlySet<string>;
  routeExpanded?: ReadonlySet<string>;
  runningAgentIds?: ReadonlySet<string>;
  dragOffsets?: Record<string, LiveDragOffset>;
  boards?: {
    doc: CanvasDoc; // the doc whose `elements` were passed to the stage
    /** Each board layer's ids and its profile's `viewElements`. */
    layers: ReadonlyArray<{ layer: string; ids: readonly string[]; view: (doc: CanvasDoc, ids: readonly string[], layer: string) => CanvasElement[] }>;
  };
}

export type DisplayStage = (elements: Elements, ctx: DisplayContext) => Elements;

/** Drops a collapsed diagram's elements from rendering only; the document itself is untouched. */
export const hideCollapsedLayers: DisplayStage = (elements, ctx) => {
  const collapsed = ctx.collapsedLayers;
  if (!collapsed || collapsed.size === 0) return elements;
  return Object.fromEntries(Object.entries(elements).filter(([, element]) => !collapsed.has(element.layer)));
};

/** Drops questions whose agent is running: its window (AgentQuestionHost) shows them; an orphan stays on the canvas. */
export const hideAgentQuestions: DisplayStage = (elements, ctx) => {
  const running = ctx.runningAgentIds;
  if (!running || running.size === 0) return elements;
  let out: Elements | null = null;
  for (const id in elements) {
    const agentId = questionAgentId(elements[id]);
    if (agentId === null || !running.has(agentId)) continue;
    out ??= { ...elements };
    delete out[id];
  }
  return out ?? elements;
};

/** Grows expanded route steps and pushes their same-layer neighbours down. */
export const growExpandedRoutes: DisplayStage = (elements, ctx) =>
  ctx.routeExpanded ? expandRouteElements(elements, ctx.routeExpanded) : elements;

/** Folds live drag offsets into positions so arrows follow a gesture. */
export const offsetDraggedElements: DisplayStage = (elements, ctx) => {
  const offsets = ctx.dragOffsets;
  if (!offsets) return elements;
  let next: Elements | null = null;
  for (const [id, offset] of Object.entries(offsets)) {
    const element = elements[id];
    if (!element) continue;
    next ??= { ...elements };
    next[id] = { ...element, position: { x: element.position.x + offset.x, y: element.position.y + offset.y } };
  }
  return next ?? elements;
};

/** Re-lays each board layer out for its display-only view (a sequence board's expanded steps). */
export const viewBoardLayers: DisplayStage = (elements, ctx) => {
  const boards = ctx.boards;
  if (!boards || boards.layers.length === 0) return elements;
  const next = { ...elements };
  for (const { layer, ids, view } of boards.layers) {
    for (const element of view(boards.doc, ids, layer)) next[element.id] = element;
  }
  return next;
};

// Order: filter, grow/push, drag offsets, view geometry. The groups run in separate memos (drag ticks
// must not redo the structural stages), so CanvasDocView calls them in this order.
export const STRUCTURAL_STAGES: readonly DisplayStage[] = [hideAgentQuestions, hideCollapsedLayers, growExpandedRoutes];
export const LIVE_STAGES: readonly DisplayStage[] = [offsetDraggedElements];
export const VIEW_STAGES: readonly DisplayStage[] = [viewBoardLayers];

/** Runs `stages` left to right over `elements`; identity when a stage has nothing to do. */
export function runDisplayStages(
  stages: readonly DisplayStage[],
  elements: Elements,
  ctx: DisplayContext,
): Elements {
  return stages.reduce((current, stage) => stage(current, ctx), elements);
}
