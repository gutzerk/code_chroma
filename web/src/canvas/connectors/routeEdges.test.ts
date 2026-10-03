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

  it("centres a single port on the side's midpoint and steps pairs out symmetrically", () => {
    // Three distinct sources all to the left of C, so all three arrows enter C's left side as three
    // different pairs (no assignLanes interference) -- odd count, so one arrow sits exactly on the
    // midpoint (y=150 for a 100-tall box) and the other two step out ±portGap each.
    const boxes: Record<string, Rect> = {
      a: { left: 0, top: 60, width: 100, height: 60 },
      b: { left: 0, top: 130, width: 100, height: 60 },
      c: { left: 400, top: 100, width: 100, height: 100 },
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
    expect(toAnchors[0].x).toBe(400);
    expect(toAnchors[1].x).toBe(400);
    expect(toAnchors[1].y).not.toBe(toAnchors[0].y);
    // Even count: no centre port -- the pair sits symmetric around the midpoint at ±portGap/2.
    const mid = (toAnchors[0].y + toAnchors[1].y) / 2;
    expect(mid).toBe(150);
    expect(Math.abs(toAnchors[1].y - toAnchors[0].y)).toBe(26);
  });

  it("keeps arrows spread when the same box is measured at slightly different rects per edge", () => {
    // ConnectionsOverlay measures each edge's endpoint boxes separately; subpixel rounding can give
    // the SAME logical box two rects (300.6x72.4 vs 299.4x72.6 here). Without a stable id the
    // rect-derived grouping key would split C into two groups and fuse both arrows near its centre.
    // Passing fromId/toId keeps them grouped by the box, not its drifting geometry.
    const a: Rect = { left: 0, top: 0, width: 100, height: 60 };
    const b: Rect = { left: 0, top: 200, width: 100, height: 60 };
    const c1: Rect = { left: 400, top: 100, width: 300.6, height: 72.4 };
    const c2: Rect = { left: 400, top: 100, width: 299.4, height: 72.6 };

    const routed = routeEdges(
      [{ who: "1" }, { who: "2" }],
      (i) => i.who,
      (i) =>
        i.who === "1"
          ? { from: a, to: c1, fromId: "a", toId: "c" }
          : { from: b, to: c2, fromId: "b", toId: "c" },
      [a, b, c1, c2],
    );

    // Both on C's right edge (x=400) at symmetric heights around the midpoint: the pair spreads and
    // neither sits on the other's spot despite the two rects differing by subpixels.
    const toAnchors = routed.map((edge) => edge.route.points[edge.route.points.length - 1]);
    expect(toAnchors[0].x).toBe(400);
    expect(toAnchors[1].x).toBe(400);
    expect(toAnchors[1].y).not.toBe(toAnchors[0].y);
    expect(Math.abs(toAnchors[1].y - toAnchors[0].y)).toBeCloseTo(26, 0);
  });

  it("spreads an out-arrow and an in-arrow that share one box side", () => {
    // The "one exits, one enters the same edge" case: C->A leaves C's right side and B->C enters that
    // same right side. Before ports were pooled across both directions, the exit was alone in its from-
    // pool and the enter alone in its to-pool, so each landed on the side's midpoint -- two arrows
    // fusing into one point at C's border. A shared from+to pool must spread them together.
    const c: Rect = { left: 400, top: 100, width: 300, height: 150 }; // right edge x=700
    const a: Rect = { left: 900, top: 50, width: 200, height: 120 }; // right of c, up
    const b: Rect = { left: 900, top: 400, width: 200, height: 120 }; // right of c, down

    const routed = routeEdges(
      [
        { who: "out" },
        { who: "in" },
      ],
      (i) => i.who,
      (i) =>
        i.who === "out"
          ? { from: c, to: a, fromId: "c", toId: "a" }
          : { from: b, to: c, fromId: "b", toId: "c" },
      [c, a, b],
    );

    // The out-arrow's first point (exits C) and the in-arrow's last point (enters C) both sit on
    // C's right edge (x=700) at symmetric heights around the midpoint (y=175): ±portGap/2 = 162/188.
    const outExit = routed[0].route.points[0];
    const inEnter = routed[1].route.points[routed[1].route.points.length - 1];
    expect(outExit.x).toBe(700);
    expect(inEnter.x).toBe(700);
    expect(outExit.y).not.toBe(inEnter.y);
    expect(Math.abs(outExit.y - inEnter.y)).toBe(26);
  });
});
