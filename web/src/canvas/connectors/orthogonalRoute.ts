export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Side = "left" | "right" | "top" | "bottom";

export interface Lane {
  /** Signed perpendicular shift of this arrow's anchors and its crossing segment. */
  offset: number;
  /** 0-based position within the pair's lane group — the around-route's outer lane distance. */
  rank: number;
}

export interface Route {
  d: string;
  /** Midpoint of the route's longest segment — where a caption sits without straddling a corner. */
  label: Point;
  points: Point[];
}

export const CONNECTOR = {
  /** Straight run out of a box before the first turn, so an arrow leaves perpendicular to its side. */
  stub: 18,
  /** Perpendicular separation between two arrows joining the same pair of blocks. */
  laneGap: 14,
  /** Elbow radius. */
  corner: 8,
  /** Keeps a lane-shifted anchor off the side's own corners. */
  sidePad: 8,
};

const EPSILON = 0.01;

const DIRECTION: Record<Side, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

function centerX(rect: Rect): number {
  return rect.left + rect.width / 2;
}

function centerY(rect: Rect): number {
  return rect.top + rect.height / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** A box laid out around its centre (dagre's own coordinate shape) as a rect. */
export function rectFromBox(box: { x: number; y: number; width: number; height: number }): Rect {
  return { left: box.x - box.width / 2, top: box.y - box.height / 2, width: box.width, height: box.height };
}

/** Groups arrows by the pair they join — direction-insensitive, so A→B and B→A share lanes. */
export function pairKeyOf(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/** Assigns each arrow a lane within its pair group: n arrows between the same two blocks come back
 * spread symmetrically around the centre line, so two relationships never draw as one. */
export function assignLanes<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  gap: number = CONNECTOR.laneGap,
): Lane[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return items.map((item) => {
    const key = keyOf(item);
    const rank = seen.get(key) ?? 0;
    seen.set(key, rank + 1);
    const total = counts.get(key) ?? 1;
    return { offset: (rank - (total - 1) / 2) * gap, rank };
  });
}

/** Identity key for a box's rect — there is no real box id at this layer, so the rounded geometry
 * itself is what "the same box" means here (as `createRouter`'s own obstacle dedup already does). */
export function rectKeyOf(rect: Rect): string {
  return `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
}

/** Assigns each arrow-endpoint a shift along the side it attaches to, grouped by the exact box+side
 * (not by which pair of boxes the arrow joins). This is what keeps a busy box's border readable: two
 * arrows into the same side from two *different* other boxes used to both land on that side's exact
 * midpoint (pair-based lanes never separate them, since each is the only arrow in its own pair) —
 * spreading by box+side instead means every arrow touching a given side gets its own point along it,
 * wherever it is on the border, regardless of which other box is on the far end. Reuses `assignLanes`'
 * own counting pass (each key is its own group) and keeps only the offset half of its result. */
export function assignPorts(keys: readonly string[], gap: number = CONNECTOR.laneGap): number[] {
  return assignLanes(keys, (key) => key, gap).map((lane) => lane.offset);
}

/** Which side each box is left by / entered on: the axis the two are actually separated along,
 * falling back to the dominant centre-to-centre delta when they overlap on both axes. */
export function chooseSides(from: Rect, to: Rect): [Side, Side] {
  const gapX = Math.max(to.left - (from.left + from.width), from.left - (to.left + to.width));
  const gapY = Math.max(to.top - (from.top + from.height), from.top - (to.top + to.height));
  const dx = centerX(to) - centerX(from);
  const dy = centerY(to) - centerY(from);
  let horizontal: boolean;
  if (gapX >= 0 && gapY < 0) horizontal = true;
  else if (gapY >= 0 && gapX < 0) horizontal = false;
  else horizontal = Math.abs(dx) > Math.abs(dy);

  if (horizontal) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

/** The point an arrow attaches to: the side's midpoint, shifted along that side by the lane offset
 * and clamped so a busy pair's outer lanes still land on the box rather than beside it. */
export function anchorOf(rect: Rect, side: Side, laneOffset = 0): Point {
  if (side === "left" || side === "right") {
    const pad = Math.min(CONNECTOR.sidePad, rect.height / 4);
    return {
      x: side === "left" ? rect.left : rect.left + rect.width,
      y: clamp(centerY(rect) + laneOffset, rect.top + pad, rect.top + rect.height - pad),
    };
  }
  const pad = Math.min(CONNECTOR.sidePad, rect.width / 4);
  return {
    x: clamp(centerX(rect) + laneOffset, rect.left + pad, rect.left + rect.width - pad),
    y: side === "top" ? rect.top : rect.top + rect.height,
  };
}

function isHorizontal(side: Side): boolean {
  return side === "left" || side === "right";
}

/** The point a route reaches after its perpendicular straight run out of `side`. */
export function stubPointOf(anchor: Point, side: Side): Point {
  return {
    x: anchor.x + DIRECTION[side].x * CONNECTOR.stub,
    y: anchor.y + DIRECTION[side].y * CONNECTOR.stub,
  };
}

/** The corner sequence of one elbow route, anchors included. */
function elbowPoints(
  from: Rect,
  to: Rect,
  fromSide: Side,
  toSide: Side,
  a: Point,
  b: Point,
  lane: Lane,
): Point[] {
  const outA = DIRECTION[fromSide];
  const outB = DIRECTION[toSide];
  const stub = CONNECTOR.stub;
  const a2 = { x: a.x + outA.x * stub, y: a.y + outA.y * stub };
  const b2 = { x: b.x + outB.x * stub, y: b.y + outB.y * stub };

  if (isHorizontal(fromSide) !== isHorizontal(toSide)) {
    // Mixed sides need a single corner: turn at the target's own axis.
    const corner = isHorizontal(fromSide) ? { x: b2.x, y: a2.y } : { x: a2.x, y: b2.y };
    return [a, a2, corner, b2, b];
  }

  if (isHorizontal(fromSide)) {
    const facing = (b2.x - a2.x) * outA.x > 0;
    if (facing) {
      // Three segments through a shared vertical crossing line, lane-shifted so parallel arrows
      // don't stack their crossings on top of each other.
      const mid = (a2.x + b2.x) / 2 + lane.offset;
      return [a, a2, { x: mid, y: a2.y }, { x: mid, y: b2.y }, b2, b];
    }
    // The boxes face away from each other: go around, over whichever edge is nearer.
    const top = Math.min(from.top, to.top);
    const bottom = Math.max(from.top + from.height, to.top + to.height);
    const goUp = a.y - top <= bottom - a.y;
    const spread = stub + lane.rank * CONNECTOR.laneGap;
    const y = goUp ? top - spread : bottom + spread;
    return [a, a2, { x: a2.x, y }, { x: b2.x, y }, b2, b];
  }

  const facing = (b2.y - a2.y) * outA.y > 0;
  if (facing) {
    const mid = (a2.y + b2.y) / 2 + lane.offset;
    return [a, a2, { x: a2.x, y: mid }, { x: b2.x, y: mid }, b2, b];
  }
  const left = Math.min(from.left, to.left);
  const right = Math.max(from.left + from.width, to.left + to.width);
  const goLeft = a.x - left <= right - a.x;
  const spread = stub + lane.rank * CONNECTOR.laneGap;
  const x = goLeft ? left - spread : right + spread;
  return [a, a2, { x, y: a2.y }, { x, y: b2.y }, b2, b];
}

/** Drops duplicate and collinear corners, so a route that happens to be straight draws as one line
 * instead of carrying invisible zero-length elbows. */
export function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last && Math.abs(last.x - point.x) < EPSILON && Math.abs(last.y - point.y) < EPSILON) continue;
    result.push(point);
  }
  const pruned: Point[] = [];
  for (let index = 0; index < result.length; index += 1) {
    const previous = pruned[pruned.length - 1];
    const next = result[index + 1];
    if (previous && next) {
      const cross =
        (result[index].x - previous.x) * (next.y - previous.y) -
        (result[index].y - previous.y) * (next.x - previous.x);
      if (Math.abs(cross) < EPSILON) continue;
    }
    pruned.push(result[index]);
  }
  return pruned;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function towards(from: Point, to: Point, distance: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ratio = Math.min(distance / length, 1);
  return { x: from.x + dx * ratio, y: from.y + dy * ratio };
}

/** An SVG path through `points` with each corner rounded — the radius shrinks on short segments so a
 * tight elbow degrades gracefully instead of overshooting into the next one. */
export function roundedPath(points: readonly Point[], radius = CONNECTOR.corner): string {
  const path = simplify(points);
  if (path.length === 0) return "";
  let d = `M ${round(path[0].x)} ${round(path[0].y)}`;
  for (let index = 1; index < path.length - 1; index += 1) {
    const previous = path[index - 1];
    const corner = path[index];
    const next = path[index + 1];
    const limit = Math.min(
      radius,
      Math.hypot(corner.x - previous.x, corner.y - previous.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
    );
    const entry = towards(corner, previous, limit);
    const exit = towards(corner, next, limit);
    d += ` L ${round(entry.x)} ${round(entry.y)} Q ${round(corner.x)} ${round(corner.y)} ${round(exit.x)} ${round(exit.y)}`;
  }
  const end = path[path.length - 1];
  return path.length > 1 ? `${d} L ${round(end.x)} ${round(end.y)}` : d;
}

/** True when a point sits inside (or right on the border of) a rect — used to keep a caption off the
 * two boxes its own arrow touches. */
function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}

/** Midpoint of the longest segment whose midpoint clears `avoid` (the arrow's own two endpoint
 * boxes) — a caption there clears the elbows, the boxes' own text, and never sits on top of either
 * block the arrow connects. Falls back to the single longest segment if every one of them is blocked
 * (a degenerate, very short route), so this never regresses the common case. */
export function labelPointOf(points: readonly Point[], avoid: readonly Rect[] = []): Point {
  const path = simplify(points);
  if (path.length < 2) return path[0] ?? { x: 0, y: 0 };
  const segments = path.slice(0, -1).map((point, index) => {
    const next = path[index + 1];
    return {
      length: Math.hypot(next.x - point.x, next.y - point.y),
      mid: { x: round((point.x + next.x) / 2), y: round((point.y + next.y) / 2) },
    };
  });
  segments.sort((a, b) => b.length - a.length);
  const clear = segments.find((segment) => !avoid.some((rect) => pointInRect(segment.mid, rect)));
  return (clear ?? segments[0]).mid;
}

const NO_LANE: Lane = { offset: 0, rank: 0 };

/** Routes one arrow between two boxes the way a whiteboard tool does: it leaves and enters through a
 * point on each side — the side's midpoint by default, or shifted by `fromOffset`/`toOffset` when the
 * box's border is busy — at a right angle, turns in rounded elbows, and takes its own lane when other
 * arrows already join the same pair — so two relationships between two blocks read as two arrows. */
export function routeConnector(
  from: Rect,
  to: Rect,
  lane: Lane = NO_LANE,
  // Default to the pair-based lane offset, so a caller that only ever deals in pairs (routeConnector's
  // own tests, and any future direct caller) keeps shifting both ends together exactly as before.
  // `routeEdges` passes its own box+side port offsets explicitly, overriding this default.
  fromOffset: number = lane.offset,
  toOffset: number = lane.offset,
): Route {
  const [fromSide, toSide] = chooseSides(from, to);
  const a = anchorOf(from, fromSide, fromOffset);
  const b = anchorOf(to, toSide, toOffset);
  const points = elbowPoints(from, to, fromSide, toSide, a, b, lane);
  return { d: roundedPath(points), label: labelPointOf(points, [from, to]), points };
}
