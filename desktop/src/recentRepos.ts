import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export const MAX_RECENTS = 10;

export interface RecentRepo {
  path: string;
  name: string;
  openedAt: number;
  /** True when the directory has since been moved or deleted; set on read, never persisted. */
  missing?: boolean;
}

/** Reads the recents list, flagging (not dropping) entries whose directory is gone so the user can forget them. */
export function readRecents(storePath: string): RecentRepo[] {
  return readStored(storePath).map((entry) => ({ ...entry, missing: !existsSync(entry.path) }));
}

function readStored(storePath: string): RecentRepo[] {
  let raw: string;
  try {
    raw = readFileSync(storePath, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isRecentRepo);
}

function writeStored(storePath: string, entries: RecentRepo[]): void {
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(entries, null, 2), "utf8");
}

/** Moves `repoPath` to the front (deduped by path), caps the list, and persists it. */
export function addRecent(storePath: string, repoPath: string, now: number): RecentRepo[] {
  const entry: RecentRepo = { path: repoPath, name: basename(repoPath), openedAt: now };
  const others = readStored(storePath).filter((existing) => existing.path !== repoPath);
  const next = [entry, ...others].slice(0, MAX_RECENTS);
  writeStored(storePath, next);
  return readRecents(storePath);
}

/** Forgets `repoPath` from the list only -- never touches the project on disk. */
export function removeRecent(storePath: string, repoPath: string): RecentRepo[] {
  writeStored(storePath, readStored(storePath).filter((entry) => entry.path !== repoPath));
  return readRecents(storePath);
}

/** Last two path segments, so sibling checkouts named "web" stay distinguishable in the list. */
function basename(repoPath: string): string {
  const segments = repoPath.split(/[\/]/).filter(Boolean);
  return segments.slice(-2).join("/") || repoPath;
}

function isRecentRepo(value: unknown): value is RecentRepo {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === "string" &&
    isAbsolute(candidate.path) &&
    typeof candidate.name === "string" &&
    typeof candidate.openedAt === "number"
  );
}

/** Where the recents file lives inside Electron's userData dir. */
export function recentsStorePath(userDataDir: string): string {
  return join(userDataDir, "recent.json");
}
