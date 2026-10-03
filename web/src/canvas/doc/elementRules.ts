import type { CanvasRenderKind } from "../../state/types";

/** Which canvas-doc component draws an element's kind. Several render kinds share one renderer —
 * every diagram box (c1/pattern/impact/epic/custom) renders through CanvasNodeBox. */
export type RendererKind = "hierarchy" | "note" | "group" | "node-box" | "sequence";

/** What clicking a block does — `"epic-brief"` marks a work-item box (epic/story): its primary click
 * opens the right-side Inspector showing the WorkItem's full text (010-epics-tree-render Part 5),
 * with the AI brief reachable from a button inside that level. Everything else goes to the Inspector
 * (via CanvasNodeBox's shared plan/no-code fallbacks). */
export type ActivationKind = "inspector" | "epic-brief";

/** One box shell's CSS classes for a given render kind. `descClass` is absent for a kind whose box
 * never shows a free-text description row (epic, group). Mirrors the departed `nodeStyles.tsx`'s
 * contract verbatim — `nodeStyles.test.tsx` was folded into `elementRules.test.ts` here. */
export interface NodeStyleEntry {
  boxClass: string;
  rowClass: string;
  headerClass: string;
  titleWrapClass: string;
  titleRowClass: string;
  nameClass: string;
  descClass?: string;
  draggingClass: string;
}

/** Shared shell for every non-c1 kind (036-shared-diagram-style-catalog): pattern/impact/custom/
 * epic were five near-identical `NodeStyleEntry` literals differing only by class-name prefix —
 * now one base object, reused as-is or with the couple of genuine per-kind deltas layered on.
 * `headerClass` deliberately does NOT also carry `block-header` (unlike `rowClass`'s `block-row`,
 * kept for the shared `.block-change--<status> > .block-row` accent rule): a header's own
 * row/space-between layout needs to be self-contained, not assembled from two classes whose
 * declarations silently interleave by CSS source order — that's exactly how this used to regress
 * (see the "buttons render at the bottom, not beside the title" fix). */
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

/** One per render kind: the single place the canvas reads when it needs to branch behavior by block
 * type — which component renders it (`renderer`), which sidecar overlay feeds it (`overlay`), what
 * activate does (`activation`), and its box style (`style`, for kinds rendered through CanvasNodeBox)
 * — plus the shared canvas logic (drag/collision/size/selection) that applies to every kind
 * unconditionally. This is the single source of truth that slotted `nodeStyles.tsx`'s style registry
 * in alongside the behavior deltas, so a new kind is added here, not in two files.
 *
 * Discriminated on `renderer`: a kind rendered through its own dedicated component (hierarchy/note/
 * group) carries no `style`, while a `node-box` kind must — the compiler enforces the pair, so a new
 * node-box kind can't silently drop its box shell. */
export type BlockRule = OwnComponentRule | NodeBoxRule;

/** A rule for a kind that renders through its own component (no CanvasNodeBox box shell). */
export interface OwnComponentRule {
  kind: CanvasRenderKind;
  renderer: "hierarchy" | "note" | "group" | "sequence";
  activation: ActivationKind;
  /** The "changes"/diff overlay that feeds this kind — impact only today. */
  overlay?: "impact";
  /** A meta-row status chip keyed off `meta.status` — impact only today (see ImpactStatusChip). */
  statusChip?: "impact";
  /** Box shells only belong to `node-box` kinds — deliberately absent here. */
  style?: never;
  /** Hard layout (010-epics-tree-render, Part 4): the box is never draggable — no solo/group drag,
   * no collision-solving, no position writes. Its position comes only from auto-layout / the fit
   * loop. Absent/false for every freely-draggable kind. */
  lockedLayout?: boolean;
}

/** A rule for a kind rendered through CanvasNodeBox — the box shell is required, never optional. */
export interface NodeBoxRule {
  kind: CanvasRenderKind;
  renderer: "node-box";
  activation: ActivationKind;
  /** The "changes"/diff overlay that feeds this kind — impact only today. */
  overlay?: "impact";
  /** A meta-row status chip keyed off `meta.status` — impact only today (see ImpactStatusChip). */
  statusChip?: "impact";
  style: NodeStyleEntry;
  /** Hard layout (010-epics-tree-render, Part 4): the box is never draggable — no solo/group drag,
   * no collision-solving, no position writes. Its position comes only from auto-layout / the fit
   * loop. Absent/false for every freely-draggable kind. */
  lockedLayout?: boolean;
}

