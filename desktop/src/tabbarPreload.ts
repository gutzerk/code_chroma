import { contextBridge, ipcRenderer } from "electron";

export interface TabSummary {
  id: string;
  title: string;
}

export interface TabsChangedPayload {
  tabs: TabSummary[];
  activeId: string | null;
}

/** The tab strip's own IPC surface -- deliberately separate from preload.ts's `LauncherApi`/
 * `DesktopWorkspaceApi`, which are for a tab's *content* view, not the strip that lists tabs. */
export interface TabBarApi {
  newTab(): Promise<string>;
  switchTab(tabId: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  listTabs(): Promise<TabsChangedPayload>;
  onChanged(handler: (payload: TabsChangedPayload) => void): void;
}

const api: TabBarApi = {
  newTab: () => ipcRenderer.invoke("tabbar:new"),
  switchTab: (tabId) => ipcRenderer.invoke("tabbar:switch", tabId),
  closeTab: (tabId) => ipcRenderer.invoke("tabbar:close", tabId),
  listTabs: () => ipcRenderer.invoke("tabbar:list"),
  onChanged: (handler) => {
    ipcRenderer.on("tabbar:changed", (_event, payload: TabsChangedPayload) => handler(payload));
  },
};

contextBridge.exposeInMainWorld("tabBar", api);
