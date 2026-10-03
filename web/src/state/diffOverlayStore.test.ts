import { afterEach, describe, expect, it } from "vitest";
import { diffOverlayStore } from "./diffOverlayStore";
import { expansionStore } from "./expansionState";

afterEach(() => {
  diffOverlayStore.reset();
  expansionStore.reset();
});

describe("diffOverlayStore", () => {
  it("has no diff for a node and is inactive by default", () => {
    expect(diffOverlayStore.getDiff("function::foo")).toBeUndefined();
    expect(diffOverlayStore.getIsActive()).toBe(false);
  });

  it("stores diffs by node_id and marks itself active", () => {
    diffOverlayStore.write(
      [
        { node_id: "function::foo", original_source: "a", proposed_source: "b" },
        { node_id: "function::bar", original_source: "c", proposed_source: "d" },
      ],
      true,
    );

    expect(diffOverlayStore.getDiff("function::foo")).toEqual({
      node_id: "function::foo",
      original_source: "a",
      proposed_source: "b",
    });
    expect(diffOverlayStore.getDiff("function::bar")?.proposed_source).toBe("d");
    expect(diffOverlayStore.getIsActive()).toBe(true);
  });

  it("stays active even when a run finds zero changed functions", () => {
    diffOverlayStore.write([], true);

    expect(diffOverlayStore.getIsActive()).toBe(true);
  });

  it("fillDiffs stores diffs without flipping the visual Diff-mode flag (impact always-on)", () => {
    diffOverlayStore.write([
      { node_id: "function::foo", original_source: "a", proposed_source: "b" },
    ]);

    expect(diffOverlayStore.getDiff("function::foo")?.proposed_source).toBe("b");
    expect(diffOverlayStore.getIsActive()).toBe(false);
  });

  it("clears every diff and marks itself inactive without touching code_visible", () => {
    diffOverlayStore.write(
      [{ node_id: "function::foo", original_source: "a", proposed_source: "b" }],
      true,
    );
    expansionStore.showCode("function::foo");

    diffOverlayStore.clear();

    expect(diffOverlayStore.getDiff("function::foo")).toBeUndefined();
    expect(diffOverlayStore.getIsActive()).toBe(false);
    expect(expansionStore.getBlockView("function::foo").code_visible).toBe(true);
  });
});
