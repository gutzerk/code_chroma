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

  it("shares the target's workspace when attachTo names main, but has its own when attachTo is absent", async () => {
    const client = new MockAgentClient();

    const attached = await client.create("fix", "claude", "main");
    const own = await client.create("own");

    expect(attached.shares_workspace_with).toBe("main");
    expect(own.shares_workspace_with).toBeNull();
  });

  it("still throws unknown attach_to for an id that is neither main, an agent, nor an open PR", async () => {
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
});
