import { describe, expect, it } from "vitest";
import { isFailureLane } from "./laneKind";

describe("isFailureLane", () => {
  it("is a failure lane when every member that sets a kind says failure", () => {
    expect(isFailureLane("Errors", ["failure", undefined])).toBe(true);
  });

  it("is not a failure lane when a member says normal, whatever its name", () => {
    expect(isFailureLane("Failures", ["normal", "normal"])).toBe(false);
  });

  it("is not a failure lane when failure and normal members are mixed", () => {
    expect(isFailureLane("Errors", ["failure", "normal"])).toBe(false);
  });

  it("falls back to the lane name when no member sets a kind", () => {
    expect(isFailureLane(" Failures ", [undefined])).toBe(true);
  });
});
