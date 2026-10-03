import type { CanvasDoc, CanvasElement, CanvasPosition, CanvasSize } from "../../state/types";
import { stringMeta } from "./elementMeta";

/**
 * Deterministic per-EP column layout for the epics diagram (010-epics-tree-render, Part 1:
 * the block structure is "one column per epic, stories stacked under their parent epic").
 *
 * The shared layered layout (`layoutBoxes`/`computeLayeredLayout`) keys off `meta.order`/`meta.lane`
 * and edges -- fields the epics artifact never carries -- so it piles everything at (0,0). This is
 * the epics-specific branch used in its place. It derives the hierarchy from the recipe's group
 * frames (010 Part 1: the resolver writes each node's `group` string into a `__group__::<group>`
 * frame), then arranges hard columns with fixed gaps. Nothing here is draggable by the user
 * (CanvasNodeBox's `lockedLayout`), so the layout only needs naming -- every epic, spec and task
 * gets a distinct (x, y), and the group frames bound their members.
 *
 * A full-graph epic (EP-4 · canvas customization) nests to three levels: the epic box on top, its
 * spec boxes (Foundation/US1/US2/US3/Polish) stacked beneath it, and each spec's task boxes under
 * their spec. Nesting follows the frame names: an element's `group_id` names the frame whose
 * `recipe_key` is `__group__::<G>`; the element is a child of the box whose id is `<G>`. So a task
 * with frame `__group__::EP-4::appearance` hangs under the spec whose id is `EP-4::appearance`, and
 * that spec (frame `__group__::EP-4`) hangs under the epic box `EP-4`. A top-level epic (`group:
 * settings` → frame `__group__::settings`) has no box parent and is a column root.
 *
 * Column order is the sorted top-level (root) keys. Within a column the epic sits on top, its specs
 * stack below it, and each spec's tasks stack below their spec. The epic's own domain frame bounds
 * the whole column.
 */
const BOX_WIDTH = 300;
const EPIC_HEIGHT = 72;
const SPEC_HEIGHT = 84;
const TASK_HEIGHT = 60;
/** Horizontal gap between adjacent EP columns. */
const COLUMN_GAP = 140;
/** Vertical gap between an epic's stacked content cards (Summary/Acceptance/Спеки) and before the
 * phase row -- separate from TASK_GAP so enlarging the phase→task gap doesn't stretch the cards. */
const CARD_GAP = 24;
/** Compact vertical gap within a spec's task cluster (spec→first task, task→task). */
const TASK_GAP = 80;
/** Padding a group frame adds around its members. */
const FRAME_PAD = 8;
/** Estimated average glyph width for the box's content font (~0.55rem average), used to turn a line's
 * character count into a pixel width so a box can size itself to its text without measuring the DOM.
 * Monospace chars are ~0.6em; 0.62 × 15px font (epics uses ~0.85rem ≈ 13.6px) lands near real text. */
const CHAR_WIDTH = 0.62 * 14;
/** Roomier than the DOM's actual horizontal padding so the widest line always fits without clipping. */
const CONTENT_H_PADDING = 48;
/** Auto-width is never narrower than this even for a tiny title (a readable box floor). */
const CONTENT_MIN_WIDTH = 640;
/** Hard cap so a single very long line can't balloon a box past a sane canvas width. */
const CONTENT_MAX_WIDTH = 1480;
/** A prose paragraph (e.g. the Summary card) sizes to this comfortable reading column rather than to
 * its longest word (too narrow) or its whole one-line paragraph (always the cap). */
const PROSE_WIDTH = 860;
/** Line height of a body row in px (~0.85rem font at 1.5 line-height in styles.css). */
const LINE_HEIGHT = 21;
/** Vertical room for the title row, top band, meta chips and padding above/below the text -- whatever
 * remains unaccounted by the per-row estimates below. */
const BOX_H_CHROME = 88;
/** Horizontal room the wrapped text actually has, after box padding (~24px each side in styles.css). */
const CONTENT_H_TEXT_WIDTH = 32;
/** Extra vertical room a «Спеки» story card adds over its bare lines (borders + padding around the
 * why line and criteria), so consecutive stories don't overlap when the layout fits the box height. */
