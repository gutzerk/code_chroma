import { beforeEach, describe, expect, it } from "vitest";
import { diagramAccent } from "../doc/diagramDisplay";
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
  it.each(["c1", "patterns", "impact", "epics", "sequence", "custom/abc", "feature-plan/x", "freeform"])(
    "matches the canvas frame accent for %s",
    (layer) => {
      expect(colorForLayer(layer)).toBe(diagramAccent(layer).color);
    },
  );
});
