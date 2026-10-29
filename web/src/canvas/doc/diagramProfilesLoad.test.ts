// Must stay the first import: loading a profile before the registry is what a load-order cycle breaks.
import { WALKTHROUGH_PROFILE } from "./walkthroughProfile";
import { describe, expect, it } from "vitest";
import { diagramProfiles } from "./diagramProfiles";
import { SEQUENCE_PROFILE } from "./sequenceProfile";

describe("diagram profile load order", () => {
  it("defines the walkthrough overlay when a profile loads first", () => {
    const overlay = WALKTHROUGH_PROFILE.Overlay;

    expect(overlay).toBeDefined();
  });

  it("lists both profiles when a profile loads first", () => {
    const profiles = diagramProfiles();

    expect(profiles).toEqual([SEQUENCE_PROFILE, WALKTHROUGH_PROFILE]);
  });
});
