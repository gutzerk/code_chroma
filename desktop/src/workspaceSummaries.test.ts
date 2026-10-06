import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listWorkspacesForRepo } from "./workspaceSummaries";

let repoPath: string;

beforeEach(() => {
  repoPath = mkdtempSync(join(tmpdir(), "codechroma-workspaces-"));
});

afterEach(() => {
  rmSync(repoPath, { recursive: true, force: true });
});

function writeCodechromaFile(name: string, content: unknown): void {
  const dir = join(repoPath, ".codechroma");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(content), "utf8");
}

describe("listWorkspacesForRepo", () => {
  it("returns an empty list when neither file exists", () => {
    expect(listWorkspacesForRepo(repoPath)).toEqual([]);
  });

  it("returns an empty list rather than throwing on a corrupt file", () => {
    writeCodechromaFile("agents.json", "{not json");

    expect(listWorkspacesForRepo(repoPath)).toEqual([]);
  });

  it("lists agents by id and title", () => {
    writeCodechromaFile("agents.json", [{ id: "agent-1", title: "Feature Auth" }]);

    expect(listWorkspacesForRepo(repoPath)).toEqual([{ id: "agent-1", label: "Feature Auth" }]);
  });

  it("lists PRs as pr-<number>, including the title when present", () => {
    writeCodechromaFile("prs.json", [
      { number: 42, title: "Fix login bug" },
      { number: 7 },
    ]);

    expect(listWorkspacesForRepo(repoPath)).toEqual([
      { id: "pr-42", label: "PR #42: Fix login bug" },
      { id: "pr-7", label: "PR #7" },
    ]);
  });

  it("combines agents and PRs, agents first", () => {
    writeCodechromaFile("agents.json", [{ id: "agent-1", title: "Feature Auth" }]);
    writeCodechromaFile("prs.json", [{ number: 42, title: "Fix login bug" }]);

    expect(listWorkspacesForRepo(repoPath)).toEqual([
      { id: "agent-1", label: "Feature Auth" },
      { id: "pr-42", label: "PR #42: Fix login bug" },
    ]);
  });

  it("skips malformed entries instead of throwing", () => {
    writeCodechromaFile("agents.json", [{ id: "agent-1" }, { title: "No id" }, "not an object"]);

    expect(listWorkspacesForRepo(repoPath)).toEqual([]);
  });
});
