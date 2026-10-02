import type { CanvasRenderKind } from "../../state/types";

/** One box shell's CSS classes for a given render kind. `descClass` is absent for a kind whose box
 * never shows a free-text description row (epic, group). */
export interface NodeStyleEntry {
  boxClass: string;
  rowClass: string;
  headerClass: string;
  /** Wraps the name-row + description together in their own column, since `headerClass` itself
   * lays its direct children out in a row (title column beside the copy/desc buttons) -- mirroring
   * `Block.tsx`'s own `.block-title` div, the origin of this shape. Every kind sets one. */
  titleWrapClass: string;
  titleRowClass: string;
  nameClass: string;
  descClass?: string;
  draggingClass: string;
}

/** Shared shell for every non-c1 kind (036-shared-diagram-style-catalog): pattern/impact/custom/
 * epic were five near-identical `NodeStyleEntry` literals differing only by class-name prefix --
 * now one base object, reused as-is or with the couple of genuine per-kind deltas layered on.
 * `headerClass` deliberately does NOT also carry `block-header` (unlike `rowClass`'s `block-row`,
 * kept for the shared `.block-change--<status> > .block-row` accent rule): a header's own
 * row/space-between layout needs to be self-contained, not assembled from two classes whose
 * declarations silently interleave by CSS source order -- that's exactly how this used to regress
 * (see the "buttons render at the bottom, not beside the title" fix below). */
const DIAGRAM_NODE_BASE: NodeStyleEntry = {
  boxClass: "diagram-node-box",
  rowClass: "diagram-node-box-row block-row",
  headerClass: "diagram-node-box-header",
  titleWrapClass: "diagram-node-box-title-wrap",
  titleRowClass: "diagram-node-box-title-row",
  nameClass: "diagram-node-box-name",
  descClass: "diagram-node-box-desc",
  draggingClass: "diagram-node-box--dragging",
};

/**
 * Style registry for CanvasNodeBox. `hierarchy` and `note` render through their own dedicated
 * components (HierarchyElement/NoteElement) and never reach this registry; `group` renders through
 * GroupFrame instead (a background rect enclosing its members, not a styled box of its own).
 *
 * `c1` stays its own approximation: the old C1 view renders its boxes through the shared hierarchy
 * `Block` component (`.block.block-c1-system`) with its own icon/expand chrome, not a bespoke
 * NodeBox — folding that in is a separate, later concern (see the plan's Risks section).
 */
export const NODE_STYLES: Record<
  Exclude<CanvasRenderKind, "hierarchy" | "note" | "group">,
  NodeStyleEntry
> = {
  c1: {
    boxClass: "block block-c1-system",
    rowClass: "block-row",
    headerClass: "block-header",
    titleWrapClass: "block-title",
    titleRowClass: "block-name-row",
    nameClass: "block-name",
    descClass: "block-description",
    draggingClass: "c1-node-anchor--dragging",
  },
  pattern: { ...DIAGRAM_NODE_BASE },
  impact: { ...DIAGRAM_NODE_BASE },
  custom: { ...DIAGRAM_NODE_BASE },
  epic: { ...DIAGRAM_NODE_BASE, descClass: undefined },
};

export type StyledRenderKind = keyof typeof NODE_STYLES;
