import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SnakeGame } from "./SnakeGame";

afterEach(() => {
  cleanup();
});

describe("SnakeGame", () => {
  it("toggles paused on space while active", () => {
    render(<SnakeGame active={true} />);

    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByTestId("snake-paused")).toBeTruthy();

    fireEvent.keyDown(window, { key: " " });
    expect(screen.queryByTestId("snake-paused")).toBeNull();
  });

  it("ignores space while inactive (e.g. minimized)", () => {
    render(<SnakeGame active={false} />);

    fireEvent.keyDown(window, { key: " " });

    expect(screen.queryByTestId("snake-paused")).toBeNull();
  });
});
