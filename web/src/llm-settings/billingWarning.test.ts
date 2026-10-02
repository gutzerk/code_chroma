import { describe, expect, it } from "vitest";
import { shouldWarnBilling } from "./billingWarning";

describe("shouldWarnBilling", () => {
  it("warns for a non-local direct-API provider", () => {
    expect(shouldWarnBilling({ kind: "api", is_local: false })).toBe(true);
  });

  it("does not warn for a local direct-API provider", () => {
    expect(shouldWarnBilling({ kind: "api", is_local: true })).toBe(false);
  });

  it("does not warn for a CLI provider even if is_local were somehow true", () => {
    expect(shouldWarnBilling({ kind: "cli", is_local: true })).toBe(false);
  });

  it("does not warn for a CLI provider", () => {
    expect(shouldWarnBilling({ kind: "cli", is_local: false })).toBe(false);
  });
});
