/** What the shell asks a running bridge about branches: which are free, and opening one in a worktree. */

export interface BranchChoice {
  name: string;
  /** Checked out somewhere already (main, an agent, another branch workspace, a stray worktree). */
  open: boolean;
  /** The workspace id showing it; null when it is free or held by a worktree we don't track. */
  workspace: string | null;
}

export interface BranchChoices {
  current: string | null;
  branches: BranchChoice[];
}

export interface BranchWorkspaceRecord {
  id: string;
  branch: string;
  worktree: string;
}

export type BranchRequest = { branch: string } | { newBranch: string; startPoint?: string };

export type BranchOutcome =
  | { kind: "opened"; record: BranchWorkspaceRecord }
  | { kind: "held"; workspace: string | null; message: string }
  | { kind: "failed"; message: string };

type FetchLike = typeof fetch;

// A worktree add plus skill install can take a while on a big repo; analysis itself is lazy.
const OPEN_TIMEOUT_MS = 120_000;
const LIST_TIMEOUT_MS = 10_000;

export async function fetchBranchChoices(
  origin: string,
  fetchImpl: FetchLike = fetch,
): Promise<BranchChoices> {
  const response = await fetchImpl(`${origin}/branches/choices`, {
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`could not list branches (${response.status})`);
  return (await response.json()) as BranchChoices;
}

/** Opens or creates a branch workspace; a branch another workspace already shows is `held`, not an error. */
export async function requestBranchWorkspace(
  origin: string,
  request: BranchRequest,
  fetchImpl: FetchLike = fetch,
): Promise<BranchOutcome> {
  const body =
    "branch" in request
      ? { branch: request.branch }
      : { new_branch: request.newBranch, start_point: request.startPoint };
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/branches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OPEN_TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: "failed", message: (error as Error).message };
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.ok && payload) return { kind: "opened", record: payload as unknown as BranchWorkspaceRecord };
  const detail = payload?.detail;
  if (response.status === 409 && typeof detail === "object" && detail !== null && "workspace" in detail) {
    const held = detail as { message?: string; workspace: string | null };
    return { kind: "held", workspace: held.workspace, message: held.message ?? "branch is already open" };
  }
  return { kind: "failed", message: typeof detail === "string" ? detail : `request failed (${response.status})` };
}
