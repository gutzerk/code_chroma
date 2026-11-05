import { describe, expect, it } from "vitest";
import type { AgentStatus, CanonicalAgentStatus } from "../state/types";
import { effectiveStatus, normalizeAgentStatus, rollup, statusPriority } from "./statusRollup";

describe("statusPriority", () => {
  it("orders blocked > error > done > working > idle > stopped", () => {
    const order: CanonicalAgentStatus[] = ["blocked", "error", "done", "working", "idle", "stopped"];

    const priorities = order.map(statusPriority);

    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
  });
});

describe("normalizeAgentStatus", () => {
  it.each<[AgentStatus, number | null, CanonicalAgentStatus]>([
    ["running", null, "idle"],
    ["foreign", null, "idle"],
    ["exited", 0, "stopped"],
    ["exited", null, "stopped"],
    ["exited", 1, "error"],
    ["done", null, "done"],
    ["blocked", null, "blocked"],
  ])("maps %s (exit %s) to %s", (status, exitCode, expected) => {
    expect(normalizeAgentStatus(status, exitCode)).toBe(expected);
  });
});

describe("effectiveStatus", () => {
  it("raises a live agent with an open question to blocked", () => {
    expect(effectiveStatus({ status: "working", exit_code: null }, 1)).toBe("blocked");
  });

  it("leaves a stopped agent stopped even with a leftover question", () => {
    expect(effectiveStatus({ status: "stopped", exit_code: null }, 2)).toBe("stopped");
  });

  it("keeps the wire status when nothing is asked", () => {
    expect(effectiveStatus({ status: "done", exit_code: null }, 0)).toBe("done");
  });
});

describe("rollup", () => {
  it("picks the most urgent status and counts blocked, error and done", () => {
    expect(rollup(["working", "done", "blocked", "idle", "error"])).toEqual({ top: "blocked", count: 3 });
  });

  it("shows working without a count", () => {
    expect(rollup(["idle", "working", "stopped"])).toEqual({ top: "working", count: 0 });
  });

  it("shows nothing for idle and stopped agents", () => {
    expect(rollup(["idle", "stopped"])).toEqual({ top: null, count: 0 });
  });

  it("shows nothing for no agents", () => {
    expect(rollup([])).toEqual({ top: null, count: 0 });
  });

  it("drops done on the tab the user is already on", () => {
    expect(rollup(["done", "working"], { hideDone: true })).toEqual({ top: "working", count: 0 });
  });
});
