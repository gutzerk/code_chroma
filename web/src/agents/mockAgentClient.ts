import type {
  AgentList,
  AgentRecord,
  AgentWindowGeometry,
  BuiltinDiagramKind,
  GitInitResult,
  GitPreflight,
  GithubOpenPr,
  PrImportPreflight,
  PrPreflight,
  PrWorkspace,
  PrWorkspaceList,
  WorkspaceStatus,
  WorktreeCreated,
  WorktreeList,
  WorktreeRecord,
} from "../state/types";
import { parsePrNumber } from "../pr/prUrl";
import type { AgentClient, DiagramTaskHint } from "./agentClient";

const MAX_AGENTS = 5;

const MAX_PRS = 3;

/** What GET /diagram-kinds serves (src/codechroma/diagrams/kinds.json), for the mock bridge. */
const MOCK_DIAGRAM_KINDS: BuiltinDiagramKind[] = [
  { id: "any", name: "Let the agent pick", purpose: "Say what you want to see and the agent chooses the diagram type." },
  { id: "c1", name: "System context", purpose: "The system, its users and the external services around it." },
  { id: "patterns", name: "Design patterns", purpose: "The design patterns the code uses and where they sit." },
  { id: "impact", name: "Change impact", purpose: "What the current change touches and what depends on it." },
  { id: "plan", name: "Feature plan", purpose: "A described future feature as planned blocks beside the code it touches." },
  { id: "sequence", name: "Sequence", purpose: "Who calls whom, in order, for one flow." },
  { id: "custom", name: "Custom type", purpose: "A diagram type of your own or a saved one." },
];

// The fixed set GitHub is pretending has open pull requests — e2e picks #7 and #42 from here.
const GITHUB_PR_NUMBERS = [7, 42, 64];

/** Fixture-backed stand-in used whenever VITE_ENGINE_BRIDGE_URL is unset — the same "frontend work
 * is unblocked without a bridge" precedent as MockBridgeEngineClient, and what the e2e specs drive.
 * No git, no worktree, no process: creating an agent just adds a card. */
export class MockAgentClient implements AgentClient {
  private agents: AgentRecord[] = [];
  private prs: PrWorkspace[] = [];
  private counter = 0;
  private active = "main";
  private preflightState: GitPreflight = { state: "ready", root: "/mock/repo" };
  private prPreflightState: PrImportPreflight = { ready: true, reason: null };
  private worktrees: WorktreeRecord[] = [];
  private worktreeCounter = 0;
  private activeWorktree: string | null = null;

  /** e2e hook: makes the next preflight report a project that isn't under git yet. */
  setPreflight(preflight: GitPreflight): void {
    this.preflightState = preflight;
  }

  async diagramKinds(): Promise<BuiltinDiagramKind[]> {
    return MOCK_DIAGRAM_KINDS;
  }

  async list(workspace?: string): Promise<AgentList> {
    const agents = workspace ? this.agents.filter((agent) => agent.workspace === workspace) : this.agents;
    return { agents: [...agents], active_workspace: this.active, max_agents: MAX_AGENTS };
  }

