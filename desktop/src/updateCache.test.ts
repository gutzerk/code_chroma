import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCachedLatestVersion, updateCachePath, writeCachedLatestVersion } from "./updateCache";

describe("update cache", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

  it("persists and reads the latest stable version", () => {
    const directory = mkdtempSync(join(tmpdir(), "codechroma-update-cache-"));
    directories.push(directory);
    const path = updateCachePath(directory);
    writeCachedLatestVersion(path, "v2.0.0");
    expect(readCachedLatestVersion(path)).toBe("v2.0.0");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ latestVersion: "v2.0.0" });
  });

  it("ignores missing, malformed, and invalid cache files", () => {
    const directory = mkdtempSync(join(tmpdir(), "codechroma-update-cache-"));
    directories.push(directory);
    const path = updateCachePath(directory);
    expect(readCachedLatestVersion(path)).toBeUndefined();
    writeCachedLatestVersion(path, "not-a-version");
    expect(readCachedLatestVersion(path)).toBeUndefined();
  });
});
