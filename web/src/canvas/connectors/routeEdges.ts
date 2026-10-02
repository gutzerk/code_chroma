import { createRouter } from "./obstacleRouter";
import {
  assignLanes,
  assignPorts,
  chooseSides,
  rectKeyOf,
  type Rect,
  type Route,
  type Side,
} from "./orthogonalRoute";

interface PortEndpoint {
  /** The exact box+side the arrow attaches to — the `assignPorts` grouping key. */
  key: string;
  /** The far box's centre along the axis the exit side lies in, for spatial ordering. */
  sort: number;
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

/** One arrow-endpoint bundled with its spatial sort key. `side` is the side this box is exited or
 * entered on; the sort value is the OTHER box's centre on the axis that side spreads along. */
function portEndpoint(rect: Rect, side: Side, far: Rect): PortEndpoint {
  return { key: `${rectKeyOf(rect)}|${side}`, sort: axisCentre(far, side) };
}

/** Spreads each endpoint-group's exit points along its side in spatial (not input) order: present
 * endpoints are sorted by their far-box centre before `assignPorts`, whose rank is index order, then
 * each sorted offset is scattered back to its original index so the rest of routing stays in input
 * order. Sorting is stable, so endpoints sharing a box+side and sort value keep their input order. */
function spreadPorts(portEnds: readonly (PortEndpoint | undefined)[]): number[] {
  const present = portEnds
    .map((endpoint, index) => ({ endpoint, index }))
    .filter((entry): entry is { endpoint: PortEndpoint; index: number } => entry.endpoint !== undefined)
    .sort((a, b) => a.endpoint.sort - b.endpoint.sort);
  const offsets = assignPorts(present.map((entry) => entry.endpoint.key));
  const result = new Array<number>(portEnds.length).fill(0);
  present.forEach((entry, rank) => {
    result[entry.index] = offsets[rank];
  });
  return result;
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
 * side of a busy box collide there. `assignPorts`, grouped by the exact box+side each endpoint
 * resolves to via `chooseSides`, spreads those too — independently at each end, since which box is on
 * the other side of the arrow has nothing to do with where either endpoint sits on its own border.
 */
export function routeEdges<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  endpointsOf: (item: T) => { from: Rect; to: Rect } | null,
  obstacles: readonly Rect[],
): RoutedEdge<T>[] {
  const lanes = assignLanes(items, keyOf);
  const ends = items.map(endpointsOf);
  // An unresolved item contributes no key to either group, keeping it out of everyone else's count.
  // Each endpoint records the far box's centre along the axis its exit side lies in, so sorting each
  // group by it makes the pool-assigned exit points rise monotonically with the direction the arrow
  // turns — a left-pointing arrow exits from the left, a right-pointing one from the right, so two
  // arrows out of one busy side order by target instead of by input order and stop crossing.
  const portEnds = ends.map((endpoint) => {
    if (!endpoint) return null;
    const [fromSide, toSide] = chooseSides(endpoint.from, endpoint.to);
    return {
      from: portEndpoint(endpoint.from, fromSide, endpoint.to),
      to: portEndpoint(endpoint.to, toSide, endpoint.from),
    };
  });
  const fromPorts = spreadPorts(portEnds.map((keys) => keys?.from));
  const toPorts = spreadPorts(portEnds.map((keys) => keys?.to));
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