  async create(
    title: string,
    kind = "claude",
    attachTo?: string,
    _context?: string | null,
    _contextKind?: "view" | "task",
    diagram?: DiagramTaskHint,
    workspace?: string,
  ): Promise<AgentRecord> {
    if (attachTo === "main") throw new Error("attach_to=main is not allowed; agents work in a worktree tab");
    if (this.agents.length >= MAX_AGENTS) {
      throw new Error(`the limit of ${MAX_AGENTS} concurrent agents is reached`);
    }
    // Not committed to `this.counter` until every step below succeeds — attachTarget() can still
    // throw on an unknown attachTo, and a failed create() must not burn a counter value.
    const nextCounter = this.counter + 1;
    const id = slugify(title) || `agent${nextCounter}`;
    // A PR id forks a fresh worktree/branch below, rather than sharing the PR's own.
    const pr =
      attachTo === undefined ? undefined : this.prs.find((candidate) => candidate.id === attachTo);
    let branch: string;
    let baseBranch: string | null;
    let worktreePath: string;
    let sourcePr: string | null;
    let sharesWorkspaceWith: string | null;
    if (pr) {
      branch = `agent/${id}`;
      baseBranch = pr.base_ref;
      worktreePath = `/mock/worktrees/${id}`;
      sourcePr = pr.id;
      sharesWorkspaceWith = null;
    } else if (attachTo === undefined && workspace !== undefined) {
      const tab = this.worktrees.find((candidate) => candidate.id === workspace);
      if (!tab) throw new Error(`unknown workspace: ${workspace}`);
      branch = tab.branch;
      baseBranch = "main";
      worktreePath = tab.worktree;
      sourcePr = null;
      sharesWorkspaceWith = null;
    } else if (attachTo !== undefined) {
      const target = this.attachTarget(attachTo);
      branch = target.branch;
      baseBranch = target.base_branch;
      worktreePath = target.worktree;
      sourcePr = null;
      sharesWorkspaceWith = attachTo;
    } else {
      branch = `agent/${id}`;
      baseBranch = "main";
      worktreePath = `/mock/worktrees/${id}`;
      sourcePr = null;
      sharesWorkspaceWith = null;
    }
    this.counter = nextCounter;
    const agent: AgentRecord = {
      id,
      title: title.trim() || id,
      kind,
      branch,
      base_branch: baseBranch,
      workspace: workspace ?? null,
      source_pr: sourcePr,
      shares_workspace_with: sharesWorkspaceWith,
      worktree: worktreePath,
      created_at: new Date().toISOString(),
      session_id: null,
      pr_url: null,
      pid: null,
      window: {
        x: 160 + this.agents.length * 32,
        y: 120 + this.agents.length * 32,
        width: 720,
        height: 480,
        minimized: false,
        z: this.agents.length + 1,
      },
      status: "stopped",
      exit_code: null,
      worktree_lost: false,
      diagram_type: diagram?.type ?? null,
      diagram_request: diagram?.request ?? null,
    };
    this.agents.push(agent);
    return agent;
  }

  async openStepSession(title: string, runId: string, sessionId: string): Promise<AgentRecord> {
    const agent = await this.create(title);
    Object.assign(agent, { worktree: `/mock/worktrees/wf-${runId}`, branch: `wf-${runId}`, source_run: runId, fork_session: sessionId });
    return agent;
  }

  /** Another agent's own branch/worktree — thrown on an id that isn't one. */
  private attachTarget(
    attachTo: string,
  ): { branch: string; base_branch: string | null; worktree: string } {
    const target = this.agents.find((agent) => agent.id === attachTo);
    if (!target) throw new Error(`unknown attach_to: ${attachTo}`);
    return {
      branch: target.branch,
      base_branch: target.base_branch ?? null,
      worktree: target.worktree,
    };
  }

  /** `idle`, not `running`: the real bridge reports what its detector reads off the live screen,
   * and a freshly started agent is sitting at its prompt. */
  async start(id: string): Promise<AgentRecord> {
    return this.patch(id, { status: "idle", pid: 4242 });
  }

  async stop(id: string): Promise<AgentRecord> {
    return this.patch(id, { status: "stopped", pid: null });
  }

  async remove(
    _id: string,
    _options?: { worktree?: boolean; branch?: boolean; force?: boolean },
  ): Promise<void> {
    // The mock has no real worktree or branch to delete — the flags are accepted and ignored.
    this.agents = this.agents.filter((agent) => agent.id !== _id);
  }

  async saveWindow(id: string, window: Partial<AgentWindowGeometry>): Promise<void> {
    const agent = this.agents.find((candidate) => candidate.id === id);
    if (agent) agent.window = { ...agent.window, ...window };
  }

  /** No git and no `gh` behind the fixture bridge, so the button honestly says so up front. */
  async prPreflight(): Promise<PrPreflight> {
    return { ready: false, reason: "gh-missing", text: "GitHub CLI required", dirty: [] };
  }

  async createPr(id: string): Promise<AgentRecord & { pr_url: string }> {
    throw new Error(`cannot open a PR for ${id} without a bridge`);
  }

  async recreateWorktree(id: string): Promise<AgentRecord> {
    return this.patch(id, { worktree_lost: false });
  }

  async activateWorkspace(id: string): Promise<WorkspaceStatus> {
    this.active = id;
    return { id, state: "ready", progress: "", error: null, read_only: this.isPr(id) };
  }

  async workspaceStatus(id: string): Promise<WorkspaceStatus> {
    return { id, state: "ready", progress: "", error: null, read_only: this.isPr(id) };
  }

  async gitPreflight(): Promise<GitPreflight> {
    return this.preflightState;
  }

  async gitInit(): Promise<GitInitResult> {
    this.preflightState = { state: "ready", root: this.preflightState.root };
    return { state: "ready", created_repo: true, created_gitignore: true, commit: "0".repeat(40) };
  }

