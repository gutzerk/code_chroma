import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
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
});
