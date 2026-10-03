import { NODE_SEP, RANK_SEP } from "../collision/constants";
import { resolveDrop, type Obstacle, type Rect } from "../collision/resolveDrop";
import { leadingOrderDigits } from "../doc/elementMeta";
import type { Point } from "./orthogonalRoute";
import type { LayoutBoxSpec, PositionedBox } from "./diagramLayout";

/** Directed edge shape `layoutBoxes()` accepts. Direction (`from`→`to`) is what this module ranks
 * on: for a one-directional edge (no matching reverse edge), `from`'s box always ends up above
 * `to`'s — 051-directed-layered-diagram-layout. `kind` is accepted for parity with the previous
 * radial layout's edge shape but no longer affects layout — every edge kind reads the same way
 * (source above target), per the confirmed decision recorded in that plan. */
export interface LayoutEdge {
  from: string;
  to: string;
  kind?: string;
}

// `@dagrejs/dagre` is still a declared dependency (`web/package.json`), but this file hand-rolls its
// own cycle-break/rank/order passes rather than calling it: this repo already moved away from dagre
// once (024-degree-priority-diagram-layout), specifically to control tie-breaks/determinism and
// custom placement rules dagre doesn't expose — the same reason applies here for the "source above
// target" rule this file adds. Not an oversight; see 051-directed-layered-diagram-layout.

/** Outer canvas margin. */
const MARGIN = 40;

/** Row width a packed run of components wraps at. Sized so a row holds ~5 default (300x72) boxes
 * (5 * 300 + 4 * NODE_SEP = 1940) and a 6th wraps onto the next row -- the old 2400 let almost the
 * whole diagram spill into one 2000px+ horizontal band (the "new diagram spreads blocks far apart"
 * bug: multi-component batches never wrapped, so every block sat in a single endless row). A single
 * connected diagram is one component and is laid out by ranks regardless, so lowering this only
 * tightens how separate components pack side by side, never how one diagram's rows are ranked. */
const MAX_ROW_WIDTH = 2000;

interface DirectedEdge {
  from: string;
  to: string;
}

interface Component {
  nodeIds: string[];
  ranks: string[][];
}

/** Weakly-connected components over the (deduped, self-loop-free) edge set, via union-find so every
 * node — including one with no edges at all — ends up in exactly one component. */
function detectComponents(nodes: readonly LayoutBoxSpec[], edges: readonly DirectedEdge[]): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor) as string;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const node of nodes) parent.set(node.id, node.id);
  for (const edge of edges) union(edge.from, edge.to);

  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const root = find(node.id);
    const group = groups.get(root);
    if (group) group.push(node.id);
    else groups.set(root, [node.id]);
  }
  return [...groups.values()];
}

/** A `from → Set<to>` index, used in place of a `${from}→${to}` string key: two distinct node ids
 * that happen to contain whatever separator a flattened string key picks (e.g. a "→") could otherwise
 * collide and silently merge two unrelated edges. Node ids here are generally code-derived and won't
 * contain it, but custom/user-authored diagram types don't guarantee that — a nested Set removes the
 * risk outright rather than relying on picking an "unlikely enough" separator. */
function markPair(index: Map<string, Set<string>>, from: string, to: string): void {
  let targets = index.get(from);
  if (!targets) {
    targets = new Set();
    index.set(from, targets);
  }
  targets.add(to);
}

function hasPair(index: ReadonlyMap<string, Set<string>>, from: string, to: string): boolean {
  return index.get(from)?.has(to) ?? false;
}

/** Dedups same-direction A→B pairs into one structural edge and drops self-loops, mirroring the old
 * `bfsLayout.ts`'s `edge.from === edge.to` skip. A dropped/collapsed edge still renders — this only
 * affects the graph structure ranking is computed over. */
