import { describe, expect, it } from "vitest";
import {
  CONNECTOR,
  anchorOf,
  assignLanes,
  assignPorts,
  chooseSides,
  labelPointOf,
  pairKeyOf,
  rectFromBox,
  roundedPath,
  routeConnector,
  simplify,
  type Rect,
} from "./orthogonalRoute";

function rect(left: number, top: number, width = 100, height = 60): Rect {
  return { left, top, width, height };
}

/** Every corner an SVG path visits, so a route's shape can be asserted without matching a d string. */
function corners(d: string): { x: number; y: number }[] {
  return [...d.matchAll(/[MQL] (-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
}

describe("chooseSides", () => {
  it("leaves and enters through facing vertical sides when the boxes sit side by side", () => {
    expect(chooseSides(rect(0, 0), rect(400, 20))).toEqual(["right", "left"]);
  });

  it("leaves and enters through facing horizontal sides when one box sits below the other", () => {
    expect(chooseSides(rect(0, 0), rect(20, 400))).toEqual(["bottom", "top"]);
  });

  it("prefers the axis the boxes are actually separated along over the larger centre delta", () => {
    expect(chooseSides(rect(0, 0, 400, 40), rect(30, 200, 400, 40))).toEqual(["bottom", "top"]);
  });

  it("falls back to the dominant delta when the boxes overlap on both axes", () => {
    expect(chooseSides(rect(0, 0), rect(60, 20))).toEqual(["right", "left"]);
  });
});

describe("anchorOf", () => {
  it("attaches to the side's midpoint when the arrow has no lane", () => {
    expect(anchorOf(rect(0, 0), "right")).toEqual({ x: 100, y: 30 });
  });

  it("shifts along the side by the lane offset", () => {
    expect(anchorOf(rect(0, 0, 100, 200), "right", 20)).toEqual({ x: 100, y: 120 });
  });

  it("clamps an outer lane back onto the side rather than beside the box", () => {
    // 40px tall: the anchor stops one sidePad (8px) short of the bottom corner, not beyond it.
    expect(anchorOf(rect(0, 0, 100, 40), "right", 100).y).toBe(32);
  });
});

describe("assignLanes", () => {
  it("gives one arrow between a pair the centre lane", () => {
    expect(assignLanes([{ pair: "a b" }], (item) => item.pair)).toEqual([{ offset: 0, rank: 0 }]);
  });

  it("spreads two arrows between the same pair symmetrically apart", () => {
    const lanes = assignLanes([{ pair: "a b" }, { pair: "a b" }], (item) => item.pair, 14);
    expect(lanes.map((lane) => lane.offset)).toEqual([-7, 7]);
  });

  it("puts opposite-direction arrows between the same two blocks in different lanes", () => {
    const lanes = assignLanes(
      [{ from: "a", to: "b" }, { from: "b", to: "a" }],
      (item) => pairKeyOf(item.from, item.to),
    );
    expect(lanes[0].offset).not.toBe(lanes[1].offset);
  });

  it("keeps arrows between different pairs on their own centre lanes", () => {
    const lanes = assignLanes([{ pair: "a b" }, { pair: "c d" }], (item) => item.pair);
    expect(lanes.map((lane) => lane.offset)).toEqual([0, 0]);
  });
});

describe("assignPorts", () => {
  it("gives one arrow on a box+side the centre port", () => {
    expect(assignPorts(["boxA|right"])).toEqual([0]);
  });

  it("spreads arrows on the same box+side apart, even from different pairs", () => {
    // A→C and B→C both leave/enter on "boxC|left" — different pairs, but the same border, so a
    // pair-scoped lane would never separate them. assignPorts groups by the border itself instead.
    const offsets = assignPorts(["boxC|left", "boxC|left"], 14);
    expect(offsets).toEqual([-7, 7]);
  });

  it("keeps arrows on different box+sides on their own centre ports", () => {
    expect(assignPorts(["boxA|right", "boxB|left"])).toEqual([0, 0]);
  });
});

describe("simplify", () => {
  it("drops a collinear corner so a straight route carries no invisible elbow", () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
  });

  it("drops a repeated corner", () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toHaveLength(2);
  });
});

describe("roundedPath", () => {
  it("draws a straight run as a single line segment", () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toBe("M 0 0 L 100 0");
  });

  it("rounds a corner with a quadratic curve instead of a hard right angle", () => {
    const d = roundedPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      10,
    );
    expect(d).toBe("M 0 0 L 90 0 Q 100 0 100 10 L 100 100");
  });

  it("shrinks the radius on a short segment rather than overshooting the next corner", () => {
    const d = roundedPath(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 100 },
      ],
      10,
    );
    expect(d).toBe("M 0 0 L 2 0 Q 4 0 4 2 L 4 100");
  });
});

