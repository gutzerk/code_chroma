import { describe, expect, it } from "vitest";
import type { PlanStep } from "../state/types";
import { planStatusForKind, planStatusForSteps } from "./planStatus";

const step = (kind: PlanStep["kind"]): PlanStep => ({ id: kind ?? "x", text: "", node_id: "n", kind });

describe("planStatusForKind", () => {
  it("buckets create and add as new, modify as change, delete as delete", () => {
    expect(planStatusForKind("create")).toBe("new");
    expect(planStatusForKind("add")).toBe("new");
    expect(planStatusForKind("modify")).toBe("change");
    expect(planStatusForKind("delete")).toBe("delete");
  });

  it("defaults an absent kind to change", () => {
    expect(planStatusForKind(undefined)).toBe("change");
  });
});

describe("planStatusForSteps", () => {
  it("picks the highest-priority status across a node's steps (delete > new > change)", () => {
    expect(planStatusForSteps([step("modify"), step("add")])).toBe("new");
    expect(planStatusForSteps([step("add"), step("delete")])).toBe("delete");
    expect(planStatusForSteps([step("modify")])).toBe("change");
  });
});
