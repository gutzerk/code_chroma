import { afterEach, describe, expect, it } from "vitest";
import { revealDiffEntry } from "./revealDiffEntry";
import { expansionStore } from "./expansionState";

afterEach(() => {
  expansionStore.reset();
});

describe("revealDiffEntry", () => {
  it("expands a file container (so its class/function children stay visible) without showing its code", () => {
    revealDiffEntry({
      node_id: "file::guards.py",
      status: "added",
      level: "file",
      original_source: "",
      proposed_source: "class MetadataKey: ...",
    });

    expect(expansionStore.isVisible("file::guards.py")).toBe(true);
    expect(expansionStore.getBlockView("file::guards.py").code_visible).toBe(false);
  });

  it("shows the code for a class (including a method-less enum) rather than expanding it", () => {
    revealDiffEntry({
      node_id: "class::MetadataKey",
      status: "added",
      level: "class",
      original_source: "",
      proposed_source: "class MetadataKey(Enum): ...",
    });

    expect(expansionStore.getBlockView("class::MetadataKey").code_visible).toBe(true);
    expect(expansionStore.isVisible("class::MetadataKey")).toBe(false);
  });

  it("shows the code for a function", () => {
    revealDiffEntry({
      node_id: "function::slugify",
      original_source: "a",
      proposed_source: "b",
    });

    expect(expansionStore.getBlockView("function::slugify").code_visible).toBe(true);
  });
});
