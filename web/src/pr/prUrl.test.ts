import { describe, expect, it } from "vitest";
import { parsePrNumber } from "./prUrl";

describe("parsePrNumber", () => {
  it.each([
    "https://github.com/acme/app/pull/123",
    "https://github.com/acme/app/pull/123/files",
    "https://github.com/acme/app/pull/123#issuecomment-1",
    "https://github.com/acme/app/pull/123/",
    "http://github.com/acme/app.git/pull/123",
    "git@github.com:acme/app.git/pull/123",
    "  https://github.com/acme/app/pull/123  ",
  ])("reads the number out of %s", (input) => {
    expect(parsePrNumber(input)).toBe(123);
  });

  it.each(["123", "#123", " 123 "])("accepts the bare form %s", (input) => {
    expect(parsePrNumber(input)).toBe(123);
  });

  it.each([
    "",
    "   ",
    "not a pull request",
    "https://github.com/acme/app/issues/123",
    "https://gitlab.com/acme/app/pull/123",
    "https://github.com/acme/app/pull/abc",
    "12x",
    "#",
  ])("rejects %s", (input) => {
    expect(parsePrNumber(input)).toBeNull();
  });

  it("does not judge which repository the pull request is in", () => {
    // The client has no idea what remote the bridge has open; that rejection is the bridge's.
    expect(parsePrNumber("https://github.com/someone-else/other/pull/9")).toBe(9);
  });
});
