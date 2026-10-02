import {
  anchorOf,
  chooseSides,
  labelPointOf,
  rectKeyOf,
  roundedPath,
  routeConnector,
  simplify,
  stubPointOf,
  type Lane,
  type Point,
  type Rect,
  type Route,
  type Side,
} from "./orthogonalRoute";

/** Gap kept between a route and any box it is not attached to. */
const CLEARANCE = 14;

/** Added per direction change, in the same units as path length. High enough that the router
 * prefers one long detour over a staircase of short ones, low enough that it will still turn to get
 * out of the way of a box. */
const TURN_PENALTY = 30;

/** Added for reusing a grid segment an earlier arrow in this same pass already claimed. This is what
 * keeps two unrelated arrows off the same corridor — the pair-scoped `assignLanes` in
 * orthogonalRoute.ts cannot, since it only ever compares arrows joining the SAME two boxes.
 *
 * Must comfortably exceed the cost of stepping onto a neighbouring free lane instead. Stepping one
 * lane over is two turns (TURN_PENALTY each) plus two short lateral runs — cheaper than 40, which is
 * why 40 left a second clean arrow drawing on the first one's exact stroke. 150 makes the detour the
 * cheaper choice; the only cost is a genuinely saturated diagram paying a little more to route. */
const REUSE_PENALTY = 150;

/** How far beyond the two endpoint boxes a route is allowed to detour on its first attempt. Keeping
 * the search local is the whole performance story: a global grid over N boxes is O(N^2) cells, while
 * the region around one arrow's two endpoints usually holds a handful. */
const DETOUR_MARGIN = 180;

/** Multiplier for the one retry with a wider search region, before giving up to routeConnector. */
const WIDE_RETRY = 3;

/** Above this many boxes the whole feature degrades to plain two-body routing. A canvas this dense
 * is unreadable for reasons no router can fix, and the per-arrow search is not worth its cost. */
const MAX_OBSTACLES = 120;

/** Per-axis cap on grid lines, so a pathological cluster of boxes cannot blow the search up. Grid
 * cost is quadratic in this, and a drag re-routes every arrow each frame, so it is deliberately
 * tight: 48 lines per axis is already far more detour options than a readable diagram needs. */
const MAX_LINES_PER_AXIS = 48;

const EPSILON = 0.01;

/** One corridor an already-routed arrow occupies, remembered so the next arrow can be charged
 * REUSE_PENALTY for overlapping it. Stored as a span rather than an exact segment because arrows
 * routed on different local grids rarely share endpoints but very often share a stretch of lane. */
interface Corridor {
  horizontal: boolean;
  /** The coordinate the corridor sits at: y for a horizontal run, x for a vertical one. */
  fixed: number;
  lo: number;
  hi: number;
}

export type Router = (from: Rect, to: Rect, lane?: Lane, fromOffset?: number, toOffset?: number) => Route;

export interface RouterOptions {
  /** Every box on the canvas, in the same coordinate space as the rects passed to the router. */
  obstacles: readonly Rect[];
  /** Gap kept between a route and a box. Defaults to CLEARANCE. */
  clearance?: number;
}

interface Obstacle {
  /** The box as laid out — used for the "is this one of my own endpoints" test. */
  raw: Rect;
  /** The same box grown by `clearance` — what routes actually steer around. */
  padded: Rect;
}

function right(rect: Rect): number {
  return rect.left + rect.width;
}

function bottom(rect: Rect): number {
  return rect.top + rect.height;
}

function inflate(rect: Rect, by: number): Rect {
  return {
    left: rect.left - by,
    top: rect.top - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  };
}

/** Generous containment — an anchor sits exactly ON its own box's edge, and must still count as
 * inside it, or the nesting skip rule below would never fire. */
function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.left - EPSILON &&
    point.x <= right(rect) + EPSILON &&
    point.y >= rect.top - EPSILON &&
    point.y <= bottom(rect) + EPSILON
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < right(b) && b.left < right(a) && a.top < bottom(b) && b.top < bottom(a);
}

