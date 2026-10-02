export const GRID_SIZE = 20;
export const TICK_MS = 120;

export type Direction = "up" | "down" | "left" | "right";

export interface Point {
  x: number;
  y: number;
}

export interface SnakeState {
  body: Point[];
  direction: Direction;
  food: Point;
  score: number;
  gameOver: boolean;
}

const MOVES: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITES: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

/** Picks a random empty cell for new food, so it never lands on the snake's own body. */
function placeFood(body: Point[], rng: () => number): Point {
  const occupied = new Set(body.map((p) => `${p.x},${p.y}`));
  const empty: Point[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (!occupied.has(`${x},${y}`)) empty.push({ x, y });
    }
  }
  const index = Math.min(Math.floor(rng() * empty.length), empty.length - 1);
  return empty[index];
}

/** Fresh 3-cell snake facing right in the middle of the grid, with food placed via `rng` (an
 * injectable 0..1 source so tests can pin where food lands; defaults to `Math.random`). */
export function createInitialState(rng: () => number = Math.random): SnakeState {
  const mid = Math.floor(GRID_SIZE / 2);
  const body: Point[] = [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ];
  return { body, direction: "right", food: placeFood(body, rng), score: 0, gameOver: false };
}

/** One game tick: moves toward `nextDirection` (ignoring a direct 180° reversal), checks
 * wall/self collision, and grows on food. A no-op once `gameOver` is set. Kept free of the DOM so
 * it can be unit-tested without a canvas. */
export function step(
  state: SnakeState,
  nextDirection: Direction,
  rng: () => number = Math.random,
): SnakeState {
  if (state.gameOver) return state;

  const direction = nextDirection === OPPOSITES[state.direction] ? state.direction : nextDirection;
  const head = state.body[0];
  const move = MOVES[direction];
  const newHead: Point = { x: head.x + move.x, y: head.y + move.y };

  const hitWall = newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE;
  if (hitWall) return { ...state, direction, gameOver: true };

  const ateFood = newHead.x === state.food.x && newHead.y === state.food.y;
  // The tail cell vacates on a non-growing move, so it doesn't count as a collision.
  const bodyToCheck = ateFood ? state.body : state.body.slice(0, -1);
  const hitSelf = bodyToCheck.some((p) => p.x === newHead.x && p.y === newHead.y);
  if (hitSelf) return { ...state, direction, gameOver: true };

  const newBody = ateFood ? [newHead, ...state.body] : [newHead, ...state.body.slice(0, -1)];

  return {
    body: newBody,
    direction,
    food: ateFood ? placeFood(newBody, rng) : state.food,
    score: ateFood ? state.score + 1 : state.score,
    gameOver: false,
  };
}
