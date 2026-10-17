import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCachedLatestVersion, readUpdateSettings, updateCachePath, updateSettingsPath, writeCachedLatestVersion, writeUpdateSettings } from "./updateCache";

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "codechroma-update-cache-")); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("update cache", () => {
  it("persists and reads the latest stable version", () => {
    const path = updateCachePath(directory);
    writeCachedLatestVersion(path, "v2.0.0");
    expect(readCachedLatestVersion(path)).toBe("v2.0.0");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ latestVersion: "v2.0.0" });
  });

  it("ignores missing, malformed, and invalid cache files", () => {
    const path = updateCachePath(directory);
    expect(readCachedLatestVersion(path)).toBeUndefined();
    writeCachedLatestVersion(path, "not-a-version");
    expect(readCachedLatestVersion(path)).toBeUndefined();
  });
});

describe("update settings", () => {
  it("round-trips the skipped version and auto-download flag in their own file", () => {
    const path = updateSettingsPath(directory);
    writeUpdateSettings(path, { skippedVersion: "v2.0.0", autoDownload: true });
    expect(readUpdateSettings(path)).toEqual({ skippedVersion: "v2.0.0", autoDownload: true });
    expect(path).not.toBe(updateCachePath(directory));
  });

  it.each([
    ["missing", undefined],
    ["malformed JSON", "{"],
    ["wrong types", JSON.stringify({ skippedVersion: 3, autoDownload: "yes" })],
    ["an invalid version", JSON.stringify({ skippedVersion: "nope", autoDownload: true })],
  ])("falls back to defaults for %s settings", (_name, content) => {
    const path = updateSettingsPath(directory);
    if (content !== undefined) writeFileSync(path, content);
    expect(readUpdateSettings(path).skippedVersion).toBeUndefined();
    expect(readUpdateSettings(path).autoDownload).toBe(content?.includes("true") ? true : false);
  });
});
