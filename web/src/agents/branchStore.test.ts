import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { branchStore } from "./branchStore";

beforeEach(() => {
  branchStore.reset();
});

afterEach(() => {
  branchStore.reset();
});

describe("branchStore", () => {
  it("starts with no branch known, before the first GET /agents/branch resolves", () => {
    expect(branchStore.getCurrent()).toBeNull();
    expect(branchStore.getBranches()).toEqual([]);
  });

  it("records what the bridge reports", () => {
    branchStore.setBranch({ current: "main", branches: ["main", "feature-x"] });

    expect(branchStore.getCurrent()).toBe("main");
    expect(branchStore.getBranches()).toEqual(["main", "feature-x"]);
  });

  it("notifies subscribers on every update", () => {
    let notified = 0;
    const unsubscribe = branchStore.subscribe(() => {
      notified += 1;
    });

    branchStore.setBranch({ current: "feature-x", branches: ["main", "feature-x"] });
    unsubscribe();

    expect(notified).toBe(1);
  });

  it("reset clears both fields, e.g. between tests", () => {
    branchStore.setBranch({ current: "main", branches: ["main"] });

    branchStore.reset();

    expect(branchStore.getCurrent()).toBeNull();
    expect(branchStore.getBranches()).toEqual([]);
  });
});
