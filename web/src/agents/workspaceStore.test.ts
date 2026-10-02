import { afterEach, describe, expect, it } from "vitest";
import { workspaceStore } from "./workspaceStore";
import { agentStore } from "./agentStore";
import { prStore } from "../pr/prStore";
import type { PrWorkspace, WorkspaceStatus } from "../state/types";

function status(id: string, overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return { id, state: "ready", progress: "", error: null, ...overrides };
}

function pr(number: number): PrWorkspace {
  return {
    id: `pr-${number}`,
    number,
    title: `PR ${number}`,
    url: "",
    author: "",
    state: "OPEN",
    head_ref: "feature/x",
    head_sha: "abc",
    head_repo: "",
    is_fork: false,
    base_ref: "main",
    worktree: "/wt",
    imported_at: "",
    fetched_at: "",
    changed_files: 0,
    additions: 0,
    deletions: 0,
    worktree_lost: false,
  };
}

afterEach(() => {
  workspaceStore.reset();
  prStore.reset();
  agentStore.reset();
});

describe("workspaceStore", () => {
  it("has nothing to report before the bridge has answered", () => {
    expect(workspaceStore.getStatus("main")).toBeUndefined();
    expect(workspaceStore.getIsReadOnly("main")).toBe(false);
  });

  it("records what the bridge said about a workspace", () => {
    workspaceStore.setStatus(status("pr-7", { read_only: true, state: "analyzing" }));

    expect(workspaceStore.getStatus("pr-7")?.state).toBe("analyzing");
  });

  it("treats an absent read_only as writable, so an older bridge keeps today's behaviour", () => {
    workspaceStore.setStatus(status("refund-flow"));

    expect(workspaceStore.getIsReadOnly("refund-flow")).toBe(false);
  });

  it("reads read-only off the flag", () => {
    workspaceStore.setStatus(status("pr-7", { read_only: true }));

    expect(workspaceStore.getIsReadOnly("pr-7")).toBe(true);
  });

  it("reads read-only off prStore membership alone, if the bridge forgot the flag", () => {
    prStore.setList([pr(7)]);
    workspaceStore.setStatus(status("pr-7"));

    expect(workspaceStore.getIsReadOnly("pr-7")).toBe(true);
  });

  it("main and an agent worktree are never read-only", () => {
    workspaceStore.setStatus(status("main"));
    workspaceStore.setStatus(status("refund-flow"));

    expect(workspaceStore.getIsReadOnly("main")).toBe(false);
    expect(workspaceStore.getIsReadOnly("refund-flow")).toBe(false);
  });

  it("does not treat an agent titled like a PR as read-only", () => {
    // The whole reason the signal travels in the payload rather than being parsed out of the id.
    workspaceStore.setStatus(status("pr-fixes"));

    expect(workspaceStore.getIsReadOnly("pr-fixes")).toBe(false);
  });

  it("notifies subscribers when a status lands", () => {
    let notifications = 0;
    workspaceStore.subscribe(() => notifications++);

    workspaceStore.setStatus(status("pr-7", { read_only: true }));

    expect(notifications).toBe(1);
  });

  it("resets to knowing nothing", () => {
    workspaceStore.setStatus(status("pr-7", { read_only: true }));

    workspaceStore.reset();

    expect(workspaceStore.getStatus("pr-7")).toBeUndefined();
  });
});
