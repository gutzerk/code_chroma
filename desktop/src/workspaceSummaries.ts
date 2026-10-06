import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One named workspace (an agent or a PR review) belonging to a repo, for the launcher's
 * recent-projects tree -- see `listWorkspacesForRepo`. */
export interface WorkspaceSummary {
  id: string;
  label: string;
}

function readJsonArray(path: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Best-effort read of a repo's agent and PR workspaces straight from `.codechroma/{agents,prs}.json`
 * -- never throws, since a missing or corrupt file just means "no workspaces yet". Mirrors
 * `AgentRecord.from_json`/`PrRecord.from_json` field names (`src/codechroma/bridge/{agents,prs}/manager.py`)
 * loosely enough to tolerate an older or newer bridge without crashing the launcher. */
export function listWorkspacesForRepo(repoPath: string): WorkspaceSummary[] {
  const agents = readJsonArray(join(repoPath, ".codechroma", "agents.json"))
    .filter(isRecord)
    .filter((entry) => typeof entry.id === "string" && typeof entry.title === "string")
    .map((entry) => ({ id: entry.id as string, label: entry.title as string }));

  const prs = readJsonArray(join(repoPath, ".codechroma", "prs.json"))
    .filter(isRecord)
    .filter((entry) => typeof entry.number === "number")
    .map((entry) => {
      const number = entry.number as number;
      const title = typeof entry.title === "string" ? entry.title : "";
      return { id: `pr-${number}`, label: title ? `PR #${number}: ${title}` : `PR #${number}` };
    });

  return [...agents, ...prs];
}