/** Unit vector from an anchor to its stub point — the axis the route leaves the box on. */
function stubDirectionOf(anchor: Point, stub: Point): Point {
  return { x: Math.sign(stub.x - anchor.x), y: Math.sign(stub.y - anchor.y) };
}

function sameRect(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.left - b.left) < EPSILON &&
    Math.abs(a.top - b.top) < EPSILON &&
    Math.abs(a.width - b.width) < EPSILON &&
    Math.abs(a.height - b.height) < EPSILON
  );
}

/** How far outside a box a route must stay before it counts as "clear" of it. Smaller than
 * CLEARANCE on purpose: a line grazing a box is ugly but still readable, and rerouting for it would
 * churn geometry that is currently fine. */
const CROSSING_MARGIN = 4;

/** True when the polyline runs through a box it is not attached to — the one thing worth rerouting
 * for. Both segments and boxes are axis-aligned, so a rect-vs-rect overlap is an exact test. */
function crossesAnyBox(points: readonly Point[], candidates: readonly Rect[]): boolean {
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const segment: Rect = {
      left: Math.min(a.x, b.x),
      top: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
    if (candidates.some((box) => overlaps(segment, box))) return true;
  }
  return false;
}

/** Sorted, deduped coordinate lines, with the midpoint of each adjacent pair added so parallel
 * arrows have a spare lane to move to when REUSE_PENALTY pushes them apart. */
function axisLines(values: readonly number[]): number[] {
  const sorted = [...new Set(values.map((value) => Math.round(value * 100) / 100))].sort(
    (a, b) => a - b,
  );
  const withMidpoints: number[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    withMidpoints.push(sorted[index]);
    if (index + 1 < sorted.length) withMidpoints.push((sorted[index] + sorted[index + 1]) / 2);
  }
  if (withMidpoints.length <= MAX_LINES_PER_AXIS) return withMidpoints;
  // Over the cap, drop the midpoints first — they are the optional half.
  return sorted.slice(0, MAX_LINES_PER_AXIS);
}

function indexOfNearest(values: readonly number[], target: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const distance = Math.abs(values[index] - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/** Binary min-heap over (priority, insertion order), so equal-cost states pop in a fixed order and
 * the same input always yields byte-identical geometry. */
class Heap {
  private readonly items: { cost: number; seq: number; state: number }[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(state: number, cost: number): void {
    this.items.push({ cost, seq: this.seq, state });
    this.seq += 1;
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.less(index, parent)) {
        this.swap(index, parent);
        index = parent;
      } else break;
    }
  }

  pop(): number {
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const rightChild = left + 1;
        let smallest = index;
        if (left < this.items.length && this.less(left, smallest)) smallest = left;
        if (rightChild < this.items.length && this.less(rightChild, smallest)) smallest = rightChild;
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }
    return top.state;
  }

  private less(a: number, b: number): boolean {
    if (this.items[a].cost !== this.items[b].cost) return this.items[a].cost < this.items[b].cost;
    return this.items[a].seq < this.items[b].seq;
  }

  private swap(a: number, b: number): void {
    const temp = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = temp;
  }
}

const HORIZONTAL = 0;
const VERTICAL = 1;

/** The per-segment cost of leaving a grid intersection, precomputed so A*'s inner loop is pure array
 * indexing. Building these once per arrow instead of testing every obstacle (and rebuilding a string
 * key) inside the loop is the difference between ~150ms and ~10ms for a 60-box, 200-arrow diagram. */
interface Grid {
  xs: number[];
  ys: number[];
  /** Cost of the segment xs[i]..xs[i+1] at ys[j], or Infinity when a box blocks it. */
  horizontalCost: Float64Array;
  /** Cost of the segment ys[j]..ys[j+1] at xs[i]. */
  verticalCost: Float64Array;
}

