import type {
  AgentList,
  AgentRecord,
  AgentWindowGeometry,
  BranchInfo,
  GitInitResult,
  GitPreflight,
  GithubOpenPr,
  PrImportPreflight,
  PrPreflight,
  PrWorkspace,
  PrWorkspaceList,
  WorkspaceStatus,
} from "../state/types";
import { errorMessageFrom, jsonInit } from "../util/httpJson";

/** Facade over the bridge's workspace-control routes — `/agents`, `/workspaces` and `/prs`. Unlike
 * EngineClient these are *not* under `/repos/{id}`: each list spans every workspace, so all three are
 * owned by the main repository. The PR methods live here rather than in their own client because this
 * is already where `activateWorkspace`/`workspaceStatus` are, which is what opening a PR needs. */
export interface AgentClient {
  list(): Promise<AgentList>;
  /** `attachTo` is an agent id, "main", or a PR workspace id ("pr-282"). The first two skip forking
   * a branch and share that target's worktree; a PR id forks a new branch/worktree seeded from the
   * PR's head commit instead — the PR's own read-only worktree is never touched. `context`'s
   * `contextKind` picks how the fresh agent receives it on its first start: "view" (default) is the
   * acknowledge-only current-view description; "task" is a real, actionable first message (e.g.
   * "Make a diagram"), injected as-is. */
  create(
    title: string,
    kind?: string,
    attachTo?: string,
    context?: string | null,
    contextKind?: "view" | "task",
  ): Promise<AgentRecord>;
  /** Brings up the PTY in the agent's worktree; `resume` continues its recorded conversation. */
  start(id: string, resume?: boolean): Promise<AgentRecord>;
  /** Kills the PTY and keeps the worktree and branch — the work is not the process. */
  stop(id: string): Promise<AgentRecord>;
  /** Removes the card; the worktree and the branch only when explicitly asked for. */
  remove(id: string, options?: { worktree?: boolean; branch?: boolean; force?: boolean }): Promise<void>;
  /** Fired on mouse release, the way saveC1Layout already is — not on every pointer move. */
  saveWindow(id: string, window: Partial<AgentWindowGeometry>): Promise<void>;
  /** What blocks a PR, so the button can render disabled with the reason as its label. */
  prPreflight(id: string): Promise<PrPreflight>;
  /** Pushes the branch and opens the PR; `commitDirty` decides the uncommitted files' fate. */
  createPr(id: string, commitDirty: boolean): Promise<AgentRecord & { pr_url: string }>;
  /** Checks the branch out again after its directory was deleted by hand. */
  recreateWorktree(id: string): Promise<AgentRecord>;
  /** Makes a workspace the canvas's data source and kicks off its lazy bring-up. */
  activateWorkspace(id: string): Promise<WorkspaceStatus>;
  /** analyzing / ready / error plus a progress line, polled while a worktree's graph comes up. */
  workspaceStatus(id: string): Promise<WorkspaceStatus>;
  /** Whether agents can run here at all, plus the first-commit plan when a repo has to be made. */
  gitPreflight(): Promise<GitPreflight>;
  gitInit(extraIgnores: string[]): Promise<GitInitResult>;
  /** Main's current checked-out branch plus every local branch, for the branch switcher. */
  getBranch(): Promise<BranchInfo>;
  /** Checks main's working tree out to `branch`; rejects on a dirty tree or an unknown name. */
  switchBranch(branch: string): Promise<BranchInfo>;
  /** Fast-forwards main's current branch from its upstream — PyCharm's Update (git pull --ff-only). */
  updateBranch(): Promise<BranchInfo>;
  /** Every open pull-request review (GET /prs). */
  listPrs(): Promise<PrWorkspaceList>;
  /** Every open pull request on GitHub itself, for the dialog's picker (GET /prs/github). */
  listGithubPrs(): Promise<GithubOpenPr[]>;
  /** What blocks opening a PR, so the button renders disabled with the reason as its label. */
  prImportPreflight(): Promise<PrImportPreflight>;
  /** Fetches the pull request `ref` names into a read-only workspace; already-open ones link back. */
  openPr(ref: string): Promise<PrWorkspace>;
  /** Re-fetches it, moving the worktree only if the head actually moved. */
  refreshPr(number: number): Promise<PrWorkspace & { updated: boolean }>;
  /** Drops the worktree, both fetched refs and the registration. */
  closePr(number: number): Promise<void>;
}