const STORY_PAD = 18;

/** The non-blank `\n`-separated lines of a description, each trimmed — the shared split both the
 * structured-list tests and the width/height fits derive their counts from, so the text is parsed
 * once per call instead of re-split in several places. */
export function linesOf(text: string): string[] {
  return text.split("\n").map((s) => s.trim()).filter(Boolean);
}

/** The blank-line-separated groups of a «Спеки» description ("story cards") -- the count CanvasNodeBox
 * renders and `fitContentHeight` budgets per-story chrome from, so the render and the size estimate
 * agree on how many stories a block has. */
export function storyGroupCount(text: string): number {
  return text.split(/\n\s*\n/).map((g) => g.trim()).filter(Boolean).length;
}

/** Whether a description reads as a structured list: >1 non-blank `\n`-separated lines (Acceptance
 * criteria, or an epic brief itemized block) -- each line should sit on its own row. */
function isLineList(text: string): boolean {
  return linesOf(text).length > 1;
}

/** The text a box sizes its width against. For a structured `\n` list, the longest line rules so every
 * criterion fits on one row; for a single-line title, the title's own widest token plus padding. */
export function fitContentWidth(element: CanvasElement): number {
  // A structured `\n` list (Acceptance criteria): each criterion renders on its own row, so the widest
  // criterion dictates the column -- that is what "text fits" means for a list.
  if (isLineList(element.description)) {
    const widest = Math.max(...linesOf(element.description).map((s) => s.length));
    return Math.min(CONTENT_MAX_WIDTH, Math.max(CONTENT_MIN_WIDTH, widest * CHAR_WIDTH + CONTENT_H_PADDING));
  }
  // A prose paragraph (Summary) reads best at a fixed column -- neither its longest word (too narrow)
  // nor its whole one-line paragraph (always the cap), but a comfortable reading width.
  if (element.description.length > 0) {
    return Math.min(CONTENT_MAX_WIDTH, PROSE_WIDTH);
  }
  // A bare title: size to a readable column floor (its widest token is short, so CONTENT_MIN_WIDTH).
  return CONTENT_MIN_WIDTH;
}

/** The vertical height a block needs to render its content with no empty space below -- a companion
 * to `fitContentWidth` so a box (Summary, Acceptance) shrinks to its text and the next box sits right
 * under it. `width` is the fitted width the box will render at, since prose wraps to it. */
export function fitContentHeight(element: CanvasElement, width: number): number {
  // A «Спеки» (User Stories) card: each story is its own bordered card (head, why line, criteria),
  // so it needs per-story chrome on top of its line count -- otherwise the second story overlaps the
  // first's border. The DOM box still grows downward past this `minHeight` floor if we're short.
  if (isSpecs(element)) {
    const groups = storyGroupCount(element.description);
    const rows = linesOf(element.description).length;
    return BOX_H_CHROME + rows * LINE_HEIGHT + groups * STORY_PAD;
  }
  // A structured `\n` list: every criterion fits on its own row (width is sized to the widest), so
  // height is rows × line plus the chrome (title/band/padding).
  if (isLineList(element.description)) {
    return BOX_H_CHROME + linesOf(element.description).length * LINE_HEIGHT;
  }
  // A prose paragraph: wrap to the fitted width and count the lines.
  if (element.description.length > 0) {
    const innerWidth = Math.max(100, width - CONTENT_H_TEXT_WIDTH);
    const charsPerLine = Math.max(1, Math.floor(innerWidth / CHAR_WIDTH));
    const lines = Math.max(1, Math.ceil(element.description.length / charsPerLine));
    return BOX_H_CHROME + lines * LINE_HEIGHT;
  }
  // A bare title keeps its render-kind default (no empty bottom in a title-only box).
  return heightFor(element.render);
}

interface Placed {
  id: string;
  key: string;
  render: CanvasElement["render"];
  x: number;
  y: number;
  width: number;
  height: number;
  children: Placed[];
}

/** Whether a box is a phase-spec header (`EP-4::phase-N`, render `spec`) -- phases lay out in a
 * horizontal row rather than stacking with the epic's content cards. Tasks under a phase carry the
 * same `phase-N` segment but render `task`, so only the header matches. The single shared `phase-N`
 * grammar both the layout and EpicBlockPanel's "Tasks" grouping test against. */