describe("routeConnector", () => {
  it("draws one straight line between two horizontally aligned boxes", () => {
    const route = routeConnector(rect(0, 0), rect(300, 0));
    expect(route.d).toBe("M 100 30 L 300 30");
  });

  it("turns in right angles when the boxes are offset on both axes", () => {
    const route = routeConnector(rect(0, 0), rect(300, 200));
    // Out of the right side, across a vertical crossing line halfway between, into the left side.
    expect(corners(route.d).map((point) => [point.x, point.y])).toEqual([
      [100, 30],
      [192, 30],
      [200, 30],
      [200, 222],
      [200, 230],
      [300, 230],
    ]);
  });

  it("routes two arrows between the same pair onto different strokes", () => {
    const [laneA, laneB] = assignLanes([0, 1], () => "pair");
    const a = routeConnector(rect(0, 0), rect(300, 200), laneA);
    const b = routeConnector(rect(0, 0), rect(300, 200), laneB);
    expect(a.d).not.toBe(b.d);
    expect(a.label).not.toEqual(b.label);
  });

  it("separates the two directions of a bidirectional pair", () => {
    const lanes = assignLanes([0, 1], () => "pair");
    const forward = routeConnector(rect(0, 0), rect(300, 0), lanes[0]);
    const back = routeConnector(rect(300, 0), rect(0, 0), lanes[1]);
    expect(forward.d).not.toBe(back.d);
  });

  it("keeps each lane's caption on its own stroke", () => {
    const lanes = assignLanes([0, 1, 2], () => "pair");
    const labels = lanes.map((lane) => routeConnector(rect(0, 0, 100, 200), rect(300, 0, 100, 200), lane).label);
    expect(new Set(labels.map((label) => `${label.x},${label.y}`)).size).toBe(3);
  });

  it("routes around the boxes when their chosen sides face away from each other", () => {
    // Target to the left of the source: exiting right and entering left would double back through
    // both boxes, so the route leaves, clears the nearer edge, and comes back in.
    const route = routeConnector(rect(0, 0), rect(0, 200), { offset: 0, rank: 0 });
    const ys = corners(route.d).map((point) => point.y);
    expect(Math.max(...ys)).toBe(200);
    expect(Math.min(...ys)).toBe(60);
  });

  it("puts each lane of a wrapping route on its own outer line", () => {
    const lanes = assignLanes([0, 1], () => "pair");
    const a = routeConnector(rect(0, 0), rect(20, 30), lanes[0]);
    const b = routeConnector(rect(0, 0), rect(20, 30), lanes[1]);
    expect(a.d).not.toBe(b.d);
  });

  it("centers its caption on the line's true arc-length midpoint, not the longest segment's", () => {
    const route = routeConnector(rect(0, 0), rect(300, 200), { offset: 20, rank: 0 });
    // Total path is 400 units (18 + 102 + 200 + 62 + 18); the halfway point falls mid-run at y=130,
    // not at the middle of the longest (vertical) segment which would sit lower at y=150.
    expect(route.label).toEqual({ x: 220, y: 130 });
  });

  it("reads a dagre box's centre-based coordinates as a rect", () => {
    expect(rectFromBox({ x: 100, y: 50, width: 40, height: 20 })).toEqual({
      left: 80,
      top: 40,
      width: 40,
      height: 20,
    });
  });

  it("leaves a stub before the first turn so the arrow meets the box at a right angle", () => {
    const route = routeConnector(rect(0, 0), rect(300, 200));
    expect(route.points[1]).toEqual({ x: 100 + CONNECTOR.stub, y: 30 });
  });
});

describe("labelPointOf", () => {
  it("returns the true arc-length midpoint of a multi-segment line", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 300, y: 200 },
    ];
    // Total length 500; the halfway point (250 units in) lands three-quarters down the vertical run.
    expect(labelPointOf(points)).toEqual({ x: 100, y: 150 });
  });

  it("returns the midpoint of the longest clear segment when the true midpoint sits on a box", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
    ];
    // The true midpoint (100,50) sits on the avoid box, so fall back to the longest clear segment's
    // midpoint — the vertical run (100,0)→(100,200), whose midpoint (100,100) clears the box.
    expect(labelPointOf(points, [rect(80, 30, 40, 40)])).toEqual({ x: 100, y: 100 });
  });
});
