import { describe, expect, it } from "vitest";
import { createInitialState, GRID_SIZE, step, type SnakeState } from "./snakeLogic";

const zeroRng = () => 0;

describe("snakeLogic", () => {
  it("moves the head one cell in the current direction", () => {
    const state = createInitialState(zeroRng);
    const head = state.body[0];

    const next = step(state, "right", zeroRng);

    expect(next.body[0]).toEqual({ x: head.x + 1, y: head.y });
    expect(next.gameOver).toBe(false);
  });

  it("ends the game on hitting the wall", () => {
    const state: SnakeState = {
      body: [
        { x: GRID_SIZE - 1, y: 5 },
        { x: GRID_SIZE - 2, y: 5 },
      ],
      direction: "right",
      food: { x: 0, y: 0 },
      score: 0,
      gameOver: false,
    };

    const next = step(state, "right", zeroRng);

    expect(next.gameOver).toBe(true);
  });

  it("ends the game on hitting its own body", () => {
    const state: SnakeState = {
      body: [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 6, y: 6 },
        { x: 6, y: 5 },
        { x: 6, y: 4 },
      ],
      direction: "up",
      food: { x: 0, y: 0 },
      score: 0,
      gameOver: false,
    };

    const next = step(state, "right", zeroRng);

    expect(next.gameOver).toBe(true);
  });

  it("grows and scores on eating food", () => {
    const state = createInitialState(zeroRng);
    const withFoodAhead: SnakeState = { ...state, food: { x: state.body[0].x + 1, y: state.body[0].y } };
    const length = withFoodAhead.body.length;

    const next = step(withFoodAhead, "right", zeroRng);

    expect(next.body.length).toBe(length + 1);
    expect(next.score).toBe(withFoodAhead.score + 1);
    expect(next.body[0]).toEqual(withFoodAhead.food);
  });

  it("ignores a direct 180-degree reversal", () => {
    const state = createInitialState(zeroRng);

    const next = step(state, "left", zeroRng);

    expect(next.direction).toBe("right");
  });

  it("stays a no-op once game over", () => {
    const state: SnakeState = {
      body: [{ x: 0, y: 5 }],
      direction: "left",
      food: { x: 10, y: 10 },
      score: 3,
      gameOver: true,
    };

    const next = step(state, "right", zeroRng);

    expect(next).toEqual(state);
  });
});