/** First and last index whose value lies strictly inside (lo, hi); `to` is exclusive. */
function spanWithin(values: readonly number[], lo: number, hi: number): [number, number] {
  let from = 0;
  while (from < values.length && values[from] <= lo + EPSILON) from += 1;
  let to = from;
  while (to < values.length && values[to] < hi - EPSILON) to += 1;
  return [from, to];
}

function buildGrid(
  xs: number[],
  ys: number[],
  obstacles: readonly Obstacle[],
  corridors: readonly Corridor[],
): Grid {
  const nx = xs.length;
  const ny = ys.length;
  const xMid = xs.slice(0, -1).map((value, index) => (value + xs[index + 1]) / 2);
  const yMid = ys.slice(0, -1).map((value, index) => (value + ys[index + 1]) / 2);

  const horizontalCost = new Float64Array((nx - 1) * ny);
  const verticalCost = new Float64Array(nx * (ny - 1));
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i + 1 < nx; i += 1) horizontalCost[j * (nx - 1) + i] = xs[i + 1] - xs[i];
  }
  for (let j = 0; j + 1 < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) verticalCost[j * nx + i] = ys[j + 1] - ys[j];
  }

  // A box blocks exactly the segments whose midpoint falls strictly inside it. Because every grid
  // line comes from some box's padded edge, a midpoint is never ambiguously "on" a boundary — so
  // marking the index ranges the box spans is an exact test, not an approximation.
  for (const { padded } of obstacles) {
    const [xFrom, xTo] = spanWithin(xMid, padded.left, padded.left + padded.width);
    const [yFrom, yTo] = spanWithin(ys, padded.top, padded.top + padded.height);
    for (let j = yFrom; j < yTo; j += 1) {
      for (let i = xFrom; i < xTo; i += 1) horizontalCost[j * (nx - 1) + i] = Infinity;
    }
    const [xFrom2, xTo2] = spanWithin(xs, padded.left, padded.left + padded.width);
    const [yFrom2, yTo2] = spanWithin(yMid, padded.top, padded.top + padded.height);
    for (let j = yFrom2; j < yTo2; j += 1) {
      for (let i = xFrom2; i < xTo2; i += 1) verticalCost[j * nx + i] = Infinity;
    }
  }

  // Corridors an earlier arrow already claimed get surcharged rather than blocked — a busy diagram
  // must still be routable when every lane is taken.
  for (const corridor of corridors) {
    if (corridor.horizontal) {
      const j = ys.findIndex((value) => Math.abs(value - corridor.fixed) < EPSILON);
      if (j < 0) continue;
      const [from, to] = spanWithin(xMid, corridor.lo, corridor.hi);
      for (let i = from; i < to; i += 1) horizontalCost[j * (nx - 1) + i] += REUSE_PENALTY;
    } else {
      const i = xs.findIndex((value) => Math.abs(value - corridor.fixed) < EPSILON);
      if (i < 0) continue;
      const [from, to] = spanWithin(yMid, corridor.lo, corridor.hi);
      for (let j = from; j < to; j += 1) verticalCost[j * nx + i] += REUSE_PENALTY;
    }
  }

  return { xs, ys, horizontalCost, verticalCost };
}

