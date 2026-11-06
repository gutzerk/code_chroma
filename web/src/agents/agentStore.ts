import { useSyncExternalStore } from "react";
import { clamp } from "../util/clamp";
import type { AgentRecord, AgentStatus, AgentStatusFields, AgentWindowGeometry, GitPreflight } from "../state/types";
import { Store } from "../state/createStore";
import { normalizeAgentStatus } from "./statusRollup";
import { worktreeStore } from "./worktreeStore";

const EMPTY: AgentRecord[] = [];

/** A shared empty set, so `useSyncExternalStore` sees a stable snapshot while nothing is flagged. */
const NO_DIAGRAMS_READY: ReadonlySet<string> = new Set<string>();

/** Smallest window that is still usable, and the margin that keeps a title bar reachable when a
 * saved position lands off-screen (e.g. it was dragged onto a monitor that is no longer attached). */
const MIN_VISIBLE = 120;

/** Lets a fresh window (e.g. a PR opened via "Open in New Window") boot straight into the right
 * workspace; "main" is only the placeholder id until `/branches/ensure` names the active tab. */
export function initialWorkspace(): string {
  return workspaceFromUrl() ?? "main";
}

/** A `?workspace=main` is ignored: main is never a tab, the page picks one via `/branches/ensure`. */
function workspaceFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(window.location.search).get("workspace");
  return id && id !== "main" ? id : null;
}

/**
 * The agent list, the window layout and which workspace the canvas is drawing — in memory, in the
 * style of changeCardStore. Geometry is echoed here on every drag so windows feel instant;
 * the bridge is only told on mouse release, and it is the bridge's copy that survives a restart.
 */
class AgentStore extends Store {
  private agents: AgentRecord[] = EMPTY;
  // The bridge's "last active" never moves it from here: the boot (worktreeActions.ensureWorktrees)
  // decides once, so a list refresh can't race the tab selection or follow another window's pick.
  private activeWorkspace = initialWorkspace();
  private maxAgents = 5;
  private gitPreflight: GitPreflight | null = null;
  private launchError: string | null = null;
  private startErrors: Record<string, string> = {};
  private isLaunching = false;
  // The agent currently awaiting a "delete worktree?" confirmation on close — an agent that is the
  // last one on its own worktree. Null (the resting state) closes immediately, no dialog at all.
  private pendingClose: string | null = null;
  // Agents whose OWN workspace has a freshly-drawn diagram. A "Draw" task launched from a read-only
  // PR workspace is forked into its own worktree, so its output lands where the canvas isn't looking.
  private diagramsReady: ReadonlySet<string> = NO_DIAGRAMS_READY;

  getAgents = (): AgentRecord[] => this.agents;

  getAgent = (id: string): AgentRecord | undefined =>
    this.agents.find((agent) => agent.id === id);

  getActiveWorkspace = (): string => this.activeWorkspace;

  getMaxAgents = (): number => this.maxAgents;

  getGitPreflight = (): GitPreflight | null => this.gitPreflight;

  getLaunchError = (): string | null => this.launchError;

  getStartError = (id: string): string | null => this.startErrors[id] ?? null;

  getPendingClose = (): string | null => this.pendingClose;

  getDiagramsReady = (): ReadonlySet<string> => this.diagramsReady;

  /** True once the hard cap is reached — the "Run agent" button greys out with an explanation. */
  getIsAtCapacity = (): boolean => this.agents.length >= this.maxAgents;

  /** True while a launch/attach is in flight — the count only grows once `create()` resolves, so
   * this closes the gap a fast double-click could otherwise slip through. */
  getIsLaunching = (): boolean => this.isLaunching;

  setList = (list: {
    agents: AgentRecord[];
    active_workspace: string;
    max_agents: number;
  }): void => {
    this.agents = list.agents.map((agent) => clampToViewport(normalized(agent)));
    this.maxAgents = list.max_agents;
    this.emit();
  };

  /** Inserts or replaces one card — the `agent-added` event and every mutating call land here. */
  upsert = (agent: AgentRecord): void => {
    const clamped = clampToViewport(normalized(agent));
    const index = this.agents.findIndex((candidate) => candidate.id === agent.id);
    this.agents =
      index === -1
        ? [...this.agents, clamped]
        : this.agents.map((candidate, at) => (at === index ? clamped : candidate));
    this.emit();
  };

  /** `upsert` for an HTTP reply: dropped when a newer `agent-status` event already landed. */
  upsertIfCurrent = (agent: AgentRecord): void => {
    const stored = this.getAgent(agent.id);
    if (stored && isOlder(agent.status_since, stored.status_since)) return;
    this.upsert(agent);
  };

