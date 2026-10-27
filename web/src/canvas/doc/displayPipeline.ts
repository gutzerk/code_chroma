import type { CanvasDoc, CanvasElement } from "../../state/types";
import { viewSequenceElements } from "./autoLayout";
import type { LiveDragOffset } from "./dragOffsetStore";
import { expandRouteElements } from "./routeExpansion";
import type { SequenceView } from "./sequenceViewStore";

type Elements = Record<string, CanvasElement>;

/** What the display stages read; every field is optional so a group can run alone. */
export interface DisplayContext {
  collapsedLayers?: ReadonlySet<string>;
  routeExpanded?: ReadonlySet<string>;
  dragOffsets?: Record<string, LiveDragOffset>;
  sequence?: {
    doc: CanvasDoc; // the doc whose `elements` were passed to the stage
    idsByLayer: ReadonlyMap<string, readonly string[]>;
    viewFor: (layer: string, messageCount: number) => SequenceView;
  };
}

export type DisplayStage = (elements: Elements, ctx: DisplayContext) => Elements;

/** Drops a collapsed diagram's elements from rendering only; the document itself is untouched. */
export const hideCollapsedLayers: DisplayStage = (elements, ctx) => {
  const collapsed = ctx.collapsedLayers;
  if (!collapsed || collapsed.size === 0) return elements;
  return Object.fromEntries(Object.entries(elements).filter(([, element]) => !collapsed.has(element.layer)));
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

/** Re-lays each sequence layer out for the viewer's Readable/Focus mode. */
export const viewSequenceLayers: DisplayStage = (elements, ctx) => {
  const sequence = ctx.sequence;
  if (!sequence || sequence.idsByLayer.size === 0) return elements;
  const next = { ...elements };
  for (const [layer, ids] of sequence.idsByLayer) {
    const messageCount = ids.filter((id) => elements[id]?.meta?.role === "message").length;
    const view = sequence.viewFor(layer, messageCount);
    for (const element of viewSequenceElements(sequence.doc, ids, view)) next[element.id] = element;
  }
  return next;
};

// Order: filter, grow/push, drag offsets, view geometry. The groups run in separate memos (drag ticks
// must not redo the structural stages), so CanvasDocView calls them in this order.
export const STRUCTURAL_STAGES: readonly DisplayStage[] = [hideCollapsedLayers, growExpandedRoutes];
export const LIVE_STAGES: readonly DisplayStage[] = [offsetDraggedElements];
export const VIEW_STAGES: readonly DisplayStage[] = [viewSequenceLayers];

/** Runs `stages` left to right over `elements`; identity when a stage has nothing to do. */
export function runDisplayStages(
  stages: readonly DisplayStage[],
  elements: Elements,
  ctx: DisplayContext,
): Elements {
  return stages.reduce((current, stage) => stage(current, ctx), elements);
}