function structuralEdges(nodes: readonly LayoutBoxSpec[], edges: readonly LayoutEdge[]): DirectedEdge[] {
  const idSet = new Set(nodes.map((node) => node.id));
  const seen = new Map<string, Set<string>>();
  const result: DirectedEdge[] = [];
  for (const edge of edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to) || edge.from === edge.to) continue;
    if (hasPair(seen, edge.from, edge.to)) continue;
    markPair(seen, edge.from, edge.to);
    result.push({ from: edge.from, to: edge.to });
  }
  return result;
}

/** Marks every back-edge of a deterministic DFS (node order: sorted by id; each node's own outgoing
 * edges also sorted by target id) — the standard feedback-arc-set-via-DFS approach. A back-edge is
 * the one that closes a cycle (points at a node currently on the DFS stack); excluding those from
 * ranking is what lets a true two-way relationship (no single flow direction) skip the "source above
 * target" constraint instead of producing a contradiction, while still rendering normally. The DFS
 * itself uses an explicit stack rather than recursion, so a pathologically long directed chain can't
 * exhaust the call stack the way a recursive `visit()` would. */
function breakCycles(nodeIds: readonly string[], edges: readonly DirectedEdge[]): DirectedEdge[] {
  const childrenOf = new Map<string, string[]>();
  for (const id of nodeIds) childrenOf.set(id, []);
  for (const edge of edges) childrenOf.get(edge.from)?.push(edge.to);
  for (const children of childrenOf.values()) children.sort();

  const state = new Map<string, "visiting" | "done">();
  const backEdges = new Map<string, Set<string>>();
  const orderedIds = [...nodeIds].sort();

  for (const startId of orderedIds) {
    if (state.has(startId)) continue;
    // Each stack frame is a node plus how far through its (already-sorted) children list the DFS has
    // gotten — resuming a frame is just continuing that index instead of re-visiting from scratch.
    const stack: { id: string; childIndex: number }[] = [{ id: startId, childIndex: 0 }];
    state.set(startId, "visiting");
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = childrenOf.get(frame.id) ?? [];
      if (frame.childIndex >= children.length) {
        state.set(frame.id, "done");
        stack.pop();
        continue;
      }
      const child = children[frame.childIndex];
      frame.childIndex += 1;
      const childState = state.get(child);
      if (childState === "visiting") markPair(backEdges, frame.id, child);
      else if (childState !== "done") {
        state.set(child, "visiting");
        stack.push({ id: child, childIndex: 0 });
      }
    }
  }

  return edges.filter((edge) => !hasPair(backEdges, edge.from, edge.to));
}

/** The leading run of ASCII digits in an authored `order` string (via the shared `leadingOrderDigits`,
 * `doc/elementMeta.ts`) is its rank value, 0-indexed to line up with `computeRanks`' topological
 * default (a parentless box ranks 0) -- "1" and "2a" both seed a component at the same place a
 * parentless box would land on its own. No leading digit run (empty, non-numeric prefix) means "no
 * order", same as the field being absent -- never a hard failure. Clamped at 0 so a stray
 * `order: "0"` can't produce a negative rank (054-diagram-flow-order, ADR 0002). */
function parseOrderRank(order: string | undefined): number | undefined {
  const digits = leadingOrderDigits(order);
  if (digits === undefined) return undefined;
  const rank = Number.parseInt(digits, 10) - 1;
  if (rank < 0) console.warn(`meta.order "${order}" is out of range (Order is 1-indexed) -- treating as "1"`);
  return Math.max(0, rank);
}

/** Longest-path layering over the (already cycle-free) rank graph via Kahn's algorithm: a node's rank
 * is 0 with no incoming edge, else one more than the highest-ranked parent — the tightest rank every
 * node can have while still satisfying every parent constraint (see 051's planning doc for why this
 * is already height-minimal, so no separate "tightening" pass is needed on top of it). Ready nodes
 * are always processed in id order so identical input yields identical output.
 *
 * `orderRankOf` (054-diagram-flow-order, ADR 0002) pins a box's rank to its authored `order` instead
 * of computing it from parents -- order is authoritative when present, not merely a tiebreaker, so it
 * can (and is meant to) override what topology alone would say. An order-less box is unaffected: its
 * rank still comes from its real parents' ranks, whether those parents are order-pinned or not, which
 * is what reconciles the two onto one scale instead of two independent numberings. */
