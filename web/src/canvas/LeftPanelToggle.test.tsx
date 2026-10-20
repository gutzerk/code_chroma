import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LeftPanelToggle } from "./LeftPanelToggle";
import { layoutStore } from "./layout/layoutStore";

describe("LeftPanelToggle", () => {
  afterEach(() => layoutStore.reset());

  it("offers to hide the panel while it is open", () => {
    render(<LeftPanelToggle />);

    const button = screen.getByRole("button", { name: "Hide diagrams panel" });

    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("closes the panel on click and then offers to show it", () => {
    render(<LeftPanelToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Hide diagrams panel" }));

    const button = screen.getByRole("button", { name: "Show diagrams panel" });
    expect(layoutStore.getState().leftOpen).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });
});
