import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBridgeExecutable } from "./bridgeLocation";

let temporaryRoot: string;

afterEach(() => {
  if (temporaryRoot) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

describe("resolveBridgeExecutable", () => {
  it.each([
    ["Windows", "win32", ".exe"],
    ["macOS", "darwin", ""],
    ["Linux", "linux", ""],
  ] as const)("resolves the %s executable in packaged resources", (_name, platform, extension) => {
    temporaryRoot = mkdtempSync(join(tmpdir(), "codechroma-bridge-"));
    const executable = join(
      temporaryRoot,
      "bridge",
      "codechroma-bridge",
      `codechroma-bridge${extension}`,
    );
    mkdirSync(join(temporaryRoot, "bridge", "codechroma-bridge"), { recursive: true });
    writeFileSync(executable, "");

    const resolved = resolveBridgeExecutable({
      isPackaged: true,
      resourcesPath: temporaryRoot,
      repoRoot: temporaryRoot,
      platform,
    });

    expect(resolved).toBe(executable);
  });

  it("resolves the Windows executable in the unpackaged build output", () => {
    temporaryRoot = mkdtempSync(join(tmpdir(), "codechroma-bridge-"));
    const executable = join(temporaryRoot, "dist", "codechroma-bridge", "codechroma-bridge.exe");
    mkdirSync(join(temporaryRoot, "dist", "codechroma-bridge"), { recursive: true });
    writeFileSync(executable, "");

    expect(
      resolveBridgeExecutable({
        isPackaged: false,
        resourcesPath: temporaryRoot,
        repoRoot: temporaryRoot,
        platform: "win32",
      }),
    ).toBe(executable);
  });

  it("reports platform-specific instructions when the packaged bridge is missing", () => {
    temporaryRoot = mkdtempSync(join(tmpdir(), "codechroma-bridge-"));

    expect(() =>
      resolveBridgeExecutable({
        isPackaged: true,
        resourcesPath: temporaryRoot,
        repoRoot: temporaryRoot,
        platform: "win32",
      }),
    ).toThrow(/rebuild the desktop installer for this platform/);
  });
});
