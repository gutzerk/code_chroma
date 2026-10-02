import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetWorkspaceStores } from "../../state/createStore";
import { collapsedLayersStore } from "./collapsedLayersStore";

beforeEach(() => {
  collapsedLayersStore.reset();
});

describe("collapsedLayersStore", () => {
  it("starts with nothing collapsed", () => {
    expect(collapsedLayersStore.isCollapsed("c1")).toBe(false);
    expect(collapsedLayersStore.getCollapsed().size).toBe(0);
  });

  it("collapses and expands a layer", () => {
    collapsedLayersStore.collapse("c1");

    expect(collapsedLayersStore.isCollapsed("c1")).toBe(true);

    collapsedLayersStore.expand("c1");

    expect(collapsedLayersStore.isCollapsed("c1")).toBe(false);
  });

  it("toggles a layer between collapsed and expanded", () => {
    collapsedLayersStore.toggle("c1");

    expect(collapsedLayersStore.isCollapsed("c1")).toBe(true);

    collapsedLayersStore.toggle("c1");

    expect(collapsedLayersStore.isCollapsed("c1")).toBe(false);
  });

  it("does not emit for a no-op collapse or expand", () => {
    const listener = vi.fn();
    collapsedLayersStore.subscribe(listener);

    collapsedLayersStore.expand("c1"); // already expanded

    expect(listener).not.toHaveBeenCalled();

    collapsedLayersStore.collapse("c1");
    collapsedLayersStore.collapse("c1"); // already collapsed

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("resets to nothing collapsed", () => {
    collapsedLayersStore.collapse("c1");
    collapsedLayersStore.collapse("patterns");

    collapsedLayersStore.reset();

    expect(collapsedLayersStore.getCollapsed().size).toBe(0);
  });

  it("participates in resetWorkspaceStores, unlike agentStore's exemption", () => {
    collapsedLayersStore.collapse("c1");

    resetWorkspaceStores();

    expect(collapsedLayersStore.isCollapsed("c1")).toBe(false);
  });
});
