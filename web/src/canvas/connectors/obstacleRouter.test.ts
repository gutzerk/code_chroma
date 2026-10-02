import { describe, expect, it } from "vitest";
import { createRouter } from "./obstacleRouter";
import { routeConnector, type Point, type Rect } from "./orthogonalRoute";

function rect(left: number, top: number, width = 100, height = 60): Rect {
  return { left, top, width, height };
}

/** True when any segment of the polyline runs through `box`. Written independently of the router's
 * own crossing test on purpose — a shared helper would let one bug hide the other. */
function passesThrough(points: readonly Point[], box: Rect): boolean {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  return points.slice(0, -1).some((a, index) => {
    const b = points[index + 1];
    const [loX, hiX] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [loY, hiY] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    return loX < right && box.left < hiX && loY < bottom && box.top < hiY;
  });
}

describe("createRouter", () => {
  it("routes around a box sitting between the two endpoints", () => {
    const from = rect(0, 0);
    const to = rect(0, 400);
    const blocker = rect(-20, 190, 140, 60);
    const route = createRouter({ obstacles: [from, to, blocker] })(from, to);

    expect(passesThrough(route.points, blocker)).toBe(false);
  });

  it("leaves a clear arrow on the plain two-body geometry", () => {
    const from = rect(0, 0);
    const to = rect(0, 400);
    const elsewhere = rect(600, 600);
    const route = createRouter({ obstacles: [from, to, elsewhere] })(from, to);

    expect(route.d).toBe(routeConnector(from, to).d);
  });

  it("ignores a box that contains an endpoint anchor, so nested blocks stay routable", () => {
    const child = rect(50, 50, 60, 40);
    const parent = rect(0, 0, 300, 300);
    const target = rect(50, 500, 60, 40);
    const route = createRouter({ obstacles: [child, parent, target] })(child, target);

    // The parent wraps the source; treating it as an obstacle would trap the arrow inside it.
    expect(route.points.length).toBeGreaterThan(1);
    expect(route.d).not.toBe("");
  });

  it("never doubles back through the box it just left", () => {
    const from = rect(0, 0);
    const to = rect(0, 400);
    const blocker = rect(-20, 190, 140, 60);
    const route = createRouter({ obstacles: [from, to, blocker] })(from, to);

    expect(passesThrough(route.points, from)).toBe(false);
    expect(passesThrough(route.points, to)).toBe(false);
  });

  it("pins both ends to the same anchors routeConnector would use", () => {
    const from = rect(0, 0);
    const to = rect(0, 400);
    const blocker = rect(-20, 190, 140, 60);
    const direct = routeConnector(from, to);
    const route = createRouter({ obstacles: [from, to, blocker] })(from, to);

    expect(route.points[0]).toEqual(direct.points[0]);
    expect(route.points[route.points.length - 1]).toEqual(direct.points[direct.points.length - 1]);
  });

  it("keeps every segment axis-aligned", () => {
    const from = rect(0, 0);
    const to = rect(300, 400);
    const blocker = rect(100, 190, 140, 60);
    const route = createRouter({ obstacles: [from, to, blocker] })(from, to);

    const diagonal = route.points
      .slice(0, -1)
      .some((a, index) => a.x !== route.points[index + 1].x && a.y !== route.points[index + 1].y);
    expect(diagonal).toBe(false);
  });

  it("pushes a second arrow off the corridor the first one claimed", () => {
    const a = rect(0, 0);
    const b = rect(0, 400);
    const c = rect(200, 0);
    const d = rect(200, 400);
    const blockerAB = rect(-20, 190, 140, 60);
    const blockerCD = rect(180, 190, 140, 60);
    const router = createRouter({ obstacles: [a, b, c, d, blockerAB, blockerCD] });

    const first = router(a, b);
    const second = router(c, d);
    expect(first.d).not.toBe(second.d);
  });

  it("separates a later clean arrow from the exact lane an earlier one claimed", () => {
    // Same two boxes twice: the first arrow reserves its straight corridor; the second, routed after
    // it, must step to a neighbouring lane instead of drawing on top of the first stroke. The pair
    // being identical is deliberate — it is the hardest case, since nothing but the reserved
    // corridor (no box, no different geometry) can possibly tell the two arrows apart.
    const a = rect(0, 0);
    const b = rect(400, 0);
    const router = createRouter({ obstacles: [a, b] });

    const first = router(a, b);
    const second = router(a, b);

    expect(second.d).not.toBe(first.d);
    // The second arrow carries an extra bend onto a separate lane rather than folding diagonally.
    expect(second.points.length).toBeGreaterThan(first.points.length);
  });

  it("degrades to plain routing above the obstacle cap", () => {
    const from = rect(0, 0);
    const to = rect(0, 400);
    const many = Array.from({ length: 200 }, (_, index) => rect(index * 10, 190, 8, 60));
    const route = createRouter({ obstacles: [from, to, ...many] })(from, to);

    expect(route.d).toBe(routeConnector(from, to).d);
  });

  it("dedupes repeated rects, so a well-connected box does not eat the obstacle cap", () => {
    const from = rect(0, 0);
    const to = rect(0, 400);
    const blocker = rect(-20, 190, 140, 60);
    // The DOM overlays pass one rect per edge endpoint; the same box arrives many times over.
    const repeated = Array.from({ length: 200 }, () => blocker);
    const route = createRouter({ obstacles: [from, to, ...repeated] })(from, to);

    expect(passesThrough(route.points, blocker)).toBe(false);
  });

  it("degrades to plain routing when given no obstacles at all", () => {
    const from = rect(0, 0);
    const to = rect(0, 400);
    const route = createRouter({ obstacles: [] })(from, to);

    expect(route.d).toBe(routeConnector(from, to).d);
  });

  it("is deterministic — same input, byte-identical path", () => {
    const from = rect(0, 0);
    const to = rect(0, 400);
    const blocker = rect(-20, 190, 140, 60);
    const obstacles = [from, to, blocker];

    const first = createRouter({ obstacles })(from, to);
    const second = createRouter({ obstacles })(from, to);
    expect(first.d).toBe(second.d);
  });

  it("puts the caption on the routed path, not the direct one", () => {
    const from = rect(0, 0);
    const to = rect(0, 400);
    const blocker = rect(-20, 190, 140, 60);
    const route = createRouter({ obstacles: [from, to, blocker] })(from, to);

    expect(route.label).not.toEqual(routeConnector(from, to).label);
  });

  it("falls back to the direct route rather than failing when a box is walled in", () => {
    const from = rect(0, 0, 40, 40);
    const walls = [
      rect(-60, -60, 160, 50),
      rect(-60, 50, 160, 50),
      rect(-60, -60, 50, 160),
      rect(50, -60, 50, 160),
    ];
    const to = rect(0, 600, 40, 40);
    const route = createRouter({ obstacles: [from, to, ...walls] })(from, to);

    expect(route.d).not.toBe("");
  });
});
