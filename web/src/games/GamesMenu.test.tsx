import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GamesMenu } from "./GamesMenu";

afterEach(() => {
  cleanup();
});

describe("GamesMenu", () => {
  it("opens the game list on click", () => {
    render(<GamesMenu />);

    fireEvent.click(screen.getByTestId("games-menu-button"));

    expect(screen.getByTestId("games-menu-item-snake")).toBeTruthy();
  });

  it("opens Snake in a game window on pick", () => {
    render(<GamesMenu />);

    fireEvent.click(screen.getByTestId("games-menu-button"));
    fireEvent.click(screen.getByTestId("games-menu-item-snake"));

    expect(screen.getByTestId("game-window")).toBeTruthy();
    expect(screen.getByTestId("snake-canvas")).toBeTruthy();
  });

  it("closes the game window on Escape", () => {
    render(<GamesMenu />);

    fireEvent.click(screen.getByTestId("games-menu-button"));
    fireEvent.click(screen.getByTestId("games-menu-item-snake"));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("game-window")).toBeNull();
  });

  it("closes the game window on the close button", () => {
    render(<GamesMenu />);

    fireEvent.click(screen.getByTestId("games-menu-button"));
    fireEvent.click(screen.getByTestId("games-menu-item-snake"));
    fireEvent.click(screen.getByTestId("game-window-close"));

    expect(screen.queryByTestId("game-window")).toBeNull();
  });

  it("marks the trigger active once a game is running, even minimized", () => {
    render(<GamesMenu />);
    expect(screen.getByTestId("games-menu-button")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByTestId("games-menu-button"));
    fireEvent.click(screen.getByTestId("games-menu-item-snake"));
    fireEvent.click(screen.getByTestId("game-window-minimize"));

    expect(screen.getByTestId("games-menu-button")).toHaveAttribute("aria-pressed", "true");
  });

  it("minimizes without losing the running game, and restores on trigger click", () => {
    render(<GamesMenu />);

    fireEvent.click(screen.getByTestId("games-menu-button"));
    fireEvent.click(screen.getByTestId("games-menu-item-snake"));
    fireEvent.click(screen.getByTestId("game-window-minimize"));

    expect(screen.queryByTestId("game-window")).toBeNull();
    expect(screen.getByTestId("game-window-minimized")).toBeTruthy();
    expect(screen.getByTestId("snake-canvas")).toBeTruthy();

    fireEvent.click(screen.getByTestId("games-menu-button"));

    expect(screen.getByTestId("game-window")).toBeTruthy();
    expect(screen.queryByTestId("game-window-minimized")).toBeNull();
  });

  it("keeps the paused state across minimize/restore", () => {
    render(<GamesMenu />);
    fireEvent.click(screen.getByTestId("games-menu-button"));
    fireEvent.click(screen.getByTestId("games-menu-item-snake"));
    fireEvent.keyDown(window, { key: " " });

    expect(screen.getByTestId("snake-paused")).toBeTruthy();

    fireEvent.click(screen.getByTestId("game-window-minimize"));
    fireEvent.click(screen.getByTestId("games-menu-button"));

    expect(screen.getByTestId("snake-paused")).toBeTruthy();
  });

  it("drops the paused state once the game is closed, not just minimized", () => {
    render(<GamesMenu />);
    fireEvent.click(screen.getByTestId("games-menu-button"));
    fireEvent.click(screen.getByTestId("games-menu-item-snake"));
    fireEvent.keyDown(window, { key: " " });
    fireEvent.click(screen.getByTestId("game-window-close"));

    fireEvent.click(screen.getByTestId("games-menu-button"));
    fireEvent.click(screen.getByTestId("games-menu-item-snake"));

    expect(screen.queryByTestId("snake-paused")).toBeNull();
  });
});
