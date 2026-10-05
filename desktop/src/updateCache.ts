import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Loads the most recently observed stable release version, or undefined for missing/invalid cache. */
export function readCachedLatestVersion(storePath: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(storePath, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const version = (parsed as Record<string, unknown>).latestVersion;
  return typeof version === "string" && /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
    ? version
    : undefined;
}

/** Persists the stable release version for display when a later GitHub check fails. */
export function writeCachedLatestVersion(storePath: string, version: string): void {
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify({ latestVersion: version }), "utf8");
}

/** Where the update cache lives inside Electron's userData directory. */
export function updateCachePath(userDataDir: string): string {
  return join(userDataDir, "update-cache.json");
}
