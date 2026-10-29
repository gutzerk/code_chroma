import { describe, expect, it } from "vitest";
import type { CanvasElement } from "../../state/types";
import { DEFAULT_PROFILE, profileFor, profileForElement } from "./diagramProfiles";

function el(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: "a",
    render: "custom",
    layer: "custom/x",
    label: "A",
    description: "",
    node_id: null,
    position: { x: 0, y: 0 },
    size: null,
    group_id: null,
    meta: {},
    created_by: "ai",
    ...overrides,
  };
}

describe("profileFor", () => {
  it("picks the walkthrough profile by layer name", () => {
    const members = [el({ layer: "walkthrough" })];

    const profile = profileFor("walkthrough", members);

    expect(profile.id).toBe("walkthrough");
  });

  it("picks the sequence profile when any member renders as a sequence, whatever the layer is named", () => {
    const members = [el({ layer: "checkout-flow" }), el({ id: "b", layer: "checkout-flow", render: "sequence" })];

    const profile = profileFor("checkout-flow", members);

    expect(profile.id).toBe("sequence");
  });

  it("falls back to the default profile otherwise", () => {
    const members = [el()];

    const profile = profileFor("custom/x", members);

    expect(profile).toBe(DEFAULT_PROFILE);
  });

  it("looks one box up by its own layer and render", () => {
    const box = el({ layer: "checkout-flow", render: "sequence" });

    const profile = profileForElement(box);

    expect(profile.id).toBe("sequence");
  });
});
