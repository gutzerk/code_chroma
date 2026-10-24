import { beforeEach, describe, expect, it } from "vitest";
import { layoutStore } from "./layoutStore";

beforeEach(() => layoutStore.reset());

describe("layoutStore", () => {
  it("starts with the left panel open and agents normal", () => {
    const state = layoutStore.getState();

    expect(state.leftOpen).toBe(true);
    expect(state.agentsMode).toBe("normal");
  });

  it("openLeft opens the panel on the given tab", () => {
    layoutStore.closeLeft();

    layoutStore.openLeft("diagrams");

    expect(layoutStore.getState()).toMatchObject({ leftOpen: true, leftTab: "diagrams" });
  });

  it("openLeft with a tab in full mode keeps full", () => {
    layoutStore.setAgentsMode("full");

    layoutStore.openLeft("diagrams");

    expect(layoutStore.getState()).toMatchObject({ leftOpen: true, leftTab: "diagrams", agentsMode: "full" });
  });

  it("toggleLeft flips the panel", () => {
    layoutStore.toggleLeft();

    expect(layoutStore.getState().leftOpen).toBe(false);
  });

  it("opening the left panel in full mode keeps full", () => {
    layoutStore.setAgentsMode("full");
    layoutStore.closeLeft();

    layoutStore.toggleLeft();

    expect(layoutStore.getState()).toMatchObject({ leftOpen: true, agentsMode: "full" });
  });

  it("entering full keeps the left panel open", () => {
    layoutStore.setAgentsMode("full");

    expect(layoutStore.getState()).toMatchObject({ leftOpen: true, agentsMode: "full" });
  });

  it("collapsing agents keeps the left panel open", () => {
    layoutStore.setAgentsMode("collapsed");

    expect(layoutStore.getState()).toMatchObject({ leftOpen: true, agentsMode: "collapsed" });
  });

  it("selectAgent stores the id and notifies subscribers", () => {
    let calls = 0;
    const unsubscribe = layoutStore.subscribe(() => (calls += 1));

    layoutStore.selectAgent("a2");
    unsubscribe();

    expect(layoutStore.getState().selectedAgentId).toBe("a2");
    expect(calls).toBe(1);
  });

  it("leaving full keeps a closed left panel closed", () => {
    layoutStore.setAgentsMode("full");
    layoutStore.closeLeft();

    layoutStore.setAgentsMode("normal");

    expect(layoutStore.getState()).toMatchObject({ leftOpen: false, agentsMode: "normal" });
  });

  it("reconcileAgents clears a selection whose agent is gone", () => {
    layoutStore.selectAgent("a2");

    layoutStore.reconcileAgents(["a1"]);

    expect(layoutStore.getState().selectedAgentId).toBeNull();
  });

  it("reconcileAgents keeps a live selection", () => {
    layoutStore.selectAgent("a1");

    layoutStore.reconcileAgents(["a1"]);

    expect(layoutStore.getState().selectedAgentId).toBe("a1");
  });

  it("toggleAgentsFull flips between normal and full", () => {
    layoutStore.toggleAgentsFull();
    const stretched = layoutStore.getState().agentsMode;
    layoutStore.toggleAgentsFull();

    expect(stretched).toBe("full");
    expect(layoutStore.getState().agentsMode).toBe("normal");
  });
});
