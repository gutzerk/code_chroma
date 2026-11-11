import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ZoomSettingsMenu } from "./ZoomSettingsMenu";
import { zoomSettingsStore } from "./zoomSettingsStore";

afterEach(() => {
  zoomSettingsStore.reloadForTests();
  window.localStorage.clear();
});

describe("ZoomSettingsMenu", () => {
  it("writes slider and scale changes to the store", () => {
    render(<ZoomSettingsMenu />);
    fireEvent.click(screen.getByTestId("zoom-settings-button"));

    fireEvent.change(screen.getByTestId("zoom-settings-mouse"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("zoom-settings-trackpad"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByTestId("zoom-settings-scale"), { target: { value: "1.5" } });

    expect(zoomSettingsStore.get()).toEqual({ mouse: 2, trackpad: 0.5, displayScale: 1.5 });
  });

  it("resets every setting to its default", () => {
    zoomSettingsStore.set({ mouse: 2, displayScale: 2 });
    render(<ZoomSettingsMenu />);
    fireEvent.click(screen.getByTestId("zoom-settings-button"));

    fireEvent.click(screen.getByTestId("zoom-settings-reset"));

    expect(zoomSettingsStore.get()).toEqual({ mouse: 1, trackpad: 1, displayScale: "auto" });
  });

  it("closes on Escape", () => {
    render(<ZoomSettingsMenu />);
    fireEvent.click(screen.getByTestId("zoom-settings-button"));

    fireEvent.keyDown(screen.getByTestId("zoom-settings-panel"), { key: "Escape" });

    expect(screen.queryByTestId("zoom-settings-panel")).toBeNull();
  });

  it("closes on Escape from the trigger and keeps focus there", () => {
    render(<ZoomSettingsMenu />);
    const trigger = screen.getByTestId("zoom-settings-button");
    fireEvent.click(trigger);

    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(screen.queryByTestId("zoom-settings-panel")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("moves focus into the dialog it controls when opened", () => {
    render(<ZoomSettingsMenu />);
    const trigger = screen.getByTestId("zoom-settings-button");

    fireEvent.click(trigger);

    const panel = screen.getByTestId("zoom-settings-panel");
    expect(trigger).toHaveAttribute("aria-controls", panel.id);
    expect(trigger).not.toHaveAttribute("aria-pressed");
    expect(document.activeElement).toBe(screen.getByTestId("zoom-settings-mouse"));
  });

  it("announces slider values as percentages", () => {
    zoomSettingsStore.set({ trackpad: 1.5 });
    render(<ZoomSettingsMenu />);

    fireEvent.click(screen.getByTestId("zoom-settings-button"));

    expect(screen.getByTestId("zoom-settings-trackpad")).toHaveAttribute("aria-valuetext", "150%");
  });
});
