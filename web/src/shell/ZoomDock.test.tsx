import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ZoomDock } from "./ZoomDock";

describe("ZoomDock", () => {
  it("shows the scale as a percent", () => {
    render(<ZoomDock scale={1.25} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onFitAll={vi.fn()} />);

    expect(screen.getByTestId("zoom-percent")).toHaveTextContent("125%");
  });

  it("calls the handlers from the buttons", () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onFitAll = vi.fn();
    render(<ZoomDock scale={1} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFitAll={onFitAll} />);

    fireEvent.click(screen.getByLabelText("Zoom in"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    fireEvent.click(screen.getByTestId("fit-all-button"));

    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onFitAll).toHaveBeenCalledOnce();
  });
});
