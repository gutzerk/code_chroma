import { beforeEach, describe, expect, it } from "vitest";
import { colorForLayer } from "./diagramColors";
import { diagramSelectionStore } from "./diagramSelectionStore";

beforeEach(() => diagramSelectionStore.reset());

describe("diagramSelectionStore", () => {
  it("toggles a layer on and off", () => {
    diagramSelectionStore.toggle("c1");
    const afterOn = [...diagramSelectionStore.getSelected()];
    diagramSelectionStore.toggle("c1");

    expect(afterOn).toEqual(["c1"]);
    expect(diagramSelectionStore.getSelected()).toEqual([]);
  });

  it("prunes layers that no longer exist", () => {
    diagramSelectionStore.toggle("c1");
    diagramSelectionStore.toggle("patterns");

    diagramSelectionStore.prune(["patterns"]);

    expect(diagramSelectionStore.getSelected()).toEqual(["patterns"]);
  });
});

describe("colorForLayer", () => {
  it("is deterministic and a hex colour", () => {
    expect(colorForLayer("c1")).toBe(colorForLayer("c1"));
    expect(colorForLayer("c1")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