/** A* over the visibility grid between two stub points, or null when no orthogonal path exists. */
function searchGrid(
  grid: Grid,
  start: Point,
  goal: Point,
  /** Unit vector of the straight run out of the source box: the route may not immediately undo it. */
  stubDirection: Point,
): Point[] | null {
  const { xs, ys, horizontalCost, verticalCost } = grid;
  const startAxis = stubDirection.x !== 0 ? HORIZONTAL : VERTICAL;
  const nx = xs.length;
  const ny = ys.length;
  const startX = indexOfNearest(xs, start.x);
  const startY = indexOfNearest(ys, start.y);
  const goalX = indexOfNearest(xs, goal.x);
  const goalY = indexOfNearest(ys, goal.y);

  // A state is (cell, incoming axis); the axis is part of the state because the cost of leaving a
  // cell depends on how the route arrived at it — without it, turn penalties are unaccountable.
  const stateCount = nx * ny * 2;
  const best = new Float64Array(stateCount).fill(Infinity);
  const cameFrom = new Int32Array(stateCount).fill(-1);
  const stateOf = (x: number, y: number, axis: number) => (y * nx + x) * 2 + axis;

  const heuristic = (x: number, y: number) =>
    Math.abs(xs[x] - xs[goalX]) + Math.abs(ys[y] - ys[goalY]);

  const open = new Heap();
  const startState = stateOf(startX, startY, startAxis);
  best[startState] = 0;
  open.push(startState, heuristic(startX, startY));

  let goalState = -1;
  while (open.size > 0) {
    const state = open.pop();
    const cell = state >> 1;
    const axis = state & 1;
    const x = cell % nx;
    const y = (cell - x) / nx;
    if (x === goalX && y === goalY) {
      goalState = state;
      break;
    }
    const cost = best[state];

    for (let move = 0; move < 4; move += 1) {
      const dx = move === 0 ? 1 : move === 1 ? -1 : 0;
      const dy = move === 2 ? 1 : move === 3 ? -1 : 0;
      // Doubling straight back over the stub would draw a spike out of the source box and back in.
      if (state === startState && dx === -stubDirection.x && dy === -stubDirection.y) continue;
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextX >= nx || nextY < 0 || nextY >= ny) continue;

      const nextAxis = dx !== 0 ? HORIZONTAL : VERTICAL;
      const step =
        dx !== 0
          ? horizontalCost[y * (nx - 1) + Math.min(x, nextX)]
          : verticalCost[Math.min(y, nextY) * nx + x];
      if (!Number.isFinite(step)) continue;

      const nextCost = cost + step + (nextAxis === axis ? 0 : TURN_PENALTY);
      const nextState = stateOf(nextX, nextY, nextAxis);
      if (nextCost >= best[nextState]) continue;
      best[nextState] = nextCost;
      cameFrom[nextState] = state;
      open.push(nextState, nextCost + heuristic(nextX, nextY));
    }
  }

  if (goalState < 0) return null;

  const points: Point[] = [];
  for (let state = goalState; state >= 0; state = cameFrom[state]) {
    const cell = state >> 1;
    const x = cell % nx;
    points.push({ x: xs[x], y: ys[(cell - x) / nx] });
  }
  return points.reverse();
}

