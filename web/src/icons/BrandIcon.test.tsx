import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { BrandIcon } from "./BrandIcon";

describe("BrandIcon", () => {
  it("renders a recognized brand's logo in its own brand color by default", () => {
    const { container } = render(<BrandIcon slug="stripe" />);

    const svg = container.querySelector(".c1-brand-icon-stripe");
    expect(svg).not.toBeNull();
    expect(svg?.querySelector("path")).toHaveAttribute("fill", "#635BFF");
  });

  it("renders nothing for an unrecognized slug, so the caller can fall back", () => {
    const { container } = render(<BrandIcon slug="not-a-real-brand" />);

    expect(container.firstChild).toBeNull();
  });

  it("renders a lobe-icons brand (claude) that simple-icons withdrew, in its brand color", () => {
    const { container } = render(<BrandIcon slug="claude" />);

    const svg = container.querySelector(".c1-brand-icon-claude");
    expect(svg).not.toBeNull();
    expect(svg?.querySelector("path")).toHaveAttribute("fill", "#D97757");
  });

  it("flips a near-black lobe brand (ollama) to white on a dark block, so it stays visible", () => {
    const { container } = render(
      <div className="diagram-node-box" style={{ backgroundColor: "#1b1d23" }}>
        <BrandIcon slug="ollama" />
      </div>,
    );
    // Ollama #000000 on near-black #1b1d23: contrast < 2.2, so the logo turns white.
    act(() => {});
    expect(container.querySelector(".c1-brand-icon path")).toHaveAttribute("fill", "#ffffff");
  });

  it("keeps the brand color when the block background contrasts enough", () => {
    const { container } = render(
      <div className="diagram-node-box" style={{ backgroundColor: "#1b1d23" }}>
        <BrandIcon slug="stripe" />
      </div>,
    );
    // Stripe #635BFF on near-black #1b1d23: contrast is high, so the brand purple stays.
    act(() => {});
    expect(container.querySelector(".c1-brand-icon path")).toHaveAttribute("fill", "#635BFF");
  });

  it("flips to white on a dark block whose fill is a near-black brand, so it stays visible", () => {
    const { container } = render(
      <div className="diagram-node-box" style={{ backgroundColor: "#1b1d23" }}>
        <BrandIcon slug="anthropic" />
      </div>,
    );
    // Anthropic #191919 on near-black #1b1d23: both are dark, contrast < 2.2, so the logo turns white.
    act(() => {});
    expect(container.querySelector(".c1-brand-icon path")).toHaveAttribute("fill", "#ffffff");
  });

  it("flips to near-black on a light block from a same-toned (light) brand, so it stays visible", () => {
    const { container } = render(
      <div className="diagram-node-box" style={{ backgroundColor: "#f8fafc" }}>
        <BrandIcon slug="newrelic" />
      </div>,
    );
    // New Relic #1CE783 is a light green; on a light #f8fafc block both are light (contrast < 2.2),
    // so the logo flips to near-black instead of vanishing.
    act(() => {});
    expect(container.querySelector(".c1-brand-icon path")).toHaveAttribute("fill", "#111111");
  });
});
