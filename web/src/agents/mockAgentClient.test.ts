import { describe, expect, it } from "vitest";
import { MockAgentClient } from "./mockAgentClient";

describe("MockAgentClient.create", () => {
  it("forks a new branch and worktree when attachTo names an open PR", async () => {
    const client = new MockAgentClient();
    const pr = await client.openPr("#282");

    const agent = await client.create("fix", "claude", pr.id);

    expect(agent.worktree).not.toBe(pr.worktree);
    expect(agent.base_branch).toBe(pr.base_ref);
  });

  it("records the source PR when attachTo names an open PR", async () => {
    const client = new MockAgentClient();
    const pr = await client.openPr("#282");

    const agent = await client.create("fix", "claude", pr.id);

    expect(agent.source_pr).toBe(pr.id);
  });

  it("has no source PR for an agent created without attachTo", async () => {
    const client = new MockAgentClient();

    const agent = await client.create("fix");

    expect(agent.source_pr).toBeNull();
  });

  it("shares the target agent's workspace when attachTo names it, but has its own when attachTo is absent", async () => {
    const client = new MockAgentClient();

    const first = await client.create("first");
    const attached = await client.create("fix", "claude", first.id);
    const own = await client.create("own");

    expect(attached.shares_workspace_with).toBe(first.id);
    expect(own.shares_workspace_with).toBeNull();
  });

  it("still throws unknown attach_to for an id that is neither an agent, nor an open PR", async () => {
    const client = new MockAgentClient();

    await expect(client.create("fix", "claude", "nobody")).rejects.toThrow(
      "unknown attach_to: nobody",
    );
  });

  it("does not burn a counter value when a create() call fails", async () => {
    const client = new MockAgentClient();
    await expect(client.create("", "claude", "nobody")).rejects.toThrow("unknown attach_to");

    const agent = await client.create("");

    expect(agent.id).toBe("agent1");
  });

  it("refuses attachTo main and joins the tab's worktree when workspace is given", async () => {
    const client = new MockAgentClient();
    const { branch } = await client.createWorktree();

    const agent = await client.create("a", "claude", undefined, null, "view", undefined, branch.id);

    expect(agent.worktree).toBe(branch.worktree);
    await expect(client.create("b", "claude", "main")).rejects.toThrow("not allowed");
  });
});