export function isPhaseSpec(render: CanvasElement["render"], key: string): boolean {
  return render === "spec" && /phase-\d+/.test(key);
}

function isPhase(node: Placed): boolean {
  return isPhaseSpec(node.render, node.key);
}

/** The top-level epic key a `recipe_key` belongs to -- `EP-3-01` -> `EP-3`; a bare `EP-1` names itself. */
export function parentEpicKey(key: string): string {
  const match = /^(EP-\d+)-/.exec(key);
  return match ? match[1] : key;
}

/** The height of a box given its render kind. */
function heightFor(render: CanvasElement["render"]): number {
  if (render === "spec") return SPEC_HEIGHT;
  if (render === "task") return TASK_HEIGHT;
  return EPIC_HEIGHT;
}

/** Whether a box is the epics Summary card (authored `meta.summary`), which renders wide and tall. */
export function isSummary(element: CanvasElement): boolean {
  return Boolean(stringMeta(element, "summary"));
}

/** Whether a box is an Acceptance-criteria card (authored `meta.acceptance`), rendered as a list. */
export function isAcceptance(element: CanvasElement): boolean {
  return Boolean(stringMeta(element, "acceptance"));
}

/** Whether a box is a «Спеки» (User Stories) card (authored `meta.specs`), rendered as story cards. */
export function isSpecs(element: CanvasElement): boolean {
  return Boolean(stringMeta(element, "specs"));
}

/** A content card (Summary prose, Acceptance list or Спеки stories) auto-fits width AND height to its
 * text. The epic title box -- even with a tagline description -- is not one: its height stays the
 * authored default. */
export function isContentCard(element: CanvasElement): boolean {
  return isSummary(element) || isAcceptance(element) || isSpecs(element);
}

/**
 * The parent key a box hangs under, by its own `recipe_key`: `EP-4` (no `::`) is a root; a spec
 * `EP-4::appearance` hangs under the epic `EP-4`; a task `EP-4::appearance::T008` hangs under the
 * spec `EP-4::appearance` -- the segment before the last `::`. This mirrors the authored epics
 * hierarchy exactly (the resolver keeps each node's `recipe_key`), independent of the hash element
 * ids and the shared `__group__::EP-4` frame the recipe reuses for every spec.
 */
export function parentKeyOf(recipeKey: string): string | undefined {
  const idx = recipeKey.lastIndexOf("::");
  return idx > 0 ? recipeKey.slice(0, idx) : undefined;
}

/** The phase number a box belongs to, from its `recipe_key` (`EP-4::phase-3` / its tasks end in the
 * `phase-3` segment) -- `0` for anything not under a numbered phase (the epic and its content cards)
 * so they sort before the phases. Keys off the `phase-N` segment, so a task sorts with its own spec. */
function phaseNumber(element: CanvasElement): number {
  const match = /phase-(\d+)/.exec(stringMeta(element, "recipe_key") ?? "");
  return match ? Number(match[1]) : 0;
}

/** Recursively places `node`'s subtree top-down, one block under the next with a fixed `GAP`.
 * An epics box's `position` is its BOTTOM-LEFT corner (`left = x`, `top = y - height` -- see
 * elementRect/CanvasNodeBox), so `startY` is the current row's top edge and a box's `y` is
 * `startY + height`; stacking that way (next top = `prevTop + height + gap`) makes boxes sit
 * edge-to-edge with `GAP` between them and no overlap arithmetic on centers. `x` is shared by the
 * whole column. Returns the y just below the node's whole subtree (top of the next sibling's gap). */
function placeSubtree(node: Placed, x: number, startY: number): number {
  node.x = x;
  // Bottom-left corner = top of the gap start + this box's own height.
  node.y = startY + node.height;
  let cursorY = startY + node.height;
  for (const child of node.children) {
    cursorY += TASK_GAP;
    cursorY = placeSubtree(child, x, cursorY);
  }
  return cursorY;
}

