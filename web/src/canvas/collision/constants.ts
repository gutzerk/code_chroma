/**
 * Single source of truth for the collision-avoidance geometry — imported by `resolveDrop` AND by
 * `C1View.layoutDiagram`'s dagre call, so a hand-dropped block lands in the same rhythm as the auto
 * layout instead of the two drifting apart the next time one of the numbers is edited.
 */

/** Minimum gap on X, px in canvas coordinates — dagre's `nodesep` (between neighbours in a row). */
export const NODE_SEP = 110;

/** Minimum gap on Y — dagre's `ranksep` (between rows). Deliberately different from NODE_SEP. */
export const RANK_SEP = 160;

/** Rings of the spiral fallback searched when no candidate position is free. */
export const MAX_RING = 12;

/** Spiral ring spacing. */
export const RING_STEP = NODE_SEP;

/** Landing animation duration. */
export const SETTLE_MS = 160;

/** How much closer (px) a new landing must be before it replaces the one the ghost already shows.
 * Without it the proposal flickers between two equally good solutions as the pointer crosses the
 * boundary between them. */
export const LANDING_HYSTERESIS_PX = 8;
