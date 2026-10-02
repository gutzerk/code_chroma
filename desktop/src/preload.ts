import { contextBridge, ipcRenderer } from "electron";
import type { RecentRepo } from "./recentRepos";

export interface LauncherApi {
  listRecents(): Promise<RecentRepo[]>;
  pickFolder(): Promise<string | null>;
  openRepo(repoPath: string): Promise<void>;
  onProgress(handler: (line: string) => void): void;
  onError(handler: (message: string) => void): void;
}

const api: LauncherApi = {
  listRecents: () => ipcRenderer.invoke("launcher:list-recents"),
  pickFolder: () => ipcRenderer.invoke("launcher:pick-folder"),
  openRepo: (repoPath) => ipcRenderer.invoke("launcher:open-repo", repoPath),
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