function computeRanks(
  nodeIds: readonly string[],
  rankEdges: readonly DirectedEdge[],
  orderRankOf: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const id of nodeIds) {
    parentsOf.set(id, []);
    childrenOf.set(id, []);
  }
  for (const edge of rankEdges) {
    parentsOf.get(edge.to)?.push(edge.from);
    childrenOf.get(edge.from)?.push(edge.to);
  }

  const remainingInDegree = new Map<string, number>(nodeIds.map((id) => [id, (parentsOf.get(id) ?? []).length]));
  const rank = new Map<string, number>();
  // Filtered, not yet sorted — the loop below sorts before every read, so an upfront sort here would
  // be redundant work thrown away on the first iteration.
  const ready = [...nodeIds].filter((id) => (remainingInDegree.get(id) ?? 0) === 0);

  while (ready.length > 0) {
    ready.sort();
    const id = ready.shift() as string;
    const fixedRank = orderRankOf.get(id);
    if (fixedRank !== undefined) {
      rank.set(id, fixedRank);
    } else {
      const parentRanks = (parentsOf.get(id) ?? []).map((parentId) => rank.get(parentId) ?? 0);
      rank.set(id, parentRanks.length > 0 ? Math.max(...parentRanks) + 1 : 0);
    }
    for (const child of childrenOf.get(id) ?? []) {
      const remaining = (remainingInDegree.get(child) ?? 0) - 1;
      remainingInDegree.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }
  return rank;
}

/** Compresses a component's rank values onto a dense 0..k-1 scale, preserving relative order --
 * an authored `order` of "1" and "100" (054-diagram-flow-order) would otherwise leave 98 empty ranks
 * between them, each still adding a `RANK_SEP` row of dead space in `layoutComponentLocal`. Only
 * relative order ever matters downstream (rank-indexed bins, `correctOverlaps`' top-to-bottom pass),
 * never the raw numeric value, so compressing once per component right after `computeRanks` is safe. */
function compressRanks(ids: readonly string[], rank: ReadonlyMap<string, number>): Map<string, number> {
  const distinct = [...new Set(ids.map((id) => rank.get(id) ?? 0))].sort((a, b) => a - b);
  const compressedOf = new Map(distinct.map((value, index) => [value, index]));
  return new Map(ids.map((id) => [id, compressedOf.get(rank.get(id) ?? 0) as number]));
}

function degreeOf(nodeIds: readonly string[], edges: readonly DirectedEdge[]): Map<string, number> {
  const degree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  return degree;
}

/** The deterministic id tie-break every sort in this module falls back to, shared so the rule stays
 * in one place. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Pulls same-`lane` nodes adjacent within an already-ordered list, without disturbing the relative
 * order that decided it (054-diagram-flow-order): a lane's spot in the row is its earliest member's
 * position in `orderedIds`, and every other member of that lane moves up to sit right after it, in
 * their own relative order. A lane-less node keeps its own position exactly as `orderedIds` gave it.
 * `Array.prototype.sort` is stable, so this reduces to one stable sort keyed on "my lane's first
 * occurrence index, or my own index when I have no lane" -- no lane data at all means every node is
 * its own singleton group and the input order passes through unchanged, which is what keeps a
 * lane-less diagram byte-for-byte identical to before this existed. */
function clusterByLane(orderedIds: readonly string[], laneOf: ReadonlyMap<string, string>): string[] {
  const firstIndexOfLane = new Map<string, number>();
  orderedIds.forEach((id, index) => {
    const lane = laneOf.get(id);
    if (lane !== undefined && !firstIndexOfLane.has(lane)) firstIndexOfLane.set(lane, index);
  });
  return orderedIds
    .map((id, index) => ({ id, index, clusterIndex: firstIndexOfLane.get(laneOf.get(id) ?? "") ?? index }))
    .sort((a, b) => (a.clusterIndex !== b.clusterIndex ? a.clusterIndex - b.clusterIndex : a.index - b.index))
    .map((entry) => entry.id);
}

