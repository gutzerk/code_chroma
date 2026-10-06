import { contextBridge, ipcRenderer } from "electron";
import type { RecentRepo } from "./recentRepos";
import type { WorkspaceSummary } from "./workspaceSummaries";

export interface LauncherApi {
  listRecents(): Promise<RecentRepo[]>;
  /** Agents/PRs already known for `repoPath`, so the launcher's recent-projects entry can show them
   * as child workspaces without starting that repo's bridge first. Best-effort: [] on any error. */
  listWorkspaces(repoPath: string): Promise<WorkspaceSummary[]>;
  pickFolder(): Promise<string | null>;
  /** `workspaceId` boots the canvas straight into that workspace (only takes effect the first time
   * the repo is opened in this run -- reopening an already-open repo just focuses its tab). */
  openRepo(repoPath: string, workspaceId?: string): Promise<void>;
  onProgress(handler: (line: string) => void): void;
  onError(handler: (message: string) => void): void;
}

const api: LauncherApi = {
  listRecents: () => ipcRenderer.invoke("launcher:list-recents"),
  listWorkspaces: (repoPath) => ipcRenderer.invoke("launcher:list-workspaces", repoPath),
  pickFolder: () => ipcRenderer.invoke("launcher:pick-folder"),
  openRepo: (repoPath, workspaceId) =>
    ipcRenderer.invoke("launcher:open-repo", repoPath, workspaceId),
  onProgress: (handler) => {
    ipcRenderer.on("launcher:progress", (_event, line: string) => handler(line));
  },
  onError: (handler) => {
    ipcRenderer.on("launcher:error", (_event, message: string) => handler(message));
  },
};

contextBridge.exposeInMainWorld("launcher", api);

/** Lets the loaded canvas open (or close) another workspace -- e.g. a PR review -- in its own
 * window, sharing this window's bridge process instead of spawning a new one. Its mere presence on
 * `window` is how the canvas detects it is running inside the desktop app at all. */
export interface DesktopWorkspaceApi {
  openWorkspaceWindow(workspaceId: string): Promise<void>;
  closeWorkspaceWindow(workspaceId: string): Promise<void>;
  /** Brings this tab's shell window to front and makes this tab active -- the desktop half of
   * clicking a native agent-status notification. */
  focusThisTab(): Promise<void>;
}

const desktopWorkspaceApi: DesktopWorkspaceApi = {
  openWorkspaceWindow: (workspaceId) =>
    ipcRenderer.invoke("desktop:open-workspace-window", workspaceId),
  closeWorkspaceWindow: (workspaceId) =>
    ipcRenderer.invoke("desktop:close-workspace-window", workspaceId),
  focusThisTab: () => ipcRenderer.invoke("desktop:focus-this-tab"),
};

contextBridge.exposeInMainWorld("codechromaDesktop", desktopWorkspaceApi);

contextBridge.exposeInMainWorld("codechromaUpdates", {
  state: () => ipcRenderer.invoke("updates:state"),
  check: () => ipcRenderer.invoke("updates:check"),
  download: () => ipcRenderer.invoke("updates:download"),
  restart: () => ipcRenderer.invoke("updates:restart"),
  subscribe: (handler: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => handler(state);
    ipcRenderer.on("updates:state", listener);
    return () => ipcRenderer.removeListener("updates:state", listener);
  },
});
