import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EdgeLabel } from "./EdgeLabel";

// jsdom exposes no SVGTextElement constructor, so the stub goes on the shared SVGElement prototype.
const textProto = SVGElement.prototype as unknown as { getBBox?: () => DOMRect };

afterEach(() => {
  delete textProto.getBBox;
});

/** jsdom implements no getBBox, so stub one text extent for the chip to be measured from. */
function stubBBox(box: { x: number; y: number; width: number; height: number }) {
  textProto.getBBox = vi.fn(() => box as DOMRect);
}

function renderLabel() {
  return render(
    <svg>
      <EdgeLabel x={100} y={50} text="Reads from" className="c1-relationship-label" />
    </svg>,
  );
}

describe("EdgeLabel", () => {
  it("fits an opaque chip around the caption's measured extent", () => {
    stubBBox({ x: 60, y: 42, width: 80, height: 16 });

    const { container } = renderLabel();

    const chip = container.querySelector(".connector-label-chip");
    expect(chip).toHaveAttribute("x", "56");
    expect(chip).toHaveAttribute("y", "40");
    expect(chip).toHaveAttribute("width", "88");
    expect(chip).toHaveAttribute("height", "20");
    // Strongly rounded sides — set inline so the frame reads as a pill, not a plain box.
    expect(chip).toHaveAttribute("rx", "8");
  });

  it("renders the caption itself with the class its renderer asked for", () => {
    stubBBox({ x: 60, y: 42, width: 80, height: 16 });

    const { container } = renderLabel();

    expect(container.querySelector("text")).toHaveClass("c1-relationship-label");
  });

  it("skips the chip when the text has no measurable extent", () => {
    stubBBox({ x: 0, y: 0, width: 0, height: 0 });

    const { container } = renderLabel();

    expect(container.querySelector(".connector-label-chip")).toBeNull();
  });

  it("still renders the caption where getBBox is unavailable", () => {
    const { container } = renderLabel();

    expect(container.querySelector("text")).toHaveTextContent("Reads from");
  });

  it("renders the transport as a second flagged row under the label when set", () => {
    stubBBox({ x: 40, y: 36, width: 120, height: 30 });

    const { container } = render(
      <svg>
        <EdgeLabel
          x={100}
          y={50}
          text="Requests node summaries"
          transport="https"
          className="c1-relationship-label"
        />
      </svg>,
    );

    const text = container.querySelector("text");
    expect(text).toHaveTextContent("Requests node summaries");
    expect(text).toHaveTextContent("https");
    expect(container.querySelector(".c1-relationship-label__divider")).not.toBeNull();
    expect(container.querySelector(".c1-relationship-label__transport")).not.toBeNull();
  });

  it("renders a single label row when transport is omitted", () => {
    stubBBox({ x: 60, y: 42, width: 80, height: 16 });

    const { container } = renderLabel();

    expect(container.querySelector(".c1-relationship-label__transport")).toBeNull();
    expect(container.querySelector(".c1-relationship-label__divider")).toBeNull();
  });

  it("stays a plain label (not a link) when no origin is set", () => {
    stubBBox({ x: 60, y: 42, width: 80, height: 16 });

    renderLabel();

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("becomes a clickable link with an origin, and opens it on click/Enter/Space", () => {
    stubBBox({ x: 60, y: 42, width: 80, height: 16 });
    const onOpenOrigin = vi.fn();

    const { container } = render(
      <svg>
        <EdgeLabel
          x={100}
          y={50}
          text="Reads from"
          className="c1-relationship-label"
          origin="src/a.py:12"
          onOpenOrigin={onOpenOrigin}
        />
      </svg>,
    );

    const link = container.querySelector("g.connector-label--link") as Element;
    expect(link).toHaveAttribute("role", "link");
    // The accessible name keeps the caption and appends the open action (does not replace it).
    expect(link).toHaveAttribute("aria-label", "Reads from — open src/a.py:12");

    fireEvent.click(link);
    // The chip is part of the link's hit area, not just the text glyphs.
    fireEvent.click(container.querySelector(".connector-label-chip") as Element);
    expect(onOpenOrigin).toHaveBeenCalledTimes(2);

    onOpenOrigin.mockClear();
    fireEvent.keyDown(link, { key: "Enter" });
    expect(onOpenOrigin).toHaveBeenCalledWith("src/a.py:12");

    onOpenOrigin.mockClear();
    fireEvent.keyDown(link, { key: " " });
    expect(onOpenOrigin).toHaveBeenCalledWith("src/a.py:12");
  });
});