/** Orders one rank's nodes: rank 0 (no parents anywhere) sorts by degree desc then id asc, same
 * tie-break style the old radial layout used for its hub. A deeper rank sorts by the average X of its
 * already-placed parents (a single top-down barycenter pass — no iteration, so it stays a single
 * deterministic pass) so a branch's children land roughly under it instead of interleaving with an
 * unrelated sibling branch's children; nodes with no positioned parent (only reachable via a
 * cycle-broken back-edge) fall back to the degree/id tie-break. Each node's barycenter is computed
 * once up front (decorate-sort-undecorate) rather than inside the comparator, which would otherwise
 * recompute the same value on every comparison the sort makes. `laneOf` (054-diagram-flow-order) then
 * pulls same-lane nodes adjacent via `clusterByLane`, ahead of/overriding whatever this barycenter/
 * degree/id pass alone would have produced -- an empty `laneOf` leaves the result untouched. */
function orderRank(
  layerIds: readonly string[],
  parentsOf: ReadonlyMap<string, string[]>,
  positionOf: ReadonlyMap<string, Point>,
  degree: ReadonlyMap<string, number>,
  laneOf: ReadonlyMap<string, string>,
): string[] {
  const barycenterOf = (id: string): number | undefined => {
    const parentXs = (parentsOf.get(id) ?? [])
      .map((parentId) => positionOf.get(parentId)?.x)
      .filter((x): x is number => x !== undefined);
    if (parentXs.length === 0) return undefined;
    return parentXs.reduce((sum, x) => sum + x, 0) / parentXs.length;
  };
  const decorated = layerIds.map((id) => ({ id, barycenter: barycenterOf(id) }));
  decorated.sort((a, b) => {
    if (a.barycenter !== undefined && b.barycenter !== undefined && a.barycenter !== b.barycenter) {
      return a.barycenter - b.barycenter;
    }
    if ((a.barycenter !== undefined) !== (b.barycenter !== undefined)) {
      return a.barycenter !== undefined ? -1 : 1;
    }
    const degreeDiff = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
    if (degreeDiff !== 0) return degreeDiff;
    return compareIds(a.id, b.id);
  });
  return clusterByLane(decorated.map((entry) => entry.id), laneOf);
}

/** Places one component in its own local coordinate space: rank 0's tallest box top-aligns at y=0,
 * and each following rank starts RANK_SEP below the *previous* rank's actual tallest box (not a
 * component-wide average) — so no two adjacent ranks can overlap regardless of how box heights vary
 * across the diagram, which is what makes "A above B" for every non-cycle directed edge A→B correct
 * by construction rather than something the later `correctOverlaps` pass has to paper over. Each
 * rank is centered on x=0 independently; the barycenter ordering in `orderRank` is what keeps
 * related ranks roughly aligned despite that. */
function layoutComponentLocal(
  component: Component,
  boxById: ReadonlyMap<string, LayoutBoxSpec>,
  parentsOf: ReadonlyMap<string, string[]>,
  degree: ReadonlyMap<string, number>,
  laneOf: ReadonlyMap<string, string>,
): Map<string, Point> {
  const positions = new Map<string, Point>();
  let previousBottom = 0;
  component.ranks.forEach((layerIds, rankIndex) => {
    const ordered = orderRank(layerIds, parentsOf, positions, degree, laneOf);
    const widths = ordered.map((id) => boxById.get(id)?.width ?? 0);
    const heights = ordered.map((id) => boxById.get(id)?.height ?? 0);
    const maxHeight = Math.max(0, ...heights);
    const totalWidth = widths.reduce((sum, width) => sum + width, 0) + NODE_SEP * Math.max(ordered.length - 1, 0);
    let cursorX = -totalWidth / 2;
    const y = rankIndex === 0 ? maxHeight / 2 : previousBottom + RANK_SEP + maxHeight / 2;
    ordered.forEach((id, index) => {
      const width = widths[index];
      positions.set(id, { x: cursorX + width / 2, y });
      cursorX += width + NODE_SEP;
    });
    previousBottom = y + maxHeight / 2;
  });
  return positions;
}

