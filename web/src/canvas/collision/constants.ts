/**
 * Single source of truth for the collision-avoidance geometry — imported by `resolveDrop` AND by
 * `C1View.layoutDiagram`'s dagre call, so a hand-dropped block lands in the same rhythm as the auto
 * layout instead of the two drifting apart the next time one of the numbers is edited.
 */

/** ELK/dagre spacing on X (between neighbours in a row) -- auto-layout only, not the drag rule. */
export const ELK_NODE_SEP = 110;

/** ELK/dagre spacing on Y (between rows). Deliberately different from ELK_NODE_SEP. */
export const ELK_RANK_SEP = 160;

/** Minimum gap on X a dragged block must keep, px. Far below ELK_NODE_SEP: ELK sizes unmeasured boxes
 * at a default, so freshly laid-out boxes are often closer than ELK_NODE_SEP and must stay droppable. */
export const NODE_SEP = 24;

/** Minimum gap on Y a dragged block must keep (see NODE_SEP). */
export const RANK_SEP = 24;

/** Rings of the spiral fallback searched when no candidate position is free. */
export const MAX_RING = 12;

/** Spiral ring spacing. */
export const RING_STEP = ELK_NODE_SEP;

/** Landing animation duration. */
export const SETTLE_MS = 160;

/** How much closer (px) a new landing must be before it replaces the one the ghost already shows.
 * Without it the proposal flickers between two equally good solutions as the pointer crosses the
 * boundary between them. */
export const LANDING_HYSTERESIS_PX = 8;