export class HttpAgentClient implements AgentClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) throw new Error(await errorMessageFrom(response));
    return (await response.json()) as T;
  }

  private json(method: string, body?: unknown): RequestInit {
    return jsonInit(method, body);
  }

  list(): Promise<AgentList> {
    return this.request<AgentList>("/agents");
  }

  create(
    title: string,
    kind = "claude",
    attachTo?: string,
    context?: string | null,
    contextKind?: "view" | "task",
  ): Promise<AgentRecord> {
    return this.request<AgentRecord>(
      "/agents",
      this.json("POST", { title, kind, attach_to: attachTo, context, context_kind: contextKind }),
    );
  }

  start(id: string, resume = false): Promise<AgentRecord> {
    return this.request<AgentRecord>(`/agents/${id}/start`, this.json("POST", { resume }));
  }

  stop(id: string): Promise<AgentRecord> {
    return this.request<AgentRecord>(`/agents/${id}/stop`, this.json("POST"));
  }

  async remove(
    id: string,
    options: { worktree?: boolean; branch?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const query = new URLSearchParams();
    if (options.worktree) query.set("worktree", "true");
    if (options.branch) query.set("branch", "true");
    if (options.force) query.set("force", "true");
    const suffix = query.toString() ? `?${query.toString()}` : "";
    await this.request<unknown>(`/agents/${id}${suffix}`, this.json("DELETE"));
  }

  async saveWindow(id: string, window: Partial<AgentWindowGeometry>): Promise<void> {
    await this.request<unknown>(`/agents/${id}/window`, this.json("PATCH", window));
  }

  prPreflight(id: string): Promise<PrPreflight> {
    return this.request<PrPreflight>(`/agents/${id}/pr-preflight`);
  }

  createPr(id: string, commitDirty: boolean): Promise<AgentRecord & { pr_url: string }> {
    return this.request<AgentRecord & { pr_url: string }>(
      `/agents/${id}/pr`,
      this.json("POST", { commit_dirty: commitDirty }),
    );
  }

  recreateWorktree(id: string): Promise<AgentRecord> {
    return this.request<AgentRecord>(`/agents/${id}/recreate-worktree`, this.json("POST"));
  }

  activateWorkspace(id: string): Promise<WorkspaceStatus> {
    return this.request<WorkspaceStatus>(`/workspaces/${id}/activate`, this.json("POST"));
  }

  workspaceStatus(id: string): Promise<WorkspaceStatus> {
    return this.request<WorkspaceStatus>(`/workspaces/${id}/status`);
  }

  gitPreflight(): Promise<GitPreflight> {
    return this.request<GitPreflight>("/agents/git-preflight");
  }

  gitInit(extraIgnores: string[]): Promise<GitInitResult> {
    return this.request<GitInitResult>(
      "/agents/git-init",
      this.json("POST", { extra_ignores: extraIgnores }),
    );
  }

  getBranch(): Promise<BranchInfo> {
    return this.request<BranchInfo>("/agents/branch");
  }

  switchBranch(branch: string): Promise<BranchInfo> {
    return this.request<BranchInfo>("/agents/branch", this.json("POST", { branch }));
  }

  updateBranch(): Promise<BranchInfo> {
    return this.request<BranchInfo>("/agents/branch/update", this.json("POST"));
  }

  listPrs(): Promise<PrWorkspaceList> {
    return this.request<PrWorkspaceList>("/prs");
  }

  async listGithubPrs(): Promise<GithubOpenPr[]> {
    const data = await this.request<{ prs: GithubOpenPr[] }>("/prs/github");
    return data.prs;
  }

  prImportPreflight(): Promise<PrImportPreflight> {
    return this.request<PrImportPreflight>("/prs/preflight");
  }

  openPr(ref: string): Promise<PrWorkspace> {
    return this.request<PrWorkspace>("/prs", this.json("POST", { ref }));
  }

  refreshPr(number: number): Promise<PrWorkspace & { updated: boolean }> {
    return this.request<PrWorkspace & { updated: boolean }>(
      `/prs/${number}/refresh`,
      this.json("POST"),
    );
  }

  async closePr(number: number): Promise<void> {
    await this.request<unknown>(`/prs/${number}`, this.json("DELETE"));
  }
}
