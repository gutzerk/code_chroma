import { describe, expect, it } from "vitest";
import type { CanvasElement } from "../../state/types";
import { DEFAULT_PROFILE, layersWithProfile, profileFor, profileForElement, profileViewsVersion, subscribeProfileViews } from "./diagramProfiles";
import { sequenceViewStore } from "./sequenceViewStore";
import { WALKTHROUGH_PROFILE } from "./walkthroughProfile";

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

describe("layersWithProfile", () => {
  it("buckets per layer only the elements whose profile passes, with that profile", () => {
    const elements = [
      el({ id: "s1", layer: "flow", render: "sequence" }),
      el({ id: "s2", layer: "flow", render: "sequence" }),
      el({ id: "c1", layer: "custom/x" }),
    ];

    const layers = layersWithProfile(elements, "Board");

    expect([...layers].map(([layer, { profile, ids }]) => [layer, profile.id, ids])).toEqual([["flow", "sequence", ["s1", "s2"]]]);
  });
});

describe("WALKTHROUGH_PROFILE edges", () => {
  it.each([
    ["call", "route"],
    ["spawn", "route"],
    ["data", undefined],
  ] as const)("gives a %s arrow the %s head", (visual, marker) => {
    const result = WALKTHROUGH_PROFILE.edgeMarker?.(visual);

    expect(result).toBe(marker);
  });

  it("draws only an authored label, never the kind word", () => {
    const edges = [{ label: "", kind: "calls" }, { label: "on save", kind: "calls" }];

    const labels = edges.map((edge) => WALKTHROUGH_PROFILE.edgeLabel?.(edge));

    expect(labels).toEqual(["", "on save"]);
  });

  it("keeps the members' own bounds (null) when the layer names no route", () => {
    const base = { left: 0, top: 0, right: 100, bottom: 50 };

    const bounds = WALKTHROUGH_PROFILE.frameBounds?.(base, { layer: "walkthrough", members: [], route: undefined });

    expect(bounds).toBeNull();
  });
});

describe("profile view signal", () => {
  it("notifies and changes version when a sequence step expands, but not when the player steps", () => {
    const calls: number[] = [];
    const unsubscribe = subscribeProfileViews(() => calls.push(1));
    const start = profileViewsVersion();
    sequenceViewStore.setStep("seq", 1);
    const afterStep = profileViewsVersion();

    sequenceViewStore.setExpanded("seq", ["m1"]);
    const afterExpand = profileViewsVersion();
    unsubscribe();
    sequenceViewStore.reset();

    expect([afterStep === start, afterExpand === start, calls.length]).toEqual([true, false, 2]);
  });
});
