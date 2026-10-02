import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RailButton } from "./RailButton";

/** The rail is icon-only, so the hover label is the only thing naming a control — and on a disabled
 * one it is the only thing that can say why it is greyed out. */
describe("RailButton", () => {
  it("shows the accessible name as the hover label when there is nothing extra to say", () => {
    render(
      <RailButton label="Zoom in" onClick={vi.fn()}>
        +
      </RailButton>,
    );

    expect(screen.getByRole("button", { name: "Zoom in" }).textContent).toContain("Zoom in");
  });

  it("swaps in the reason on a disabled button, whose greyed-out icon cannot explain itself", () => {
    render(
      <RailButton label="Run agent" tooltip="At the agent limit" disabled onClick={vi.fn()}>
        ▶
      </RailButton>,
    );

    const button = screen.getByRole("button", { name: "Run agent" });

    expect(button).toBeDisabled();
    expect(button.querySelector(".rail-tooltip")?.textContent).toBe("At the agent limit");
  });

  it("hides the label from screen readers, which already have the accessible name", () => {
    render(
      <RailButton label="Zoom out" onClick={vi.fn()}>
        −
      </RailButton>,
    );

    expect(screen.getByRole("button", { name: "Zoom out" }).querySelector(".rail-tooltip")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
