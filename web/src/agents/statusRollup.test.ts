import { describe, expect, it } from "vitest";
import type { AgentStatus } from "../state/types";
import { effectiveStatus, normalizeAgentStatus, rollup } from "./statusRollup";

describe("normalizeAgentStatus", () => {
  it.each<[string, number | null, AgentStatus]>([
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
    expect(effectiveStatus({ status: "working" }, 1)).toBe("blocked");
  });

  it("leaves a stopped agent stopped even with a leftover question", () => {
    expect(effectiveStatus({ status: "stopped" }, 2)).toBe("stopped");
  });

  it("keeps the wire status when nothing is asked", () => {
    expect(effectiveStatus({ status: "done" }, 0)).toBe("done");
  });
});

describe("rollup", () => {
  it("picks the most urgent status and counts blocked, error and done", () => {
    expect(rollup(["working", "done", "blocked", "idle", "error", "blocked"])).toEqual({
      top: "blocked",
      count: 4,
      counts: { blocked: 2, error: 1, done: 1 },
    });
  });

  it("orders blocked > error > done > working", () => {
    expect([
      rollup(["error", "blocked"]).top,
      rollup(["done", "error"]).top,
      rollup(["working", "done"]).top,
    ]).toEqual(["blocked", "error", "done"]);
  });

  it("shows working without a count", () => {
    expect(rollup(["idle", "working", "stopped"])).toMatchObject({ top: "working", count: 0 });
  });

  it("shows nothing for idle and stopped agents", () => {
    expect(rollup(["idle", "stopped"])).toMatchObject({ top: null, count: 0 });
  });

  it("shows nothing for no agents", () => {
    expect(rollup([])).toMatchObject({ top: null, count: 0 });
  });

  it("drops done on the tab the user is already on", () => {
    expect(rollup(["done", "working"], { hideDone: true })).toMatchObject({ top: "working", count: 0 });
  });
});