  remove = (id: string): void => {
    this.agents = this.agents.filter((agent) => agent.id !== id);
    if (id in this.startErrors) {
      this.startErrors = Object.fromEntries(
        Object.entries(this.startErrors).filter(([agentId]) => agentId !== id),
      );
    }
    if (this.activeWorkspace === id) this.activeWorkspace = this.fallbackWorkspace(new Set([id]));
    this.emit();
  };

  /** The shown tab if it survives, else the "main" placeholder until a tab is selected. */
  private fallbackWorkspace = (gone: ReadonlySet<string>): string => {
    const tab = worktreeStore.getActiveId();
    return tab && !gone.has(tab) ? tab : "main";
  };

  removeMany = (ids: readonly string[]): void => {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    this.agents = this.agents.filter((agent) => !gone.has(agent.id));
    this.startErrors = Object.fromEntries(Object.entries(this.startErrors).filter(([agentId]) => !gone.has(agentId)));
    if (gone.has(this.activeWorkspace)) this.activeWorkspace = this.fallbackWorkspace(gone);
    this.emit();
  };

  countInWorkspace = (workspace: string): number =>
    this.agents.reduce((total, agent) => total + (agent.workspace === workspace ? 1 : 0), 0);

  setStatus = (id: string, status: AgentStatus): void => {
    this.applyStatus(id, status, {});
  };

  /** Lands an `agent-status` event: the status plus its activity, pending permission and error. */
  applyStatus = (id: string, status: AgentStatus, fields: AgentStatusFields & { exit_code?: number | null }): void => {
    this.agents = this.agents.map((agent) => {
      if (agent.id !== id) return agent;
      const exitCode = fields.exit_code !== undefined ? fields.exit_code : agent.exit_code;
      return {
        ...agent,
        exit_code: exitCode,
        status: normalizeAgentStatus(status, exitCode),
        status_since: fields.status_since ?? agent.status_since ?? null,
        activity: fields.activity ?? null,
        pending_permission: fields.pending_permission ?? null,
        error: fields.error ?? null,
      };
    });
    this.emit();
  };

  /** Re-clamps every window to the current viewport -- `clampToViewport` above only ever ran against
   * a freshly-loaded/upserted record, so a monitor unplugged while the app stayed open (shrinking
   * the browser window in place) never re-ran it, leaving an already-placed window's title bar
   * off-screen and unreachable. Called from a `resize` listener; a no-op when nothing moved. */
  reclampToViewport = (): void => {
    const viewport = viewportSize();
    const next = this.agents.map((agent) => clampToViewport(agent, viewport));
    if (next.every((agent, index) => agent === this.agents[index])) return;
    this.agents = next;
    this.emit();
  };

  setWindow = (id: string, patch: Partial<AgentWindowGeometry>): void => {
    this.agents = this.agents.map((agent) =>
      agent.id === id ? { ...agent, window: { ...agent.window, ...patch } } : agent,
    );
    this.emit();
  };

  /** Raises a window above the others; the resulting `z` is what gets persisted on drag end. */
  bringToFront = (id: string): number => {
    const top = this.agents.reduce((highest, agent) => Math.max(highest, agent.window.z), 0);
    const next = top + 1;
    this.setWindow(id, { z: next });
    return next;
  };

  setActiveWorkspace = (id: string): void => {
    this.activeWorkspace = id;
    this.emit();
  };

  setGitPreflight = (preflight: GitPreflight | null): void => {
    this.gitPreflight = preflight;
    this.emit();
  };

  setLaunchError = (error: string | null): void => {
    this.launchError = error;
    this.emit();
  };

  setStartError = (id: string, error: string | null): void => {
    if (error === null) {
      if (!(id in this.startErrors)) return;
      this.startErrors = Object.fromEntries(
        Object.entries(this.startErrors).filter(([agentId]) => agentId !== id),
      );
    } else {
      this.startErrors = { ...this.startErrors, [id]: error };
    }
    this.emit();
  };

  setPendingClose = (id: string | null): void => {
    this.pendingClose = id;
    this.emit();
  };

  setIsLaunching = (isLaunching: boolean): void => {
    this.isLaunching = isLaunching;
    this.emit();
  };

  /** Flags that `id`'s own workspace has a diagram waiting; the rail badges it until it is visited. */
  markDiagramsReady = (id: string): void => {
    if (this.diagramsReady.has(id)) return;
    this.diagramsReady = new Set(this.diagramsReady).add(id);
    this.emit();
  };