/** The corridors a finished route occupies, one per straight run. */
function corridorsOf(points: readonly Point[]): Corridor[] {
  const corridors: Corridor[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (Math.abs(a.y - b.y) < EPSILON && Math.abs(a.x - b.x) >= EPSILON) {
      corridors.push({ horizontal: true, fixed: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    } else if (Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) >= EPSILON) {
      corridors.push({ horizontal: false, fixed: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }
  }
  return corridors;
}

/** Whether a corridor could possibly touch this arrow's search region — a cheap reject that keeps
 * the surcharge pass proportional to nearby traffic rather than to every arrow routed so far. */
function corridorNearRegion(corridor: Corridor, region: Rect): boolean {
  return corridor.horizontal
    ? corridor.fixed >= region.top &&
        corridor.fixed <= bottom(region) &&
        corridor.lo <= right(region) &&
        corridor.hi >= region.left
    : corridor.fixed >= region.left &&
        corridor.fixed <= right(region) &&
        corridor.lo <= bottom(region) &&
        corridor.hi >= region.top;
}

/**
 * An orthogonal router that steers around every box on the canvas, not just the two an arrow joins.
 *
 * `routeConnector` in orthogonalRoute.ts is a pure function of two rects, so a line runs straight
 * through whatever happens to sit between its endpoints — the single biggest reason a dense Patterns
 * or C1 diagram is unreadable. This wraps it: each arrow gets an A* search over a visibility grid
 * built from the boxes near it, and falls back to `routeConnector` whenever that search cannot help.
 *
 * 🔴 **The nesting skip rule is load-bearing, not an optimization.** An obstacle that contains
 * either endpoint's anchor is dropped for that one route. Without it the hierarchy view could not
 * use this at all: its blocks are nested DOM, so a parent box always contains its own child's
 * anchor, and every route out of a nested block would start already trapped inside an obstacle.
 * It is also what lets an arrow leave its own box — an anchor sits exactly on its box's edge, well
 * inside the padded rect.
 *
 * The returned router is stateful across calls *by design*: it remembers which grid segments earlier
 * arrows claimed and charges REUSE_PENALTY for reusing one, which is what pushes parallel arrows
 * onto separate corridors. Build one per layout pass, call it for every edge in a stable order, and
 * throw it away — reusing one across passes would keep penalising corridors nobody occupies any more.
 */
export function createRouter({ obstacles, clearance = CLEARANCE }: RouterOptions): Router {
  // The DOM-measured overlays hand in one rect per edge endpoint, so the same block arrives once per
  // arrow touching it. Deduping here rather than at each call site keeps a well-connected block from
  // eating the MAX_OBSTACLES budget several times over and silently switching the router off.
  const unique = [...new Map(obstacles.map((rect) => [rectKeyOf(rect), rect])).values()];
  if (unique.length === 0 || unique.length > MAX_OBSTACLES) {
    return (from, to, lane, fromOffset, toOffset) => routeConnector(from, to, lane, fromOffset, toOffset);
  }

  const padded: Obstacle[] = unique.map((raw) => ({ raw, padded: inflate(raw, clearance) }));
  const claimed: Corridor[] = [];

  /** Boxes this particular arrow must avoid: not its own two endpoints, and — the nesting skip rule
   * — not any box that contains an endpoint's anchor either. */
  function blockersFor(from: Rect, to: Rect, a: Point, b: Point): Obstacle[] {
    return padded.flatMap((obstacle) => {
      if (sameRect(obstacle.raw, from) || sameRect(obstacle.raw, to)) {
        // The arrow's own boxes stay blockers, but only at their real footprint shrunk just off
        // their own anchors — otherwise a route could double back straight through the box it left.
        return [{ raw: obstacle.raw, padded: inflate(obstacle.raw, -EPSILON * 2) }];
      }
      if (contains(obstacle.raw, a) || contains(obstacle.raw, b)) return [];
      return [obstacle];
    });
  }

  // Build the final polyline and claim the corridors it occupies. Both the A* path and the plain
  // direct route converge here, so a direct arrow reserves its lane too — otherwise the next,
  // geometrically-identical arrow from a *different* pair would draw on top of it, and only ever
  // separated when one of them rerouted around an actual box.
  function finish(points: readonly Point[], from: Rect, to: Rect): Route {
    const simplified = simplify(points);
    claimed.push(...corridorsOf(simplified));
    return { d: roundedPath(simplified), label: labelPointOf(simplified, [from, to]), points: simplified };
  }

  // True when this direct polyline runs along a corridor an earlier arrow already claimed — the
  // arrow-on-arrow sibling of crossesAnyBox. Crossing a box is what reroutes an arrow today; without
  // a same-axis, same-coordinate span overlap here, two clear arrows from different pairs that share
  // a straight run would keep drawing as one stroke, because nothing ever made either of them turn.
  function overlapsAnyCorridor(points: readonly Point[], from: Rect, to: Rect): boolean {
    // Only the reachable extent between the arrow's two boxes matters: a corridor trailing past the
    // arrow's far box, or an elbow that bends around one of them, is not a shared stroke with it.
    const spanLo = Math.min(from.left, to.left, from.top, to.top);
    const spanHi = Math.max(right(from), right(to), bottom(from), bottom(to));
    return corridorsOf(points).some((mine) =>
      claimed.some(
        (theirs) =>
          mine.horizontal === theirs.horizontal &&
          Math.abs(mine.fixed - theirs.fixed) < EPSILON &&
          // A real shared span, not a neighbour grazing a corner.
          mine.lo < Math.min(theirs.hi, spanHi) - EPSILON &&
          Math.max(theirs.lo, spanLo) < mine.hi - EPSILON,
      ),
    );
  }

  function attempt(
    from: Rect,
    to: Rect,
    fromSide: Side,
    toSide: Side,
    a: Point,
    b: Point,
    blockers: readonly Obstacle[],
    margin: number,
  ): Route | null {
    const a2 = stubPointOf(a, fromSide);
    const b2 = stubPointOf(b, toSide);

    const region: Rect = inflate(
      {
        left: Math.min(from.left, to.left),
        top: Math.min(from.top, to.top),
        width: Math.max(right(from), right(to)) - Math.min(from.left, to.left),
        height: Math.max(bottom(from), bottom(to)) - Math.min(from.top, to.top),
      },
      margin,
    );

    // Locality filter on top of the blocker rules: only boxes near this arrow can affect it, and
    // keeping the grid local is what makes the search affordable per edge.
    const active = blockers.filter((obstacle) => overlaps(obstacle.padded, region));

    const xs = axisLines([
      ...active.flatMap((obstacle) => [obstacle.padded.left, right(obstacle.padded)]),
      a.x,
      a2.x,
      b.x,
      b2.x,
      region.left,
      right(region),
    ]);
    const ys = axisLines([
      ...active.flatMap((obstacle) => [obstacle.padded.top, bottom(obstacle.padded)]),
      a.y,
      a2.y,
      b.y,
      b2.y,
      region.top,
      bottom(region),
    ]);

    const grid = buildGrid(
      xs,
      ys,
      active,
      claimed.filter((corridor) => corridorNearRegion(corridor, region)),
    );
    const path = searchGrid(grid, a2, b2, stubDirectionOf(a, a2));
    if (!path) return null;

    // A* lands on the grid line nearest a2/b2, which may be a hair off; pinning the real stub points
    // at both ends keeps the arrow attached to its anchor and its arrowhead perpendicular. finish()
    // claims the corridors this route occupies, so a later arrow steers off it.
    return finish([a, a2, ...path, b2, b], from, to);
  }

  return (from, to, lane, fromOffset = lane?.offset ?? 0, toOffset = lane?.offset ?? 0) => {
    const direct = routeConnector(from, to, lane, fromOffset, toOffset);
    const [fromSide, toSide] = chooseSides(from, to);
    const a = anchorOf(from, fromSide, fromOffset);
    const b = anchorOf(to, toSide, toOffset);
    // Computed once and reused below: it depends only on from/to/a/b, not on the search margin, so
    // recomputing it per attempt would just repeat the same O(obstacles) scan for no new information.
    const blockers = blockersFor(from, to, a, b);

    // Only reroute an arrow that actually runs through something. Leaving clear arrows on the
    // existing two-body geometry keeps the common case identical to before this router existed —
    // no churn, and every routeConnector test still describes what those arrows do. It still claims
    // its lane via finish(), so later arrows steer off it rather than stacking on top.
    const inTheWay = blockers
      .filter((obstacle) => !sameRect(obstacle.raw, from) && !sameRect(obstacle.raw, to))
      .map((obstacle) => inflate(obstacle.raw, CROSSING_MARGIN));
    // Reroute when the arrow crosses a box OR runs along a corridor an earlier arrow already claimed.
    const mustReroute =
      crossesAnyBox(direct.points, inTheWay) ||
      overlapsAnyCorridor(direct.points, from, to);
    if (!mustReroute) return finish(direct.points, from, to);

    return (
      attempt(from, to, fromSide, toSide, a, b, blockers, DETOUR_MARGIN) ??
      attempt(from, to, fromSide, toSide, a, b, blockers, DETOUR_MARGIN * WIDE_RETRY) ??
      finish(direct.points, from, to)
    );
  };
}
