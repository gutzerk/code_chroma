import { describe, expect, it } from "vitest";
import { hasCollision, resolveDrop, type Obstacle, type Rect } from "./resolveDrop";
import { NODE_SEP, RANK_SEP, RING_STEP } from "./constants";

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

function obstacle(id: string, x: number, y: number, width: number, height: number): Obstacle {
  return { id, x, y, width, height };
}

interface Scenario {
  name: string;
  moving: Rect;
  obstacles: Obstacle[];
  expected: { x: number; y: number; blocked: boolean };
}

// One case per branch of the algorithm. Every expectation is derived from the geometry algebraically
// in terms of NODE_SEP/RANK_SEP (rather than hardcoded pixels) so a future change to either constant
// doesn't silently invalidate what each scenario is actually meant to prove: the gap is NODE_SEP on
// X and RANK_SEP on Y, so the inflated rectangles of a legal landing touch without overlapping.
const SCENARIOS: Scenario[] = [
  {
    name: "returns the release point unchanged when there are no obstacles",
    moving: rect(0, 0, 100, 50),
    obstacles: [],
    expected: { x: 0, y: 0, blocked: false },
  },
  {
    name: "returns the release point unchanged when no obstacle is within the gap",
    // Obstacle sits NODE_SEP + 40 clear of the block's right edge — safely outside the gap.
    moving: rect(0, 0, 100, 50),
    obstacles: [obstacle("a", 100 + NODE_SEP + 40, 0, 200, 100)],
    expected: { x: 0, y: 0, blocked: false },
  },
  {
    name: "escapes one overlap to the left by exactly the minimum translation",
    moving: rect(150, 25, 100, 50),
    obstacles: [obstacle("a", 200, 0, 200, 100)],
    // Escaping left lands the block's right edge exactly NODE_SEP from the obstacle's left edge
    // (200), y untouched: x = 200 - 100 (width) - NODE_SEP.
    expected: { x: 200 - 100 - NODE_SEP, y: 25, blocked: false },
  },
  {
    name: "escapes upwards by RANK_SEP, not NODE_SEP, when the free space is above",
    moving: rect(250, 170, 100, 50),
    obstacles: [obstacle("a", 0, 200, 600, 200)],
    // Escaping up lands the block's bottom edge exactly RANK_SEP from the obstacle's top edge
    // (200), x untouched: y = 200 - 50 (height) - RANK_SEP.
    expected: { x: 250, y: 200 - 50 - RANK_SEP, blocked: false },
  },
  {
    name: "finds the nearest point free of both neighbours when it overlaps two",
    moving: rect(150, 120, 100, 50),
    obstacles: [obstacle("a", 0, 0, 200, 100), obstacle("b", 0, 190, 200, 100)],
    // Every vertical escape lands inside the other neighbour, so it exits sideways past both,
    // landing NODE_SEP clear of their shared right edge (200).
    expected: { x: 200 + NODE_SEP, y: 120, blocked: false },
  },
  {
    name: "lands outside a gap the block cannot fit inside",
    moving: rect(50, 135, 100, 50),
    obstacles: [obstacle("a", 0, 0, 200, 100), obstacle("b", 0, 220, 200, 100)],
    // The vertical gap is too narrow for 50 (height) + 2·RANK_SEP, so it leaves the corridor
    // entirely to the left, landing NODE_SEP clear of the shared left edge (0).
    expected: { x: 0 - 100 - NODE_SEP, y: 135, blocked: false },
  },
];

describe("resolveDrop", () => {
  it.each(SCENARIOS)("$name", ({ moving, obstacles, expected }) => {
    const resolution = resolveDrop(moving, obstacles);

    expect(resolution).toEqual(expected);
  });

  it.each(SCENARIOS)("leaves no gap violation behind — $name", ({ moving, obstacles }) => {
    const resolution = resolveDrop(moving, obstacles);

    expect(hasCollision({ ...moving, ...resolution }, obstacles)).toBe(false);
  });

  it("reports the release point as blocked when the whole scene is dense", () => {
    const obstacles: Obstacle[] = [];
    for (let x = -1600; x <= 1600; x += 200) {
      for (let y = -1600; y <= 1600; y += 200) obstacles.push(obstacle(`${x}:${y}`, x, y, 200, 200));
    }

    const resolution = resolveDrop(rect(0, 0, 100, 100), obstacles);

    expect(resolution).toEqual({ x: 0, y: 0, blocked: true });
  });

  it("resolves a symmetric scene the same way on every run", () => {
    // Obstacles the same height as the block and mirrored either side of it, so escaping up and
    // escaping down are equally good to the last decimal — the tie the ghost would flicker on.
    const moving = rect(-50, 0, 100, 50);
    const obstacles = [obstacle("a", -300, 0, 200, 50), obstacle("b", 100, 0, 200, 50)];
    const first = resolveDrop(moving, obstacles);

    const runs = Array.from({ length: 50 }, () => resolveDrop(moving, obstacles));

    expect(runs.every((run) => run.x === first.x && run.y === first.y)).toBe(true);
    // The 200px corridor cannot hold a 100px block with NODE_SEP either side, so it leaves the row,
    // landing RANK_SEP clear of the obstacles' shared top edge (0): y = 0 - 50 (height) - RANK_SEP.
    expect(first).toEqual({ x: -50, y: 0 - 50 - RANK_SEP, blocked: false });
  });

  describe("spiral fallback", () => {
    // A field of small obstacles 150px apart, wider than any single escape can cross: every gap is
    // narrower than the block plus its margins, and the four minimum translations out of the boxes
    // the block actually overlaps all land back inside the field.
    const MOVING = rect(-100, -100, 200, 200);
    const CENTRES = [-450, -300, -150, 0, 150, 300, 450];
    const GRID = CENTRES.flatMap((cx) =>
      CENTRES.map((cy) => obstacle(`${cx}:${cy}`, cx - 20, cy - 20, 40, 40)),
    );

    it("is the only thing that can solve the scene — no candidate position is free", () => {
      const withoutSpiral = resolveDrop(MOVING, GRID, { maxRing: 0 });

      expect(withoutSpiral).toEqual({ x: -100, y: -100, blocked: true });
    });

    it("terminates on a ring position clear of every obstacle", () => {
      const resolution = resolveDrop(MOVING, GRID);

      expect(resolution.blocked).toBe(false);
      expect(hasCollision({ ...MOVING, ...resolution }, GRID)).toBe(false);
      expect(Math.abs(resolution.x - MOVING.x) % RING_STEP).toBe(0);
      expect(Math.abs(resolution.y - MOVING.y) % RING_STEP).toBe(0);
    });
  });

  it("keeps the gap anisotropic — a side-by-side landing is tighter than a stacked one", () => {
    const sideways = resolveDrop(rect(150, 25, 100, 50), [obstacle("a", 200, 0, 200, 100)]);
    const stacked = resolveDrop(rect(250, 170, 100, 50), [obstacle("a", 0, 200, 600, 200)]);

    expect(200 - (sideways.x + 100)).toBe(NODE_SEP);
    expect(200 - (stacked.y + 50)).toBe(RANK_SEP);
  });
});
