import { describe, expect, it } from "vitest";
import { fetchBranchChoices, requestBranchWorkspace } from "./branchBridge";

function reply(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("requestBranchWorkspace", () => {
  it("returns the new workspace record when the bridge opens the branch", async () => {
    const record = { id: "br_feature-x", branch: "feature-x", worktree: "/w/br_feature-x" };

    const outcome = await requestBranchWorkspace("http://b", { branch: "feature-x" }, reply(200, record));

    expect(outcome).toEqual({ kind: "opened", record });
  });

  it("reports the holder when the branch is already open elsewhere", async () => {
    const detail = { message: "branch 'x' is already open in main", workspace: "main" };

    const outcome = await requestBranchWorkspace("http://b", { branch: "x" }, reply(409, { detail }));

    expect(outcome).toEqual({ kind: "held", workspace: "main", message: detail.message });
  });

  it("surfaces git's own message for any other refusal", async () => {
    const outcome = await requestBranchWorkspace(
      "http://b",
      { newBranch: "bad name" },
      reply(409, { detail: "'bad name' is not a valid branch name" }),
    );

    expect(outcome).toEqual({ kind: "failed", message: "'bad name' is not a valid branch name" });
  });

  it("sends a new branch as new_branch with its start point", async () => {
    let sent = "";
    const spy = (async (_url: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await requestBranchWorkspace("http://b", { newBranch: "task", startPoint: "main" }, spy);

    expect(JSON.parse(sent)).toEqual({ new_branch: "task", start_point: "main" });
  });

  it("turns a network failure into a failed outcome instead of throwing", async () => {
    const down = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;

    const outcome = await requestBranchWorkspace("http://b", { branch: "x" }, down);

    expect(outcome).toEqual({ kind: "failed", message: "connect ECONNREFUSED" });
  });
});

describe("fetchBranchChoices", () => {
  it("returns the bridge's branch list", async () => {
    const choices = { current: "main", branches: [{ name: "main", open: true, workspace: "main" }] };

    expect(await fetchBranchChoices("http://b", reply(200, choices))).toEqual(choices);
  });

  it("throws when the bridge refuses", async () => {
    await expect(fetchBranchChoices("http://b", reply(500, {}))).rejects.toThrow(/500/);
  });
});
