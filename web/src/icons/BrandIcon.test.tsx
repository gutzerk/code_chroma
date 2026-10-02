import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BrandIcon } from "./BrandIcon";

describe("BrandIcon", () => {
  it("renders a recognized brand's logo in its own brand color", () => {
    const { container } = render(<BrandIcon slug="stripe" />);

    const svg = container.querySelector(".c1-brand-icon-stripe");
    expect(svg).not.toBeNull();
    expect(svg?.querySelector("path")).toHaveAttribute("fill", "#635BFF");
  });

  it("renders nothing for an unrecognized slug, so the caller can fall back", () => {
    const { container } = render(<BrandIcon slug="not-a-real-brand" />);

    expect(container.firstChild).toBeNull();
  });
});