function localBounds(
  nodeIds: readonly string[],
  positions: ReadonlyMap<string, Point>,
  boxById: ReadonlyMap<string, LayoutBoxSpec>,
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of nodeIds) {
    const position = positions.get(id) as Point;
    const box = boxById.get(id) as LayoutBoxSpec;
    minX = Math.min(minX, position.x - box.width / 2);
    maxX = Math.max(maxX, position.x + box.width / 2);
    minY = Math.min(minY, position.y - box.height / 2);
    maxY = Math.max(maxY, position.y + box.height / 2);
  }
  return { minX, minY, maxX, maxY };
}

/** Packs each component's local layout left-to-right with NODE_SEP gaps, wrapping past
 * MAX_ROW_WIDTH. Sorted largest-first so isolated (single-node) components trail into what reads as
 * a grid, same shape as the old radial layout's packing pass. */
function packComponents(
  layouts: readonly { component: Component; positions: Map<string, Point> }[],
  boxById: ReadonlyMap<string, LayoutBoxSpec>,
): Map<string, Point> {
  // Each component's min id computed once (a single reduce) rather than inside the sort comparator,
  // which would otherwise re-sort the whole nodeIds array on every comparison just to read [0].
  const minIdOf = new Map<Component, string>(
    layouts.map(({ component }) => [component, component.nodeIds.reduce((min, id) => (id < min ? id : min))]),
  );
  const ordered = [...layouts].sort((a, b) => {
    const sizeDiff = b.component.nodeIds.length - a.component.nodeIds.length;
    if (sizeDiff !== 0) return sizeDiff;
    return compareIds(minIdOf.get(a.component) as string, minIdOf.get(b.component) as string);
  });

  const globalPositions = new Map<string, Point>();
  let cursorX = 0;
  let rowY = 0;
  let rowHeight = 0;
  let isFirstInRow = true;

  for (const { component, positions } of ordered) {
    const bounds = localBounds(component.nodeIds, positions, boxById);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (!isFirstInRow && cursorX + width > MAX_ROW_WIDTH) {
      cursorX = 0;
      rowY += rowHeight + NODE_SEP;
      rowHeight = 0;
      isFirstInRow = true;
    }
    const offsetX = cursorX - bounds.minX;
    const offsetY = rowY - bounds.minY;
    for (const id of component.nodeIds) {
      const position = positions.get(id) as Point;
      globalPositions.set(id, { x: position.x + offsetX, y: position.y + offsetY });
    }
    cursorX += width + NODE_SEP;
    rowHeight = Math.max(rowHeight, height);
    isFirstInRow = false;
  }
  return globalPositions;
}

/** Sequential overlap correction via the shared drag-and-drop solver, same technique the old radial
 * layout used. Processing order matters: whichever box resolves first keeps its intended spot, and
 * every later box can only be pushed farther away. Ordering by rank (top ranks first, ties by X then
 * id) keeps the "reads top-down" property intact after this pass — a lower-ranked (further downstream)
 * box never gets to bump an upstream one out of its intended row. */
function correctOverlaps(
  globalPositions: ReadonlyMap<string, Point>,
  nodes: readonly LayoutBoxSpec[],
  rankOf: ReadonlyMap<string, number>,
): Map<string, Point> {
  const order = [...nodes].sort((a, b) => {
    const rankA = rankOf.get(a.id) ?? 0;
    const rankB = rankOf.get(b.id) ?? 0;
    if (rankA !== rankB) return rankA - rankB;
    const positionA = globalPositions.get(a.id) as Point;
    const positionB = globalPositions.get(b.id) as Point;
    if (positionA.x !== positionB.x) return positionA.x - positionB.x;
    return compareIds(a.id, b.id);
  });

  const resolved = new Map<string, Point>();
  const obstacles: Obstacle[] = [];
  for (const box of order) {
    const center = globalPositions.get(box.id) as Point;
    const moving: Rect = {
      x: center.x - box.width / 2,
      y: center.y - box.height / 2,
      width: box.width,
      height: box.height,
    };
    const result = resolveDrop(moving, obstacles);
    const finalCenter = result.blocked
      ? center
      : { x: result.x + box.width / 2, y: result.y + box.height / 2 };
    resolved.set(box.id, finalCenter);
    obstacles.push({
      id: box.id,
      x: finalCenter.x - box.width / 2,
      y: finalCenter.y - box.height / 2,
      width: box.width,
      height: box.height,
    });
  }
  return resolved;
}

