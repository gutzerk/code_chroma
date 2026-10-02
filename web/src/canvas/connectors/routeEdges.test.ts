import { describe, expect, it } from "vitest";
import { pairKeyOf, type Rect } from "./orthogonalRoute";
import { routeEdges } from "./routeEdges";

interface Relation {
  from: string;
  to: string;
}

function endpointsOf(boxes: Record<string, Rect>) {
  return (relation: Relation) =>
    boxes[relation.from] && boxes[relation.to] ? { from: boxes[relation.from], to: boxes[relation.to] } : null;
}

describe("routeEdges", () => {
  it("spreads two arrows into the same box side apart, even though they join different pairs", () => {
    // A and B both sit to the left of C and both attach on C's left side — a pair-scoped lane never
    // separates them (each pair, "A C" and "B C", has exactly one arrow), so before assignPorts both
    // anchors landed on the exact same point: C's left-side midpoint.
    const boxes: Record<string, Rect> = {
      a: { left: 0, top: 0, width: 100, height: 60 },
      b: { left: 0, top: 200, width: 100, height: 60 },
      c: { left: 400, top: 100, width: 100, height: 60 },
    };
    const relations: Relation[] = [
      { from: "a", to: "c" },
      { from: "b", to: "c" },
    ];

    const routed = routeEdges(
      relations,
      (relation) => pairKeyOf(relation.from, relation.to),
      endpointsOf(boxes),
      Object.values(boxes),
    );

    const toAnchors = routed.map((edge) => edge.route.points[edge.route.points.length - 1]);
    expect(toAnchors[0]).not.toEqual(toAnchors[1]);
    // Both still land on C's left edge (x = 400), just at different points along it.
    expect(toAnchors.map((point) => point.x)).toEqual([400, 400]);
    expect(toAnchors[0].y).not.toBe(toAnchors[1].y);
  });

  it("orders exits spatially, not by input order, so bottom exits don't cross", () => {
    // A sits above both B (bottom-left) and C (bottom-right) and exits down A's bottom edge. Given in
    // reversed order the two exits must still order by target: the left-pointing arrow (to B) exits
    // from the left of A's bottom, the right-pointing one (to C) from the right — never swapped.
    const boxes: Record<string, Rect> = {
      a: { left: 300, top: 0, width: 100, height: 60 },
      b: { left: 20, top: 300, width: 100, height: 60 },
      c: { left: 580, top: 300, width: 100, height: 60 },
    };
    // Reversed: the arrow to the right block is routed first.
    const relations: Relation[] = [
      { from: "a", to: "c" },
      { from: "a", to: "b" },
    ];

    const routed = routeEdges(
      relations,
      (relation) => pairKeyOf(relation.from, relation.to),
      endpointsOf(boxes),
      Object.values(boxes),
    );

    // exit point = points[0] (the anchor on A's bottom edge); index 0 is a→c (right block).
    const exitC = routed[0].route.points[0];
    const exitB = routed[1].route.points[0];
    // A's bottom edge exits spread along x; the target on the right must exit to the right of the
    // target on the left.
    expect(exitC.x).toBeGreaterThan(exitB.x);
  });

  it("orders side exits spatially, not by input order, so side exits don't cross", () => {
    // A fills a vertical strip and exits both its right and left sides to targets ordered by input.
    const boxes: Record<string, Rect> = {
      a: { left: 0, top: 0, width: 60, height: 120 },
      up: { left: 300, top: -200, width: 100, height: 60 },
      down: { left: 300, top: 200, width: 100, height: 60 },
    };
    // Right side, reversed: the arrow to the DOWN block is routed first.
    const relations: Relation[] = [
      { from: "a", to: "down" },
      { from: "a", to: "up" },
    ];

    const routed = routeEdges(
      relations,
      (relation) => pairKeyOf(relation.from, relation.to),
      endpointsOf(boxes),
      Object.values(boxes),
    );

    // Both exit A's right edge (x = 60) at different points along it; the target on top must exit
    // higher (smaller y) than the one on the bottom, regardless of input order.
    const exitDown = routed[0].route.points[0];
    const exitUp = routed[1].route.points[0];
    expect(exitDown.x).toBe(60);
    expect(exitUp.x).toBe(60);
    expect(exitUp.y).toBeLessThan(exitDown.y);
  });

  it("leaves a single arrow into a box on that side's exact midpoint", () => {
    const boxes: Record<string, Rect> = {
      a: { left: 0, top: 0, width: 100, height: 60 },
      c: { left: 400, top: 0, width: 100, height: 60 },
    };
    const relations: Relation[] = [{ from: "a", to: "c" }];

    const [routed] = routeEdges(
      relations,
      (relation) => pairKeyOf(relation.from, relation.to),
      endpointsOf(boxes),
      Object.values(boxes),
    );

    const toAnchor = routed.route.points[routed.route.points.length - 1];
    expect(toAnchor).toEqual({ x: 400, y: 30 });
  });
});
