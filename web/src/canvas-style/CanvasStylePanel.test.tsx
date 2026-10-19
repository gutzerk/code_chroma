import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CanvasStylePanel } from "./CanvasStylePanel";
import { canvasStyleStore } from "./canvasStyleStore";

afterEach(() => {
  canvasStyleStore.restoreDefault();
});

describe("CanvasStylePanel", () => {
  it("applies a preset and marks it pressed", () => {
    render(<CanvasStylePanel onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByTestId("canvas-style-preset-navy"));

    expect(canvasStyleStore.getSaved()?.bg).toBe("#070c1a");
    expect(screen.getByTestId("canvas-style-preset-navy").getAttribute("aria-pressed")).toBe("true");
  });

  it("hides texture controls for none and shows them for dots", () => {
    render(<CanvasStylePanel onDismiss={vi.fn()} />);

    expect(screen.queryByTestId("canvas-style-texture-controls")).toBeNull();
    fireEvent.click(screen.getByTestId("canvas-style-texture-dots"));

    expect(screen.getByTestId("canvas-style-texture-controls")).toBeTruthy();
  });

  it("rejects an invalid hex without applying it", () => {
    render(<CanvasStylePanel onDismiss={vi.fn()} />);

    fireEvent.change(screen.getByTestId("canvas-style-bg-hex"), { target: { value: "#12" } });

    expect(screen.getByText(/Enter a 6-digit hex color/)).toBeTruthy();
    expect(canvasStyleStore.getSaved()).toBeNull();
  });

  it("warns on a light background", () => {
    render(<CanvasStylePanel onDismiss={vi.fn()} />);

    fireEvent.change(screen.getByTestId("canvas-style-bg-hex"), { target: { value: "#ffffff" } });

    expect(screen.getByTestId("canvas-style-light-warning")).toBeTruthy();
  });

  it("resets to the built-in canvas", () => {
    render(<CanvasStylePanel onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByTestId("canvas-style-preset-dusk"));

    fireEvent.click(screen.getByTestId("canvas-style-reset"));

    expect(canvasStyleStore.getSaved()).toBeNull();
  });
});