/** A subtree's widest box -- used to bound a phase row and a whole column by their widest member (a
 * wide block like the Summary card is wider than `BOX_WIDTH`). Memoized because the layout calls it
 * once per phase and once per column root; the boxes' `width` is fixed once the tree is built, so a
 * cached value stays valid across the calls. */
function subtreeMaxWidth(node: Placed, cache: Map<Placed, number>): number {
  const hit = cache.get(node);
  if (hit !== undefined) return hit;
  const own = Math.max(node.width, ...node.children.map((c) => subtreeMaxWidth(c, cache)));
  cache.set(node, own);
  return own;
}

/** Bottom edge of `node`'s subtree in the render model (`position.y` is the box's bottom-left
 * corner, so the bottom edge of a leaf box is simply `node.y`; for a parent it's the deepest child's
 * bottom). */
function subtreeBottom(node: Placed): number {
  const own = node.y;
  return node.children.length
    ? Math.max(own, ...node.children.map(subtreeBottom))
    : own;
}

/** Optional real (DOM-measured) heights for content cards, keyed by element id. When supplied they
 * replace the `fitContentHeight` estimate for those cards — a box whose rendered story cards outgrew
 * the estimate re-lays-out to its true footprint instead of overlapping the box above. */
export interface MeasuredHeights {
  [id: string]: number;
}

/** Places the epics layer's boxes into per-EP columns for a fresh recipe run. Pass
 * `measuredHeights` (DOM-measured borders) to re-fit content cards to their real height instead of
 * the `fitContentHeight` estimate — used by the post-mount reflow that fixes an under-estimated card
 * growing up over the box above. */
