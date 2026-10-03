import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBridgeExecutable } from "./bridgeLocation";

let resourcesPath: string;

afterEach(() => {
  if (resourcesPath) {
    rmSync(resourcesPath, { recursive: true, force: true });
  }
});

describe("resolveBridgeExecutable", () => {
  it.each([
    ["Windows", "win32", ".exe"],
    ["macOS", "darwin", ""],
    ["Linux", "linux", ""],
  ] as const)("resolves the %s executable in packaged resources", (_name, platform, extension) => {
    resourcesPath = mkdtempSync(join(tmpdir(), "codechroma-bridge-"));
    const executable = join(
      resourcesPath,
      "bridge",
      "codechroma-bridge",
      `codechroma-bridge${extension}`,
    );
    mkdirSync(join(resourcesPath, "bridge", "codechroma-bridge"), { recursive: true });
    writeFileSync(executable, "");

    const resolved = resolveBridgeExecutable({
      isPackaged: true,
      resourcesPath,
      repoRoot: resourcesPath,
      platform,
    });

    expect(resolved).toBe(executable);
  });

  it("suggests rebuilding the packaged app if its bridge is missing", () => {
    resourcesPath = mkdtempSync(join(tmpdir(), "codechroma-bridge-"));

    expect(() =>
      resolveBridgeExecutable({
        isPackaged: true,
        resourcesPath,
        repoRoot: resourcesPath,
        platform: "win32",
      }),
    ).toThrow(/rebuild the desktop installer for this platform/);
  });
});
