import { describe, expect, it } from "vitest";
import { aboutMessage, windowTitle } from "./appVersion";

describe("windowTitle", () => {
  it.each([
    ["0.12.1", undefined, "CodeChroma 0.12.1"],
    ["v0.12.1", undefined, "CodeChroma 0.12.1"],
    ["0.12.1", "repo [Main]", "repo [Main] - CodeChroma 0.12.1"],
    ["", undefined, "CodeChroma"],
  ])("windowTitle(%s, %s)", (version, tab, expected) => expect(windowTitle(version, tab)).toBe(expected));
});

describe("aboutMessage", () => {
  it("names the product, version and the project page", () => {
    expect(aboutMessage("0.12.1")).toMatchObject({ title: "About CodeChroma", detail: expect.stringContaining("Version 0.12.1") });
    expect(aboutMessage("0.12.1").detail).toContain("https://github.com/gutzerk/code_chroma");
  });
});