export function layoutEpics(
  doc: CanvasDoc,
  epicIds: readonly string[],
  measuredHeights?: MeasuredHeights,
): { positions: Record<string, CanvasPosition>; sizes: Record<string, CanvasSize>; size: { width: number; height: number } } {
  const elements = epicIds
    .map((id) => doc.elements[id])
    .filter((e): e is CanvasElement => Boolean(e));
  const boxes: Placed[] = [];
  const frames: Placed[] = [];
  for (const element of elements) {
    if (element.render === "group") {
      frames.push({
        id: element.id, key: stringMeta(element, "recipe_key") ?? element.id, render: "group", x: 0, y: 0, width: 0, height: 0, children: [],
      });
      continue;
    }
    // A content card (Summary prose / Acceptance list) auto-fits BOTH width and height to its text, so
    // it shrinks to what the text needs and the next box sits right under it -- no empty space below.
    // The epic title box keeps its authored/render-kind default height. During a measured reflow a
    // DOM-measured height wins for the box it targets -- and every other sized box keeps its persisted
    // `size.h` (not the `fitContentHeight` estimate, which can drift from the rendered card), so the
    // reflow only ever touches the boxes it set out to fix and an unchanged box stays as the layer's
    // anchor (useReflowEpics). A content card with no persisted height yet still falls back to the fit.
    const card = isContentCard(element);
    const width = card ? fitContentWidth(element) : element.size?.w ?? BOX_WIDTH;
    const measuredH = measuredHeights ? measuredHeights[element.id] : undefined;
    const height = measuredH ?? (card
      ? element.size?.h ?? fitContentHeight(element, width)
      : element.size?.h ?? heightFor(element.render));
    const key = stringMeta(element, "recipe_key") ?? element.id;
    boxes.push({ id: element.id, key, render: element.render, x: 0, y: 0, width, height, children: [] });
  }
  // Build the hierarchy from each box's own `recipe_key` (the authored nesting: epic `EP-4` →
  // spec `EP-4::appearance` → task `EP-4::appearance::T008`). This is independent of the hash
  // element ids and the shared `__group__::EP-4` frame the recipe reuses for every spec, so it is
  // robust no matter how the recipe wires group frames.
  const byId = new Map<string, CanvasElement>(elements.map((e) => [e.id, e]));
  const byRecipeKey = new Map<string, Placed>();
  for (const box of boxes) {
    byRecipeKey.set(stringMeta(byId.get(box.id)!, "recipe_key") ?? box.id, box);
  }
  const roots: Placed[] = [];
  for (const box of boxes) {
    const key = stringMeta(byId.get(box.id)!, "recipe_key") ?? box.id;
    const parentKey = parentKeyOf(key);
    const parent = parentKey ? byRecipeKey.get(parentKey) : undefined;
    if (parent) parent.children.push(box);
    else roots.push(box);
  }
  // Order each box's children for the vertical stack deterministically -- the recipe projects
  // elements in hash-id order, so without this the phases and their tasks would render in arbitrary
  // order instead of reading top-to-bottom: an epic's content cards (Summary/Acceptance/Спеки)
  // first, then its phase-specs by phase number, and each spec's tasks by task number. A summary
  // card thus hangs immediately under its parent, never buried among the specs/tasks below.
  for (const box of boxes) {
    box.children.sort((a, b) => {
      const ea = byId.get(a.id)!;
      const eb = byId.get(b.id)!;
      const aCard = isContentCard(ea) ? 1 : 0;
      const bCard = isContentCard(eb) ? 1 : 0;
      if (aCard !== bCard) return bCard - aCard;
      const aSpec = phaseNumber(ea);
      const bSpec = phaseNumber(eb);
      if (aSpec !== bSpec) return aSpec - bSpec;
      const aKey = stringMeta(ea, "recipe_key") ?? a.id;
      const bKey = stringMeta(eb, "recipe_key") ?? b.id;
      return aKey.localeCompare(bKey);
    });
  }

  // One column per root (normally the single epic EP-4). The root's non-phase children (content
  // cards like Summary/Спеки) stack vertically under it; its phase-specs lay out in a horizontal
  // row beneath those cards, each phase's task boxes stacking under their own phase so the graph
  // reads epic → cards → [phase-1 | phase-2 | ...] with each phase's tasks below it.
  // `placeSubtree` sets a box's x from its `indent` only, so a column's x is applied here (by
  // calling it at indent = cursorX) -- a child's own x is then cursorX + its own indent.
  const widthCache: Map<Placed, number> = new Map();
  let cursorX = 0;
  let maxColumnHeight = 0;
  for (const root of roots) {
    // Root box sits at the column's top-left.
    root.x = cursorX;
    root.y = root.height;
    let cursorY = root.height;

    // Content cards and any non-phase children stack vertically under the root.
    const phases = root.children.filter(isPhase);
    const stacked = root.children.filter((c) => !isPhase(c));
    for (const child of stacked) {
      cursorY += CARD_GAP;
      cursorY = placeSubtree(child, cursorX, cursorY);
    }

    // Phase-specs form a horizontal row below the stacked cards; each phase's tasks hang under it.
    const phasesTop = cursorY + CARD_GAP;
    let phaseX = cursorX;
    for (const phase of phases) {
      phase.x = phaseX;
      phase.y = phasesTop + phase.height;
      let py = phasesTop + phase.height;
      for (const task of phase.children) {
        py += TASK_GAP;
        py = placeSubtree(task, phaseX, py);
      }
      // The next phase's x is bounded by this phase's widest box (its tasks may outgrow BOX_WIDTH),
      // so a later phase never overlaps a wide sibling -- not just the nominal BOX_WIDTH.
      const phaseWidth = Math.max(subtreeMaxWidth(phase, widthCache), BOX_WIDTH);
      phaseX += phaseWidth + COLUMN_GAP;
      cursorY = Math.max(cursorY, py);
    }
    const phasesSpan = phases.length ? phaseX - COLUMN_GAP - cursorX : 0;

    maxColumnHeight = Math.max(maxColumnHeight, cursorY);
    // The next column's x is bounded by this column's widest extent: the star of its stacked cards
    // and the horizontal span of its phase row, so a later root never overlaps a wide sibling.
    const columnWidth = Math.max(
      subtreeMaxWidth(root, widthCache),
      phasesSpan,
      BOX_WIDTH,
    );
    cursorX += columnWidth + COLUMN_GAP;
  }

  // Position each frame to bound the full subtree of every box whose `group_id` names it (a spec's
  // task frame `__group__::EP-4::appearance` wraps the spec's tasks; the epic's domain frame and
  // the shared `__group__::EP-4` frame wrap the boxes directly grouped under them). A frame's x/y
  // here are computed as its LEFT-TOP corner (minX/minY minus padding); the loop body below lives in
  // that corner model because it uses x + width / height for bounds. `positions` below then converts
  // to the render model -- CanvasNodeBox draws every box (frames included) from its CENTER
  // (`left: x - width/2`), so a frame must be recorded at its center, or it drifts half its own
  // extent right/down and lands on the very blocks it wraps instead of around them.
  const memberById: Map<string, Placed[]> = new Map();
  for (const box of boxes) {
    const gid = byId.get(box.id)!.group_id;
    if (gid) {
      const list = memberById.get(gid);
      if (list) list.push(box);
      else memberById.set(gid, [box]);
    }
  }
  for (const frame of frames) {
    const members = memberById.get(frame.id) ?? [];
    // A phase-spec frame names its own header (the recipe's `__group__::EP-4::phase-N` labels the spec
    // `EP-4::phase-N`), so pull that box into the frame too -- otherwise the header floats above the
    // frame that should wrap it, sticking out over the top-left corner.
    const ownerKey = (frame.key ?? "").replace(/^__group__::/, "");
    const owner = ownerKey ? boxes.find((b) => b.key === ownerKey) : undefined;
    if (owner && !members.some((m) => m.id === owner.id)) members.push(owner);
    if (members.length === 0) continue;
    // Members' `x`/`y` are bottom-left corners (left = x, top = y - height), so a member's left-top
    // rect spans x..x+width and y-height..y.
    const minX = Math.min(...members.map((m) => m.x));
    const minY = Math.min(...members.map((m) => m.y - m.height));
    const maxX = Math.max(...members.map((m) => m.x + m.width));
    const maxY = Math.max(...members.map(subtreeBottom));
    frame.x = minX - FRAME_PAD;
    frame.y = minY - FRAME_PAD;
    frame.width = maxX - minX + FRAME_PAD * 2;
    frame.height = maxY - minY + FRAME_PAD * 2;
  }

  const positions: Record<string, CanvasPosition> = {};
  for (const placed of [...boxes, ...frames]) {
    // A box's x/y are already bottom-left corners (placeSubtree sets them as such) -- the epics
    // convention elementRect/CanvasNodeBox render from. A frame's are left-top corners from the loop
    // above and renders from its CENTER (frames aren't in the bottom-left set), so shift it by half
    // its extent to the center position the renderer expects.
    if (placed.render === "group") {
      positions[placed.id] = { x: placed.x + placed.width / 2, y: placed.y + placed.height / 2 };
    } else {
      positions[placed.id] = { x: placed.x, y: placed.y };
    }
  }
  const totalWidth = cursorX === 0 ? 0 : cursorX - COLUMN_GAP;
  const maxHeight = Math.max(
    0,
    ...boxes.map(subtreeBottom),
    // Frame bottom edge: its center y (converted above is not yet applied to `frame.y`), so compute
    // from the still-present corner y + height.
    ...frames.map((f) => f.y + f.height),
  );
  // Every non-frame box's adopted footprint, so the layout caller can persist it (a content-fit width
  // only matters if it reaches `element.size`; otherwise the renderer keeps the old/default width).
  const sizes: Record<string, CanvasSize> = {};
  for (const box of boxes) {
    sizes[box.id] = { w: box.width, h: box.height };
  }
  return { positions, sizes, size: { width: totalWidth, height: maxHeight } };
}

/** Whether `layer` is an epics diagram layer -- the single `"epics"` built-in, or a per-epic
 * `epics/<id>` synthesized layer. Since one epic is now one layer, the gate is the prefix, not the
 * exact name. */
export function isEpicsLayerName(layer: string): boolean {
  return layer === "epics" || layer.startsWith("epics/");
}

/** Whether an epics-layer recipe run is what produced these ids -- the gate `layoutNewElements` checks. */
export function isEpicsLayer(doc: CanvasDoc, ids: readonly string[]): boolean {
  return ids.some((id) => {
    const element = doc.elements[id];
    return (
      element &&
      isEpicsLayerName(element.layer) &&
      (element.render === "epic" || element.render === "group")
    );
  });
}
