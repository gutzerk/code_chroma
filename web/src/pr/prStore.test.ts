import { afterEach, describe, expect, it } from "vitest";
import { prStore } from "./prStore";
import type { PrWorkspace } from "../state/types";

function pr(number: number): PrWorkspace {
  return {
    id: `pr-${number}`,
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    author: "octocat",
    state: "OPEN",
    head_ref: "feature/refunds",
    head_sha: "abc1234",
    head_repo: "octocat/app",
    is_fork: false,
    base_ref: "main",
    worktree: `/repo/.codechroma/worktrees/pr-${number}`,
    imported_at: "2026-07-29T12:00:00Z",
    fetched_at: "2026-07-29T12:00:00Z",
    changed_files: 3,
    additions: 4,
    deletions: 1,
    worktree_lost: false,
  };
}

afterEach(() => {
  prStore.reset();
});

describe("prStore", () => {
  it("starts empty and knows no workspace", () => {
    expect(prStore.getAll()).toEqual([]);
    expect(prStore.has("pr-7")).toBe(false);
  });

  it("returns a stable empty array so useSyncExternalStore doesn't loop", () => {
    expect(prStore.getAll()).toBe(prStore.getAll());
  });

  it("records a list and indexes it by workspace id", () => {
    prStore.setList([pr(7), pr(12)]);

    expect(prStore.has("pr-7")).toBe(true);
    expect(prStore.has("pr-12")).toBe(true);
    expect(prStore.has("pr-99")).toBe(false);
  });

  it("upserts a new review newest-first", () => {
    prStore.setList([pr(7)]);

    prStore.upsert(pr(12));

    expect(prStore.getAll().map((entry) => entry.number)).toEqual([12, 7]);
  });

  it("upserting an open review replaces it rather than duplicating it", () => {
    prStore.setList([pr(7)]);

    prStore.upsert({ ...pr(7), head_sha: "def5678" });

    expect(prStore.getAll()).toHaveLength(1);
    expect(prStore.getAll()[0].head_sha).toBe("def5678");
  });

  it("removing a review forgets its id too", () => {
    prStore.setList([pr(7), pr(12)]);

    prStore.remove("pr-7");

    expect(prStore.has("pr-7")).toBe(false);
    expect(prStore.getAll().map((entry) => entry.number)).toEqual([12]);
  });

  it("notifies subscribers on every change", () => {
    let notifications = 0;
    prStore.subscribe(() => notifications++);

    prStore.setList([pr(7)]);
    prStore.remove("pr-7");

    expect(notifications).toBe(2);
  });

  it("resets to empty", () => {
    prStore.setList([pr(7)]);

    prStore.reset();

    expect(prStore.getAll()).toEqual([]);
    expect(prStore.has("pr-7")).toBe(false);
  });
});
