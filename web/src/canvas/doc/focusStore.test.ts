import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_CANVAS_DOC, type CanvasDoc } from "../../state/types";
import { focusStore } from "./focusStore";
import { neighboursOf } from "./focusNeighbors";

const edge = (id: string, from: string, to: string) => ({ id, from, to, label: "", kind: "", layer: "l" });
const doc: CanvasDoc = {
  ...EMPTY_CANVAS_DOC,
  edges: { e1: edge("e1", "a", "b"), e2: edge("e2", "b", "c"), e3: edge("e3", "x", "y") },
};

describe("focus", () => {
  beforeEach(() => focusStore.clear());

  it("splits neighbours into callers and callees", () => {
    expect(neighboursOf(doc, "b")).toEqual({ calledBy: ["a"], uses: ["c"] });
  });

  it("lights self and direct neighbours and dims the rest", () => {
    focusStore.toggle(doc, "b");

    expect(focusStore.stateOf("b")).toBe("self");
    expect(focusStore.stateOf("a")).toBe("lit");
    expect(focusStore.stateOf("c")).toBe("lit");
    expect(focusStore.stateOf("x")).toBe("dim");
  });

  it("upstream keeps callers only, and a second click clears", () => {
    focusStore.toggle(doc, "b");
    focusStore.setDirection(doc, "upstream");

    expect(focusStore.stateOf("c")).toBe("dim");
    expect(focusStore.stateOf("a")).toBe("lit");

    focusStore.toggle(doc, "b");
    expect(focusStore.stateOf("x")).toBe("none");
  });

  it("ignores a click on a block with no edges", () => {
    focusStore.toggle(doc, "lonely");

    expect(focusStore.current()).toBeNull();
  });

  it("clears the focus when an edgeless block is clicked", () => {
    focusStore.toggle(doc, "b");

    focusStore.toggle(doc, "lonely");

    expect(focusStore.current()).toBeNull();
  });

  it("recomputes the lit set when the doc gains an edge", () => {
    focusStore.toggle(doc, "b");
    const grown: CanvasDoc = { ...doc, edges: { ...doc.edges, e4: edge("e4", "b", "x") } };

    focusStore.refresh(grown);

    expect(focusStore.stateOf("x")).toBe("lit");
  });
});
