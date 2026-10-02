import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRecord } from "../state/types";
import { agentStore, clampToViewport, initialWorkspace } from "./agentStore";

function agent(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    title: id,
    kind: "claude",
    branch: `agent/${id}`,
    base_branch: "main",
    worktree: `/tmp/worktrees/${id}`,
    created_at: "2026-07-28T10:00:00Z",
    session_id: null,
    pr_url: null,
    pid: null,
    window: { x: 100, y: 100, width: 720, height: 480, minimized: false, z: 1 },
    status: "stopped",
    exit_code: null,
    worktree_lost: false,
    ...overrides,
  };
}

beforeEach(() => {
  agentStore.reset();
});

describe("agentStore", () => {
  it("reconciles an agent-added event by inserting the card", () => {
    agentStore.upsert(agent("refund-flow"));

    expect(agentStore.getAgents().map((entry) => entry.id)).toEqual(["refund-flow"]);
  });

  it("replaces rather than duplicates a card it already knows", () => {
    agentStore.upsert(agent("refund-flow"));
    agentStore.upsert(agent("refund-flow", { title: "renamed" }));

    expect(agentStore.getAgents()).toHaveLength(1);
    expect(agentStore.getAgents()[0].title).toBe("renamed");
  });

  it("reconciles an agent-removed event", () => {
    agentStore.upsert(agent("refund-flow"));
    agentStore.remove("refund-flow");

    expect(agentStore.getAgents()).toEqual([]);
  });

  it("falls back to the main workspace when the active agent is removed", () => {
    agentStore.upsert(agent("refund-flow"));
    agentStore.setActiveWorkspace("refund-flow");
    agentStore.remove("refund-flow");

    expect(agentStore.getActiveWorkspace()).toBe("main");
  });

  it("applies a status change without touching the rest of the card", () => {
    agentStore.upsert(agent("refund-flow", { title: "refund flow" }));
    agentStore.setStatus("refund-flow", "blocked");

    expect(agentStore.getAgent("refund-flow")?.status).toBe("blocked");
    expect(agentStore.getAgent("refund-flow")?.title).toBe("refund flow");
  });

  it("merges a window patch instead of replacing the geometry", () => {
    agentStore.upsert(agent("refund-flow"));
    agentStore.setWindow("refund-flow", { minimized: true });

    expect(agentStore.getAgent("refund-flow")?.window).toMatchObject({
      x: 100,
      minimized: true,
    });
  });

  it("raises a window above every other one", () => {
    agentStore.upsert(agent("a", { window: { ...agent("a").window, z: 3 } }));
    agentStore.upsert(agent("b", { window: { ...agent("b").window, z: 7 } }));

    const raised = agentStore.bringToFront("a");

    expect(raised).toBe(8);
    expect(agentStore.getAgent("a")?.window.z).toBe(8);
  });

  it("reports capacity once the bridge's limit is reached", () => {
    agentStore.setList({
      agents: [agent("a"), agent("b")],
      active_workspace: "main",
      max_agents: 2,
    });

    expect(agentStore.getIsAtCapacity()).toBe(true);
  });

  it("preserves the z order the bridge restored", () => {
    agentStore.setList({
      agents: [
        agent("a", { window: { ...agent("a").window, z: 5 } }),
        agent("b", { window: { ...agent("b").window, z: 2 } }),
      ],
      active_workspace: "main",
      max_agents: 5,
    });

    expect(agentStore.getAgents().map((entry) => entry.window.z)).toEqual([5, 2]);
  });
});

describe("reclampToViewport", () => {
  it("re-clamps every window when the browser viewport shrinks in place, not just on load/upsert", () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    window.innerWidth = 2400;
    window.innerHeight = 1400;
    try {
      agentStore.upsert(
        agent("far", { window: { x: 2000, y: 1200, width: 720, height: 480, minimized: false, z: 1 } }),
      );

      window.innerWidth = 1024;
      window.innerHeight = 768;
      agentStore.reclampToViewport();

      const window_ = agentStore.getAgent("far")?.window;
      expect(window_?.x).toBeLessThan(2000);
      expect(window_?.y).toBeLessThan(1200);
    } finally {
      window.innerWidth = originalWidth;
      window.innerHeight = originalHeight;
    }
  });

  it("does nothing when every window already fits", () => {
    agentStore.upsert(agent("fits"));

    agentStore.reclampToViewport();

    expect(agentStore.getAgent("fits")?.window).toEqual(agent("fits").window);
  });
});

