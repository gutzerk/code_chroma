import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MAX_RECENTS = 10;

export interface RecentRepo {
  path: string;
  name: string;
  openedAt: number;
}

/** Reads the recents list, dropping entries whose directory has since been moved or deleted. */
export function readRecents(storePath: string): RecentRepo[] {
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
  return parsed.filter(isRecentRepo).filter((entry) => existsSync(entry.path));
}

/** Moves `repoPath` to the front (deduped by path), caps the list, and persists it. */
export function addRecent(storePath: string, repoPath: string, now: number): RecentRepo[] {
  const entry: RecentRepo = { path: repoPath, name: basename(repoPath), openedAt: now };
  const others = readRecents(storePath).filter((existing) => existing.path !== repoPath);
  const next = [entry, ...others].slice(0, MAX_RECENTS);
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Last two path segments, so sibling checkouts named "web" stay distinguishable in the list. */
function basename(repoPath: string): string {
  const segments = repoPath.split("/").filter(Boolean);
  return segments.slice(-2).join("/") || repoPath;
}

function isRecentRepo(value: unknown): value is RecentRepo {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === "string" &&
    candidate.path.startsWith("/") &&
    typeof candidate.name === "string" &&
    typeof candidate.openedAt === "number"
  );
}

/** Where the recents file lives inside Electron's userData dir. */
export function recentsStorePath(userDataDir: string): string {
  return join(userDataDir, "recent.json");
}
