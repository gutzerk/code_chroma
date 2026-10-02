import { afterEach, describe, expect, it, vi } from "vitest";
import { hoveredEdgeStore } from "./hoveredEdgeStore";

afterEach(() => hoveredEdgeStore.reset());

describe("hoveredEdgeStore", () => {
  it("starts with nothing hovered", () => {
    expect(hoveredEdgeStore.getHovered()).toBeNull();
    expect(hoveredEdgeStore.isHovering()).toBe(false);
  });

  it("records the hovered arrow and both of its endpoints", () => {
    hoveredEdgeStore.setHovered({ key: "a->b-0", fromNodeId: "c1-system", toNodeId: "c1-actor::db" });

    expect(hoveredEdgeStore.isActive("a->b-0")).toBe(true);
    expect(hoveredEdgeStore.isEndpoint("c1-system")).toBe(true);
    expect(hoveredEdgeStore.isEndpoint("c1-actor::db")).toBe(true);
  });

  it("reports a block that is not an endpoint of the hovered arrow as inactive", () => {
    hoveredEdgeStore.setHovered({ key: "a->b-0", fromNodeId: "c1-system", toNodeId: "c1-actor::db" });

    expect(hoveredEdgeStore.isEndpoint("c1-actor::user")).toBe(false);
    expect(hoveredEdgeStore.isActive("b->c-1")).toBe(false);
  });

  it("treats an unresolved endpoint as matching no block rather than every block", () => {
    hoveredEdgeStore.setHovered({ key: "a->b-0", fromNodeId: null, toNodeId: null });

    expect(hoveredEdgeStore.isHovering()).toBe(true);
    expect(hoveredEdgeStore.isEndpoint("c1-system")).toBe(false);
  });

  it("notifies subscribers once per actual change", () => {
    const listener = vi.fn();
    hoveredEdgeStore.subscribe(listener);

    hoveredEdgeStore.setHovered({ key: "a->b-0", fromNodeId: "x", toNodeId: "y" });
    hoveredEdgeStore.setHovered({ key: "a->b-0", fromNodeId: "x", toNodeId: "y" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clears the hover when the arrow being left is the hovered one", () => {
    hoveredEdgeStore.setHovered({ key: "a->b-0", fromNodeId: "x", toNodeId: "y" });

    hoveredEdgeStore.clear("a->b-0");

    expect(hoveredEdgeStore.getHovered()).toBeNull();
  });

  it("ignores a clear from an arrow that is no longer the hovered one", () => {
    hoveredEdgeStore.setHovered({ key: "old", fromNodeId: "x", toNodeId: "y" });
    hoveredEdgeStore.setHovered({ key: "new", fromNodeId: "p", toNodeId: "q" });

    // Lanes put two arrows 14px apart, so the old arrow's pointerleave routinely lands after the new
    // arrow's pointerenter — an unguarded clear would leave the diagram dimmed with nothing active.
    hoveredEdgeStore.clear("old");

    expect(hoveredEdgeStore.getHovered()?.key).toBe("new");
  });

  it("activates every arrow touching a focused block", () => {
    hoveredEdgeStore.setFocusedNode("registry");

    expect(hoveredEdgeStore.isActive("a->b", "registry", "impl")).toBe(true);
    expect(hoveredEdgeStore.isActive("c->d", "facade", "impl")).toBe(false);
  });

  it("dims the rest of the diagram while a block is focused", () => {
    hoveredEdgeStore.setFocusedNode("registry");

    expect(hoveredEdgeStore.isHovering()).toBe(true);
    expect(hoveredEdgeStore.isEndpoint("registry")).toBe(true);
  });

  it("ignores a node clear from a block that is no longer focused", () => {
    hoveredEdgeStore.setFocusedNode("old");
    hoveredEdgeStore.setFocusedNode("new");

    hoveredEdgeStore.clearNode("old");

    expect(hoveredEdgeStore.isEndpoint("new")).toBe(true);
  });

  it("keeps pinned blocks' arrows active after the pointer leaves", () => {
    hoveredEdgeStore.setPinnedNodes(["registry", "facade"]);

    expect(hoveredEdgeStore.isActive("a->b", "registry", "impl")).toBe(true);
    expect(hoveredEdgeStore.isActive("c->d", "adapter", "impl")).toBe(false);
    expect(hoveredEdgeStore.isHovering()).toBe(true);
  });

  it("drops the pin when the selection empties", () => {
    hoveredEdgeStore.setPinnedNodes(["registry"]);

    hoveredEdgeStore.setPinnedNodes([]);

    expect(hoveredEdgeStore.isHovering()).toBe(false);
  });

  it("does not notify when the pinned set is unchanged", () => {
    hoveredEdgeStore.setPinnedNodes(["a", "b"]);
    const listener = vi.fn();
    hoveredEdgeStore.subscribe(listener);

    hoveredEdgeStore.setPinnedNodes(["a", "b"]);

    expect(listener).not.toHaveBeenCalled();
  });

  it("treats a null endpoint as matching no focused block", () => {
    hoveredEdgeStore.setFocusedNode("registry");

    expect(hoveredEdgeStore.isActive("a->b", null, null)).toBe(false);
  });
});