describe("clampToViewport", () => {
  it("pulls a window saved on a monitor that is no longer attached back on-screen", () => {
    const offScreen = agent("far", {
      window: { x: 4000, y: 3000, width: 720, height: 480, minimized: false, z: 1 },
    });

    const clamped = clampToViewport(offScreen, { width: 1280, height: 800 });

    expect(clamped.window.x).toBe(1160);
    expect(clamped.window.y).toBe(680);
  });

  it("shrinks a window wider than the viewport", () => {
    const huge = agent("huge", {
      window: { x: 0, y: 0, width: 3000, height: 2000, minimized: false, z: 1 },
    });

    const clamped = clampToViewport(huge, { width: 1280, height: 800 });

    expect(clamped.window.width).toBe(1280);
    expect(clamped.window.height).toBe(800);
  });

  it("returns the same object when nothing needs moving", () => {
    const fits = agent("fits");

    expect(clampToViewport(fits, { width: 1280, height: 800 })).toBe(fits);
  });
});

describe("the LED's input", () => {
  it("moves through the real status sequence a session produces", () => {
    agentStore.upsert(agent("refund-flow", { status: "stopped" }));

    const seen: string[] = [];
    for (const status of ["idle", "working", "blocked", "working", "idle"] as const) {
      agentStore.setStatus("refund-flow", status);
      seen.push(agentStore.getAgent("refund-flow")!.status);
    }

    expect(seen).toEqual(["idle", "working", "blocked", "working", "idle"]);
  });

  it("keeps a crashed agent distinguishable from a deliberately stopped one", () => {
    agentStore.upsert(agent("crashed", { status: "exited", exit_code: 1 }));

    expect(agentStore.getAgent("crashed")?.status).toBe("exited");
    expect(agentStore.getAgent("crashed")?.exit_code).toBe(1);
  });
});

describe("initialWorkspace", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("defaults to main when no workspace is named in the URL", () => {
    window.history.replaceState({}, "", "/");

    expect(initialWorkspace()).toBe("main");
  });

  it("reads a satellite window's workspace id from the ?workspace= query param", () => {
    window.history.replaceState({}, "", "/?workspace=pr-9");

    expect(initialWorkspace()).toBe("pr-9");
  });
});

describe("workspace switching", () => {
  it("routes the canvas at the workspace the user made active", () => {
    agentStore.upsert(agent("refund-flow"));
    agentStore.setActiveWorkspace("refund-flow");

    expect(agentStore.getActiveWorkspace()).toBe("refund-flow");
  });

  it("restores the workspace the bridge remembers on load", () => {
    agentStore.setList({
      agents: [agent("refund-flow")],
      active_workspace: "refund-flow",
      max_agents: 5,
    });

    expect(agentStore.getActiveWorkspace()).toBe("refund-flow");
  });

  it("switching does not touch any agent's status", () => {
    agentStore.setList({
      agents: [agent("a", { status: "working" }), agent("b", { status: "blocked" })],
      active_workspace: "main",
      max_agents: 5,
    });

    agentStore.setActiveWorkspace("a");

    expect(agentStore.getAgents().map((entry) => entry.status)).toEqual(["working", "blocked"]);
  });
});

describe("launchAgent's store-side state", () => {
  it("publishes and clears a blocked git preflight", () => {
    agentStore.setGitPreflight({ state: "no-git", root: "/repo" });

    expect(agentStore.getGitPreflight()).toEqual({ state: "no-git", root: "/repo" });

    agentStore.setGitPreflight(null);

    expect(agentStore.getGitPreflight()).toBeNull();
  });

  it("publishes and clears a launch error", () => {
    agentStore.setLaunchError("the limit of 5 concurrent agents is reached");

    expect(agentStore.getLaunchError()).toBe("the limit of 5 concurrent agents is reached");

    agentStore.setLaunchError(null);

    expect(agentStore.getLaunchError()).toBeNull();
  });
});
