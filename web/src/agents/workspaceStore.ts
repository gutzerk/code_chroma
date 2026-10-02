import { useSyncExternalStore } from "react";
import type { WorkspaceStatus } from "../state/types";
import { Store } from "../state/createStore";
import { prStore } from "../pr/prStore";
import { agentStore } from "./agentStore";

/** What the bridge last said about each workspace, and the one capability the canvas acts on.
 *
 * The read-only flag travels in `WorkspaceStatus` rather than being inferred from the id: a naming
 * convention leaking into the client can't express a future read-only-but-not-a-PR workspace, and it
 * would misfire on an agent the user happens to title "PR fixes". Absent means writable, so an older
 * bridge keeps today's behaviour for main and for every agent worktree.
 *
 * Nothing here costs an extra request: `activateWorkspace` already returns a status, and
 * WorkspaceStatusBanner already polls one. */
class WorkspaceStore extends Store {
  private byId = new Map<string, WorkspaceStatus>();

  setStatus = (status: WorkspaceStatus): void => {
    this.byId.set(status.id, status);
    this.emit();
  };

  getStatus = (id: string): WorkspaceStatus | undefined => this.byId.get(id);

  /** OR'd with prStore membership, so a bridge that omits the flag still can't offer a write. */
  getIsReadOnly = (id: string): boolean =>
    this.byId.get(id)?.read_only === true || prStore.has(id);

  reset = (): void => {
    this.byId = new Map();
    this.emit();
  };
}

export const workspaceStore = new WorkspaceStore().markGlobalStore();

/** The active workspace's last reported status, or undefined before the first report. */
export function useWorkspaceStatus(): WorkspaceStatus | undefined {
  const id = useSyncExternalStore(agentStore.subscribe, agentStore.getActiveWorkspace);
  return useSyncExternalStore(workspaceStore.subscribe, () => workspaceStore.getStatus(id));
}

/** Whether writes into the workspace the canvas is drawing are refused.
 *
 * 🔴 No reload race to guard: both the Diff and C1 toggles reset to off on reload (FR-018), so the
 * user has to press two buttons before either suppression matters — long after the mount-time
 * GET /agents, GET /prs and the banner's first poll have all resolved. */
export function useIsWorkspaceReadOnly(): boolean {
  const id = useSyncExternalStore(agentStore.subscribe, agentStore.getActiveWorkspace);
  const fromStatus = useSyncExternalStore(workspaceStore.subscribe, () =>
    workspaceStore.getIsReadOnly(id),
  );
  const isPr = useSyncExternalStore(prStore.subscribe, () => prStore.has(id));
  return fromStatus || isPr;
}