  /** Clears the badge — the user landed on that workspace, where the menu adds the diagram itself. */
  clearDiagramsReady = (id: string): void => {
    if (!this.diagramsReady.has(id)) return;
    const next = new Set(this.diagramsReady);
    next.delete(id);
    this.diagramsReady = next;
    this.emit();
  };

  /** Test/dev-only full reset. */
  reset = (): void => {
    this.agents = EMPTY;
    this.activeWorkspace = initialWorkspace();
    this.maxAgents = 5;
    this.gitPreflight = null;
    this.launchError = null;
    this.startErrors = {};
    this.isLaunching = false;
    this.pendingClose = null;
    this.diagramsReady = NO_DIAGRAMS_READY;
    this.emit();
  };
}

/** The one status guard: whatever an older bridge sends lands as one of the six (`normalizeAgentStatus`). */
/** True when timestamp `a` is strictly before `b`; a missing or unparsable one is never older. */
function isOlder(a: string | null | undefined, b: string | null | undefined): boolean {
  const at = a ? Date.parse(a) : NaN;
  const bt = b ? Date.parse(b) : NaN;
  return !Number.isNaN(at) && !Number.isNaN(bt) && at < bt;
}

function normalized(agent: AgentRecord): AgentRecord {
  const status = normalizeAgentStatus(agent.status, agent.exit_code);
  return status === agent.status ? agent : { ...agent, status };
}

/** Pulls a saved position back on-screen: a window restored without the monitor it was dragged to
 * would otherwise come back unreachable, with no way to grab its title bar. */
export function clampToViewport(
  agent: AgentRecord,
  viewport: { width: number; height: number } = viewportSize(),
): AgentRecord {
  const width = Math.min(agent.window.width, Math.max(viewport.width, MIN_VISIBLE));
  const height = Math.min(agent.window.height, Math.max(viewport.height, MIN_VISIBLE));
  const maxX = Math.max(viewport.width - MIN_VISIBLE, 0);
  const maxY = Math.max(viewport.height - MIN_VISIBLE, 0);
  const x = clamp(agent.window.x, 0, maxX);
  const y = clamp(agent.window.y, 0, maxY);
  if (
    x === agent.window.x &&
    y === agent.window.y &&
    width === agent.window.width &&
    height === agent.window.height
  ) {
    return agent;
  }
  return { ...agent, window: { ...agent.window, x, y, width, height } };
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1280, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export const agentStore = new AgentStore().markGlobalStore();

export function useAgents(): AgentRecord[] {
  return useSyncExternalStore(agentStore.subscribe, agentStore.getAgents);
}

/** One agent's record; re-renders only when that record changes. */
export function useAgent(id: string): AgentRecord | undefined {
  return useSyncExternalStore(agentStore.subscribe, () => agentStore.getAgent(id));
}

/** Whether the agent's terminal (and so its question host) is mounted: not stopped or failed. */
export function isAgentRunning(agent: AgentRecord): boolean {
  return agent.status !== "stopped" && agent.status !== "error";
}

export function useAgentCountInWorkspace(workspace: string): number {
  return useSyncExternalStore(agentStore.subscribe, () => agentStore.countInWorkspace(workspace));
}

export function useActiveWorkspace(): string {
  return useSyncExternalStore(agentStore.subscribe, agentStore.getActiveWorkspace);
}

export function useGitPreflight(): GitPreflight | null {
  return useSyncExternalStore(agentStore.subscribe, agentStore.getGitPreflight);
}

export function useAgentStartError(id: string): string | null {
  return useSyncExternalStore(agentStore.subscribe, () => agentStore.getStartError(id));
}

export function usePendingClose(): string | null {
  return useSyncExternalStore(agentStore.subscribe, agentStore.getPendingClose);
}

export function useDiagramsReady(): ReadonlySet<string> {
  return useSyncExternalStore(agentStore.subscribe, agentStore.getDiagramsReady);
}

export function useIsAtAgentCapacity(): boolean {
  return useSyncExternalStore(agentStore.subscribe, agentStore.getIsAtCapacity);
}

export function useIsLaunchingAgent(): boolean {
  return useSyncExternalStore(agentStore.subscribe, agentStore.getIsLaunching);
}

export function useMaxAgents(): number {
  return useSyncExternalStore(agentStore.subscribe, agentStore.getMaxAgents);
}

export function useAgentLaunchError(): string | null {
  return useSyncExternalStore(agentStore.subscribe, agentStore.getLaunchError);
}
