import { MAX_RING, NODE_SEP, RANK_SEP, RING_STEP } from "./constants";

/** An axis-aligned box in canvas coordinates, anchored at its top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle the dragged block must not land on top of. The id is only ever read as the last
 * tie-break, so identical scenes resolve identically run to run. */
export interface Obstacle extends Rect {
  id: string;
}

export interface ResolveDropOptions {
  /** Minimum gap on X. Defaults to the dagre-derived NODE_SEP. */
  nodeSep?: number;
  /** Minimum gap on Y. Defaults to RANK_SEP — the gap is anisotropic on purpose. */
  rankSep?: number;
  maxRing?: number;
  ringStep?: number;
}

export interface DropResolution {
  x: number;
  y: number;
  /** True when even the spiral fallback found nothing: the block stays where it was released and the
   * UI says so (a dimmed ghost) rather than pretending the overlap was solved. */
  blocked: boolean;
}

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Candidate {
  x: number;
  y: number;
  /** Which obstacle produced this candidate — the final, deterministic tie-break. */
  obstacleId: string;
}

// Slack for float comparisons: two inflated rectangles that touch exactly are a legal landing (the
// gap is then exactly NODE_SEP/RANK_SEP), so only a genuine overlap may count as a violation.
const EPSILON = 1e-6;

function inflate(rect: Rect, padX: number, padY: number): Bounds {
  return {
    left: rect.x - padX,
    right: rect.x + rect.width + padX,
    top: rect.y - padY,
    bottom: rect.y + rect.height + padY,
  };
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return (
    a.left < b.right - EPSILON &&
    b.left < a.right - EPSILON &&
    a.top < b.bottom - EPSILON &&
    b.top < a.bottom - EPSILON
  );
}

/** True when `moving` placed at (x, y) violates the gap against any obstacle. Exported because
 * `useCollisionAvoidance` re-tests the landing it is already showing before the hysteresis threshold
 * lets it keep it — a proposal that has since been blocked must never survive. */
export function hasCollision(
  moving: Rect,
  obstacles: readonly Obstacle[],
  options: ResolveDropOptions = {},
): boolean {
  const { padX, padY } = padding(options);
  const movingBounds = inflate(moving, padX, padY);
  return obstacles.some((obstacle) => overlaps(movingBounds, inflate(obstacle, padX, padY)));
}

function padding(options: ResolveDropOptions): { padX: number; padY: number } {
  return {
    padX: (options.nodeSep ?? NODE_SEP) / 2,
    padY: (options.rankSep ?? RANK_SEP) / 2,
  };
}

/** Distance-then-|dy|-then-|dx|-then-id ordering, relative to the release point. The tie-breaks are
 * what make an identical scene resolve identically every time — without them the ghost flickers. */
function compareCandidates(a: Candidate, b: Candidate, from: Rect): number {
  const da = Math.hypot(a.x - from.x, a.y - from.y);
  const db = Math.hypot(b.x - from.x, b.y - from.y);
  if (Math.abs(da - db) > EPSILON) return da - db;
  const dya = Math.abs(a.y - from.y);
  const dyb = Math.abs(b.y - from.y);
  if (Math.abs(dya - dyb) > EPSILON) return dya - dyb;
  const dxa = Math.abs(a.x - from.x);
  const dxb = Math.abs(b.x - from.x);
  if (Math.abs(dxa - dxb) > EPSILON) return dxa - dxb;
  if (a.obstacleId !== b.obstacleId) return a.obstacleId < b.obstacleId ? -1 : 1;
  // Signed positions last, so the ordering is TOTAL: two mirror-image escapes (up vs down out of the
  // same obstacle) tie on every measure above, and leaning on sort stability to break that would
  // make the answer an accident of the candidate list's build order.
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}

/** The four minimum-translation exits out of one obstacle — left, right, up, down — plus the eight
 * "edge flush against edge" alignments that turn an off-by-a-pixel escape into a tidy side-by-side
 * landing. All computed in inflated space, so every one of them sits exactly at the minimum gap. */
function candidatesFor(moving: Bounds, obstacle: Bounds, obstacleId: string, at: Rect): Candidate[] {
  const dxLeft = obstacle.left - moving.right;
  const dxRight = obstacle.right - moving.left;
  const dyUp = obstacle.top - moving.bottom;
  const dyDown = obstacle.bottom - moving.top;
  const shifts: Array<[number, number]> = [
    [dxLeft, 0],
    [dxRight, 0],
    [0, dyUp],
    [0, dyDown],
    // Alignments: each edge of `moving` brought flush to each edge of the obstacle, per axis.
    [obstacle.left - moving.left, 0],
    [obstacle.right - moving.right, 0],
    [0, obstacle.top - moving.top],
    [0, obstacle.bottom - moving.bottom],
  ];
  return shifts.map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy, obstacleId }));
}

/** Points on the square ring at Chebyshev radius `ring`, ordered by the same comparator as the
 * candidates so the fallback is deterministic too. */
function ringCandidates(ring: number, step: number, at: Rect): Candidate[] {
  const points: Candidate[] = [];
  for (let i = -ring; i <= ring; i += 1) {
    for (let j = -ring; j <= ring; j += 1) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
      points.push({ x: at.x + i * step, y: at.y + j * step, obstacleId: "" });
    }
  }
  return points.sort((a, b) => compareCandidates(a, b, at));
}

/**
 * Where the dragged block actually lands: the release point when it is already legal, otherwise the
 * nearest position that clears every obstacle by NODE_SEP on X and RANK_SEP on Y.
 *
 * Pure — no DOM, no React, no store. Only the dragged block moves; obstacles are hard and are never
 * pushed, so this is one calculation rather than a relaxation of the whole scene.
 */
export function resolveDrop(
  moving: Rect,
  obstacles: readonly Obstacle[],
  options: ResolveDropOptions = {},
): DropResolution {
  const { padX, padY } = padding(options);
  const maxRing = options.maxRing ?? MAX_RING;
  const ringStep = options.ringStep ?? RING_STEP;

  const inflated = obstacles.map((obstacle) => ({
    id: obstacle.id,
    bounds: inflate(obstacle, padX, padY),
  }));
  const movingBounds = inflate(moving, padX, padY);
  const hit = inflated.filter((obstacle) => overlaps(movingBounds, obstacle.bounds));
  // The common case, and the reason the drag stays smooth: one O(n) pass and we are done.
  if (hit.length === 0) return { x: moving.x, y: moving.y, blocked: false };

  const isFree = (candidate: Candidate): boolean => {
    const bounds = inflate(
      { x: candidate.x, y: candidate.y, width: moving.width, height: moving.height },
      padX,
      padY,
    );
    return !inflated.some((obstacle) => overlaps(bounds, obstacle.bounds));
  };

  const candidates = hit
    .flatMap((obstacle) => candidatesFor(movingBounds, obstacle.bounds, obstacle.id, moving))
    .sort((a, b) => compareCandidates(a, b, moving));
  for (const candidate of candidates) {
    if (isFree(candidate)) return { x: candidate.x, y: candidate.y, blocked: false };
  }

  // Dense scene: no single-obstacle escape clears the others, so widen the search outwards.
  for (let ring = 1; ring <= maxRing; ring += 1) {
    for (const candidate of ringCandidates(ring, ringStep, moving)) {
      if (isFree(candidate)) return { x: candidate.x, y: candidate.y, blocked: false };
    }
  }

  return { x: moving.x, y: moving.y, blocked: true };
}