  async listWorktrees(): Promise<WorktreeList> {
    return { branches: this.worktrees.map((tab) => ({ ...tab, dirty: 0 })), active: this.activeWorktree };
  }

  async ensureWorktrees(): Promise<WorktreeList> {
    if (this.worktrees.length === 0) await this.createWorktree();
    return this.listWorktrees();
  }

  async createWorktree(name?: string): Promise<WorktreeCreated> {
    this.worktreeCounter += 1;
    const label = name?.trim() || `wt-${this.worktreeCounter}`;
    const id = `br_${this.worktreeCounter}`;
    const branch: WorktreeRecord = { id, name: label, branch: label, worktree: `/mock/worktrees/${label}` };
    this.worktrees.push(branch);
    this.activeWorktree = id;
    return { branch, fetched: false, warning: null };
  }

  async renameWorktree(id: string, name: string): Promise<void> {
    const tab = this.worktrees.find((candidate) => candidate.id === id);
    if (!tab) throw new Error(`unknown worktree: ${id}`);
    if (this.worktrees.some((other) => other.id !== id && other.name === name)) {
      throw new Error(`name "${name}" is already in use`);
    }
    tab.name = name;
    tab.branch = name;
  }

  async setActiveWorktree(id: string): Promise<void> {
    this.activeWorktree = id;
  }

  async closeWorktree(id: string, _worktreeToo: boolean): Promise<void> {
    this.worktrees = this.worktrees.filter((tab) => tab.id !== id);
    this.agents = this.agents.filter((agent) => agent.workspace !== id);
    if (this.activeWorktree === id) this.activeWorktree = this.worktrees[0]?.id ?? null;
  }

  async listPrs(): Promise<PrWorkspaceList> {
    return { prs: [...this.prs], max_prs: MAX_PRS, active_workspace: this.active };
  }

  async listGithubPrs(): Promise<GithubOpenPr[]> {
    return GITHUB_PR_NUMBERS.map((number) => ({
      number,
      title: `Mock pull request #${number}`,
      head_ref: `feature/pr-${number}`,
      author: "octocat",
    }));
  }

  /** Ready by default, unlike the agent PR button: e2e drives the happy path through here. */
  async prImportPreflight(): Promise<PrImportPreflight> {
    return {
      ...this.prPreflightState,
      origin: { owner: "acme", repo: "app" },
      count: this.prs.length,
      max_prs: MAX_PRS,
    };
  }

  /** e2e hook: makes the next preflight report a blocker, mirroring setPreflight. */
  setPrImportPreflight(preflight: PrImportPreflight): void {
    this.prPreflightState = preflight;
  }

  async openPr(ref: string): Promise<PrWorkspace> {
    const number = parsePrNumber(ref);
    if (number === null) throw new Error("Paste a GitHub pull-request URL, or a number like #123");
    const existing = this.prs.find((pr) => pr.number === number);
    if (existing) return existing;
    if (this.prs.length >= MAX_PRS) {
      throw new Error(`The limit of ${MAX_PRS} open PR reviews is reached`);
    }
    const pr: PrWorkspace = {
      id: `pr-${number}`,
      number,
      title: `Mock pull request #${number}`,
      url: `https://github.com/acme/app/pull/${number}`,
      author: "octocat",
      state: "OPEN",
      head_ref: `feature/pr-${number}`,
      head_sha: "abc1234",
      head_repo: "octocat/app",
      is_fork: false,
      base_ref: "main",
      worktree: `/mock/worktrees/pr-${number}`,
      imported_at: new Date().toISOString(),
      fetched_at: new Date().toISOString(),
      changed_files: 3,
      additions: 42,
      deletions: 7,
      worktree_lost: false,
    };
    this.prs.push(pr);
    return pr;
  }

  async refreshPr(number: number): Promise<PrWorkspace & { updated: boolean }> {
    const pr = this.prs.find((candidate) => candidate.number === number);
    if (!pr) throw new Error(`no open review for #${number}`);
    pr.fetched_at = new Date().toISOString();
    return { ...pr, updated: false };
  }

  async closePr(number: number): Promise<void> {
    this.prs = this.prs.filter((pr) => pr.number !== number);
    if (this.active === `pr-${number}`) this.active = this.activeWorktree ?? "main";
  }

  private isPr(id: string): boolean {
    return this.prs.some((pr) => pr.id === id);
  }

  private patch(id: string, patch: Partial<AgentRecord>): AgentRecord {
    const agent = this.agents.find((candidate) => candidate.id === id);
    if (!agent) throw new Error(`unknown agent: ${id}`);
    Object.assign(agent, patch);
    return agent;
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
