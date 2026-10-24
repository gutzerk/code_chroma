import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CanvasStylePanel } from "./CanvasStylePanel";
import { CANVAS_STYLE_PRESETS, canvasStyleStore, toStyle } from "./canvasStyleStore";

afterEach(() => {
  canvasStyleStore.restoreDefault();
});

describe("CanvasStylePanel", () => {
  it("applies a preset on Apply and marks it pressed", () => {
    render(<CanvasStylePanel onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByTestId("canvas-style-preset-navy"));
    fireEvent.click(screen.getByTestId("canvas-style-apply"));

    expect(canvasStyleStore.getSaved()?.bg).toBe("#070c1a");
    expect(screen.getByTestId("canvas-style-preset-navy").getAttribute("aria-pressed")).toBe("true");
  });

  it("does not save until Apply is pressed", () => {
    render(<CanvasStylePanel onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByTestId("canvas-style-preset-navy"));

    expect(canvasStyleStore.getSaved()).toBeNull();
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

  it("resets the draft to the default and clears the saved style on Apply", () => {
    render(<CanvasStylePanel onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByTestId("canvas-style-preset-dusk"));
    fireEvent.click(screen.getByTestId("canvas-style-apply"));
    expect(canvasStyleStore.getSaved()).not.toBeNull();

    fireEvent.click(screen.getByTestId("canvas-style-reset"));
    fireEvent.click(screen.getByTestId("canvas-style-apply"));

    expect(canvasStyleStore.getSaved()).toBeNull();
  });

  it("re-seeds an unedited draft when the saved style changes outside the panel", () => {
    render(<CanvasStylePanel onDismiss={vi.fn()} />);

    act(() => canvasStyleStore.set(toStyle(CANVAS_STYLE_PRESETS[1])));

    expect(screen.getByTestId(`canvas-style-preset-${CANVAS_STYLE_PRESETS[1].id}`).getAttribute("aria-pressed")).toBe("true");
  });
});
