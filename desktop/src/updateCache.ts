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

/** User choices about updates: a version to stay quiet about, and whether to fetch updates unprompted. */
export interface UpdateSettings {
  skippedVersion?: string;
  autoDownload: boolean;
}

const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Where the update settings live (separate from the cache so neither write clobbers the other). */
export function updateSettingsPath(userDataDir: string): string {
  return join(userDataDir, "update-settings.json");
}

/** Reads the settings, falling back to defaults for a missing or invalid file or field. */
export function readUpdateSettings(storePath: string): UpdateSettings {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(storePath, "utf8")); } catch { return { autoDownload: false }; }
  const record = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const skipped = record.skippedVersion;
  return {
    skippedVersion: typeof skipped === "string" && VERSION_PATTERN.test(skipped) ? skipped : undefined,
    autoDownload: record.autoDownload === true,
  };
}

/** Persists the settings. */
export function writeUpdateSettings(storePath: string, settings: UpdateSettings): void {
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(settings), "utf8");
}