/** The element-kind rule registry. Extend a new render kind by adding its row here — the renderer,
 * the overlay, the activation, and the box style all follow from it instead of new `render ===`
 * branches or a parallel style registry. */
export const BLOCK_RULES: Record<CanvasRenderKind, BlockRule> = {
  hierarchy: { kind: "hierarchy", renderer: "hierarchy", activation: "inspector" },
  note: { kind: "note", renderer: "note", activation: "inspector" },
  group: { kind: "group", renderer: "group", activation: "inspector" },
  sequence: {
    kind: "sequence",
    renderer: "sequence",
    activation: "inspector",
    // Messages are positioned by the SequenceDiagram component purely from meta.order/from/to --
    // never user-dragged, like the epic tree. The whole layer renders as one own-component, so
    // individual sequence elements carry no box shell.
    lockedLayout: true,
  },
  c1: {
    kind: "c1",
    renderer: "node-box",
    activation: "inspector",
    // c1 stays its own approximation: the old C1 view renders its boxes through the shared hierarchy
    // `Block` component (`.block.block-c1-system`) with its own icon/expand chrome, not a bespoke
    // NodeBox — folding that in is a separate, later concern.
    style: {
      boxClass: "block block-c1-system",
      rowClass: "block-row",
      headerClass: "block-header",
      titleWrapClass: "block-title",
      titleRowClass: "block-name-row",
      nameClass: "block-name",
      descClass: "block-description",
      draggingClass: "c1-node-anchor--dragging",
    },
  },
  pattern: {
    kind: "pattern", renderer: "node-box", activation: "inspector",
    style: { ...DIAGRAM_NODE_BASE },
  },
  impact: {
    kind: "impact",
    renderer: "node-box",
    activation: "inspector",
    overlay: "impact",
    statusChip: "impact",
    style: { ...DIAGRAM_NODE_BASE },
  },
  epic: {
    kind: "epic",
    renderer: "node-box",
    activation: "epic-brief",
    lockedLayout: true,
    style: { ...DIAGRAM_NODE_BASE },
  },
  spec: {
    kind: "spec",
    renderer: "node-box",
    activation: "epic-brief",
    lockedLayout: true,
    // Keep the description (a rolled-up task counter) visible under the spec title.
    style: { ...DIAGRAM_NODE_BASE },
  },
  task: {
    kind: "task",
    renderer: "node-box",
    activation: "inspector",
    // Fixed like epic/spec (user-confirmed): the full task graph is a hard structure.
    lockedLayout: true,
    style: { ...DIAGRAM_NODE_BASE, boxClass: "diagram-node-box diagram-node-box--task" },
  },
  custom: {
    kind: "custom", renderer: "node-box", activation: "inspector",
    style: { ...DIAGRAM_NODE_BASE },
  },
};

/** The kinds CanvasNodeBox styles (every `renderer === "node-box"` kind), keyed for NodeBox's own
 * per-kind style lookup — kept as the derived dict it always was, built from `BLOCK_RULES` so the
 * style strings never drift into their own registry. `sequence` is an own-component kind (no box
 * shell), so it's excluded here along with hierarchy/note/group. */
export type StyledRenderKind = Exclude<
  CanvasRenderKind,
  "hierarchy" | "note" | "group" | "sequence"
>;

/** The box shell for a node-box kind. `StyledRenderKind` only contains `renderer === "node-box"`
 * kinds, so the guard never trips at runtime — it exists purely so TypeScript narrows `style` to
 * `NodeStyleEntry` (required on NodeBoxRule) instead of falling back to a `!` assertion. */
function nodeStyle(kind: StyledRenderKind): NodeStyleEntry {
  const rule = BLOCK_RULES[kind];
  if (rule.renderer !== "node-box") {
    throw new Error(`kind ${kind} is not a node-box kind`);
  }
  return rule.style;
}

export const NODE_STYLES: Record<StyledRenderKind, NodeStyleEntry> = {
  c1: nodeStyle("c1"),
  pattern: nodeStyle("pattern"),
  impact: nodeStyle("impact"),
  custom: nodeStyle("custom"),
  epic: nodeStyle("epic"),
  spec: nodeStyle("spec"),
  task: nodeStyle("task"),
};
