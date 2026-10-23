import { describe, expect, it } from "vitest";
import { agentInitials } from "./initials";

describe("agentInitials", () => {
  it.each([
    ["Planner Bot", "PB"],
    ["planner", "PL"],
    ["agent-1", "A1"],
    ["  ", "?"],
  ])("maps %s to %s", (title, expected) => {
    expect(agentInitials(title)).toBe(expected);
  });
});
