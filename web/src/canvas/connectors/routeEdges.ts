import { createRouter } from "./obstacleRouter";
import {
  assignLanes,
  assignPorts,
  chooseSides,
  CONNECTOR,
  rectKeyOf,
  type Rect,
  type Route,
  type Side,
} from "./orthogonalRoute";

/** One port (an arrow endpoint on a specific box+side), carrying what `displacePorts` needs to spread
 * it and scatter the result back to its arrow. */
interface PortEndpoint {
  /** The exact box+side the port attaches to — `assignPorts`' grouping key. */
  key: string;
  /** The far box's centre along the spread axis (see `axisCentre`), for spatial ordering. */
  sort: number;
  /** Which arrow (index into the endpoints list) and which end of it this port belongs to. */
  edgeIndex: number;
  slot: "from" | "to";
}

/** One edge routed around the diagram's boxes, paired with the input item it was routed for. */
export interface RoutedEdge<T> {
  item: T;
  route: Route;
}

/** The aligned centre of `far` along the axis `side` runs: horizontal sides spread along y, vertical
 * along x. The side a box is left on tells us which axis the exit points spread along. */
function axisCentre(far: Rect, side: Side): number {
  return side === "left" || side === "right" ? far.top + far.height / 2 : far.left + far.width / 2;
}

/** One arrow-endpoint bundled with its grouping/spatial keys. `side` is the side this box is exited or
 * entered on; the sort value is the OTHER box's centre on the axis that side spreads along. */
function portEndpoint(
  rect: Rect,
  side: Side,
  far: Rect,
  edgeIndex: number,
  slot: "from" | "to",
  id?: string,
): PortEndpoint {
  // The grouping key prefers the caller's stable box id when one is available — subpixel drift in a
  // freshly-measured rect (two overlays measuring the same box a frame apart) must never split one
  // box+side into two groups that each fall back to their own centre point (arrows fusing at the
  // border). The rect-derived key remains the fallback for callers that only carry geometry.
  return { key: id ? `${id}|${side}` : `${rectKeyOf(rect)}|${side}`, sort: axisCentre(far, side), edgeIndex, slot };
}

/** Distributes every arrow endpoint across its box+side group, delegating the symmetric spread to
 * `assignPorts` and scattering each offset back onto its own arrow's from/to slot. The whole pool of
 * from AND to endpoints is sorted once by (key, far-centre) so each group's ports land in spatial
 * order before `assignPorts` ranks them — that spatial sort is the only thing `assignPorts` doesn't
 * already do, so the count/offset math lives in exactly one place. */
function displacePorts(endpoints: readonly PortEndpoint[]): { from: number[]; to: number[] } {
  // Sort primarily by group, secondarily by far-centre within it: group order is irrelevant to
  // `assignPorts` (each key ranks independently), but spatial order within a group is what stops two
  // arrows on a busy side from crossing.
  const sorted = [...endpoints].sort(
    (a, b) => (a.key === b.key ? a.sort - b.sort : a.key < b.key ? -1 : 1),
  );
  const offsets = assignPorts(sorted.map((endpoint) => endpoint.key), CONNECTOR.portGap);
  const from: number[] = [];
  const to: number[] = [];
  sorted.forEach((endpoint, index) => {
    if (endpoint.slot === "from") from[endpoint.edgeIndex] = offsets[index];
    else to[endpoint.edgeIndex] = offsets[index];
  });
  return { from, to };
}

/**
 * The lanes → router → map idiom every connection layer repeats: lanes are assigned across EVERY
 * item at once (two relationships between the same two boxes leave from different points instead of
 * collapsing onto one stroke), then one obstacle-aware router routes them in input order, so its
 * corridor bookkeeping is deterministic. An item whose endpoints can't be resolved (`endpointsOf`
 * returns null) is skipped but still consumed a lane — exactly what the per-view copies did by
 * assigning lanes before their flatMap filter.
 *
 * Lanes alone only spread arrows that join the *same pair* of boxes. A box's border still funnels
 * every other arrow through one exact point (its side's midpoint), so unrelated arrows into the same
 * side of a busy box collide there. `displacePorts`, grouped by the exact box+side each endpoint
 * resolves to via `chooseSides`, spreads those too — independently at each end, since which box is on
 * the other side of the arrow has nothing to do with where either endpoint sits on its own border.
 */
export interface RoutedEndpoints {
  from: Rect;
  to: Rect;
  /** Stable ids for the two boxes, when the caller knows them — keep port grouping keyed to the box
   * (not its freshly-measured geometry) so subpixel rect drift never fuses two arrows into one point.
   * Optional: a geometry-only caller (tests, plain two-body routing) omits it and falls back to the
   * rect-derived key. */
  fromId?: string;
  toId?: string;
}

export function routeEdges<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  endpointsOf: (item: T) => RoutedEndpoints | null,
  obstacles: readonly Rect[],
): RoutedEdge<T>[] {
  const lanes = assignLanes(items, keyOf);
  const ends = items.map(endpointsOf);
  // An unresolved item contributes no key to either group, keeping it out of everyone else's count.
  // Each endpoint records the far box's centre along the axis its exit side lies in, so sorting each
  // group by it makes the pool-assigned exit points rise monotonically with the direction the arrow
  // turns — a left-pointing arrow exits from the left, a right-pointing one from the right, so two
  // arrows out of one busy side order by target instead of by input order and stop crossing.
  // Distribute ports across ONE pool that mixes both directions of every arrow, so an arrow exiting a
  // box's side and an arrow entering that same side count against each other — before this, the from-
  // ports and to-ports were spread in two separate pools, and an exit + an enter on the same side of
  // the same box each saw itself as the only port there, so both landed on the side's midpoint and
  // fused into one point (the "one arrow out, one arrow in, both on the same edge" case). Each port
  // records its own arrow's index/slot, so an unresolved edge (null here) can't skew which arrow a
  // port offset later belongs to.
  const ports = ends.flatMap((endpoint, index) => {
    if (!endpoint) return [];
    const [fromSide, toSide] = chooseSides(endpoint.from, endpoint.to);
    return [
      portEndpoint(endpoint.from, fromSide, endpoint.to, index, "from", endpoint.fromId),
      portEndpoint(endpoint.to, toSide, endpoint.from, index, "to", endpoint.toId),
    ];
  });
  const { from: fromPorts, to: toPorts } = displacePorts(ports);
  const route = createRouter({ obstacles: [...obstacles] });
  return items.flatMap((item, index) => {
    const endpoint = ends[index];
    if (!endpoint) return [];
    return [
      {
        item,
        route: route(endpoint.from, endpoint.to, lanes[index], fromPorts[index], toPorts[index]),
      },
    ];
  });
}
