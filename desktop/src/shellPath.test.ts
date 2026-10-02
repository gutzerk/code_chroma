import { describe, expect, it } from "vitest";
import { delimiter } from "node:path";
import { loginShellPath, repairProcessPath } from "./shellPath";

describe("loginShellPath", () => {
  it("recovers the login shell's PATH, which launchd does not pass to a Finder launch", () => {
    const result = loginShellPath("/bin/zsh", `/usr/bin${delimiter}/bin`).split(delimiter);

    expect(result).toContain("/usr/bin");
    expect(result.length).toBeGreaterThan(2);
  });

  it("falls back to the common bin dirs when the shell cannot be run", () => {
    const result = loginShellPath("/nonexistent/shell", undefined).split(delimiter);

    expect(result.length).toBeGreaterThan(2);
  });

  it("keeps the existing PATH entries ahead of the fallbacks", () => {
    const result = loginShellPath(undefined, "/my/tools").split(delimiter);

    expect(result[0]).toBe("/my/tools");
  });

  it("dedupes repeated dirs so PATH does not grow on every launch", () => {
    const result = loginShellPath(undefined, `/usr/bin${delimiter}/usr/bin${delimiter}/bin`).split(delimiter);

    expect(result.filter((entry) => entry === "/usr/bin")).toHaveLength(1);
  });
});

describe("repairProcessPath", () => {
  it("writes the merged PATH back into the env children will inherit", () => {
    const env = { SHELL: "/nonexistent/shell", PATH: "/usr/bin" };
    const returned = repairProcessPath(env);

    expect(env.PATH).toBe(returned);
    expect(env.PATH.split(delimiter)).toContain("/usr/bin");
  });
});