/** The directed layered layout: for every edge A→B with no matching reverse edge, A's box always
 * ends up above B's — 051-directed-layered-diagram-layout, replacing the previous degree-priority
 * radial layout (024). Same contract shape as the layout it replaces (see
 * specs/024-degree-priority-diagram-layout/contracts/layout-boxes.md for the superseded
 * hub-centering postconditions and the new ones this plan records instead). */
export function computeLayeredLayout(
  nodes: readonly LayoutBoxSpec[],
  edges: readonly LayoutEdge[],
): { boxes: PositionedBox[]; width: number; height: number } {
  if (nodes.length === 0) return { boxes: [], width: 600, height: 400 };

  const nodeIds = nodes.map((node) => node.id);
  const boxById = new Map(nodes.map((node) => [node.id, node]));
  const structural = structuralEdges(nodes, edges);
  const degree = degreeOf(nodeIds, structural);
  const orderRankOf = new Map<string, number>();
  for (const node of nodes) {
    const orderRank = parseOrderRank(node.order);
    if (orderRank !== undefined) orderRankOf.set(node.id, orderRank);
  }
  const laneOf = new Map<string, string>();
  for (const node of nodes) {
    if (node.lane) laneOf.set(node.id, node.lane);
  }

  // Bucket edges by component once (every edge belongs to exactly one, since union-find already
  // grouped nodes through these same edges) instead of re-filtering the whole edge list per
  // component below.
  const componentGroups = detectComponents(nodes, structural);
  const componentIndexOf = new Map<string, number>();
  componentGroups.forEach((ids, index) => {
    for (const id of ids) componentIndexOf.set(id, index);
  });
  const edgesByComponent: DirectedEdge[][] = componentGroups.map(() => []);
  for (const edge of structural) {
    const index = componentIndexOf.get(edge.from);
    if (index !== undefined) edgesByComponent[index].push(edge);
  }

  const parentsOf = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  const rankOf = new Map<string, number>();
  const components: Component[] = componentGroups.map((ids, index) => {
    const rankEdges = breakCycles(ids, edgesByComponent[index]);
    for (const edge of rankEdges) parentsOf.get(edge.to)?.push(edge.from);

    const rank = compressRanks(ids, computeRanks(ids, rankEdges, orderRankOf));
    const ranks: string[][] = [];
    for (const id of ids) {
      const depth = rank.get(id) ?? 0;
      rankOf.set(id, depth);
      while (ranks.length <= depth) ranks.push([]);
      ranks[depth].push(id);
    }
    return { nodeIds: ids, ranks };
  });

  const localLayouts = components.map((component) => ({
    component,
    positions: layoutComponentLocal(component, boxById, parentsOf, degree, laneOf),
  }));

  const globalPositions = packComponents(localLayouts, boxById);

  const resolvedPositions = correctOverlaps(globalPositions, nodes, rankOf);

  const { minX, minY, maxX, maxY } = localBounds(nodeIds, resolvedPositions, boxById);

  const shiftX = MARGIN - minX;
  const shiftY = MARGIN - minY;
  const boxes = nodes.map((node) => {
    const position = resolvedPositions.get(node.id) as Point;
    return {
      id: node.id,
      x: position.x + shiftX,
      y: position.y + shiftY,
      width: node.width,
      height: node.height,
    };
  });

  return { boxes, width: maxX - minX + 2 * MARGIN, height: maxY - minY + 2 * MARGIN };
}
