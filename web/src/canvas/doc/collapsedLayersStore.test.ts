import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetWorkspaceStores } from "../../state/createStore";
import { agentStore } from "../../agents/agentStore";
import { collapsedLayersStore } from "./collapsedLayersStore";

beforeEach(() => {
  window.localStorage.clear();
  collapsedLayersStore.reset();
  agentStore.setActiveWorkspace("main");
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

  it("persists a collapsed layer and restores it after a reload", () => {
    collapsedLayersStore.collapse("epics");

    // Simulate a page reload: the in-memory set clears and load() re-reads localStorage.
    collapsedLayersStore.reset();
    collapsedLayersStore.load();

    expect(collapsedLayersStore.isCollapsed("epics")).toBe(true);
  });

  it("a later collapse of another layer does not clobber a restored one", () => {
    // On a fresh page React mounts RootCanvas's collapse("hierarchy") effect before App's restore
    // (children before parents); that collapse persists alongside what was already in storage
    // instead of replacing it with just {hierarchy} -- the stored set must keep both.
    window.localStorage.setItem("codechroma.collapsedLayers.main", '["epics"]');

    collapsedLayersStore.load(); // App restore (constructor on a real reload)
    collapsedLayersStore.collapse("hierarchy"); // RootCanvas effect

    expect(collapsedLayersStore.isCollapsed("epics")).toBe(true);
    expect(collapsedLayersStore.isCollapsed("hierarchy")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("codechroma.collapsedLayers.main") as string)).toEqual(
      expect.arrayContaining(["epics", "hierarchy"]),
    );
  });

  it("keys storage to the active workspace", () => {
    collapsedLayersStore.collapse("c1");

    agentStore.setActiveWorkspace("agent-1");
    collapsedLayersStore.load();

    expect(collapsedLayersStore.isCollapsed("c1")).toBe(false);

    agentStore.setActiveWorkspace("main");
    collapsedLayersStore.load();

    expect(collapsedLayersStore.isCollapsed("c1")).toBe(true);
  });

  it("restores only on its own workspace's key, tolerating corrupt storage", () => {
    window.localStorage.setItem("codechroma.collapsedLayers.main", "{not json");
    window.localStorage.setItem("codechroma.collapsedLayers.agent-1", "[\"c1\"]");

    agentStore.setActiveWorkspace("agent-1");
    collapsedLayersStore.load();

    expect(collapsedLayersStore.isCollapsed("c1")).toBe(true);

    agentStore.setActiveWorkspace("main");
    collapsedLayersStore.load();

    expect(collapsedLayersStore.getCollapsed().size).toBe(0);
  });
});
