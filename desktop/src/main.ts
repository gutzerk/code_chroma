import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  shell as electronShell,
  WebContentsView,
  type WebContents,
} from "electron";
import { basename, join, resolve } from "node:path";
import { startBridge, stopBridge, type BridgeHandle } from "./bridgeProcess";
import { resolveBridgeExecutable } from "./bridgeLocation";
import { addRecent, readRecents, recentsStorePath } from "./recentRepos";
import { TabManager, type Tab } from "./tabManager";
import type { TabsChangedPayload } from "./tabbarPreload";
import { UpdateService } from "./updateService";

const LAUNCHER_PAGE = join(__dirname, "..", "launcher", "index.html");
const TABBAR_PAGE = join(__dirname, "..", "tabbar", "index.html");
const REPO_ROOT = resolve(__dirname, "..", "..");
const TAB_BAR_HEIGHT = 34;

/** One project tab's content view plus (once a repo is picked) its own bridge process. */
type ProjectTab = Tab<WebContentsView, BrowserWindow>;

/** One OS window: a tab strip across the top, and one `WebContentsView` per open tab below it.
 * "New Window" (see the File menu) creates another one of these, each fully independent. */
interface Shell {
  window: BrowserWindow;
  tabBar: WebContentsView;
  tabs: TabManager<WebContentsView, BrowserWindow>;
}

const shells = new Set<Shell>();

function storePath(): string {
  return recentsStorePath(app.getPath("userData"));
}

function shellForWindow(win: BrowserWindow | null): Shell | undefined {
  if (!win) return undefined;
  return [...shells].find((shell) => shell.window === win);
}

function shellForTabSender(sender: WebContents): { shell: Shell; tab: ProjectTab } | undefined {
  for (const shell of shells) {
    const tab = shell.tabs.findTabBySender(sender);
    if (tab) return { shell, tab };
  }
  return undefined;
}

/** Finds the shell whose tab strip (not a project tab) sent this IPC message. */
function shellForTabBarSender(sender: WebContents): Shell | undefined {
  return [...shells].find((shell) => shell.tabBar.webContents === sender);
}

function tabTitle(tab: ProjectTab): string {
  if (tab.repoPath) return basename(tab.repoPath);
  // A workspace tab (e.g. a PR review sharing its repo's bridge) titles as `#<number>`.
  if (tab.workspaceId?.startsWith("pr-")) return `#${tab.workspaceId.slice(3)}`;
  return "New Tab";
}

function pushTabsChanged(shell: Shell): void {
  if (shell.tabBar.webContents.isDestroyed()) return;
  const payload: TabsChangedPayload = {
    tabs: shell.tabs.listTabs().map((tab) => ({ id: tab.id, title: tabTitle(tab) })),
    activeId: shell.tabs.activeTab()?.id ?? null,
  };
  shell.tabBar.webContents.send("tabbar:changed", payload);
}

/** Sizes the tab strip and every tab's content view to fill the window; only the active tab's view
 * is visible, so switching tabs never re-fetches or resets the inactive ones. */
function layoutShell(shell: Shell): void {
  const [width, height] = shell.window.getContentSize();
  shell.tabBar.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT });
  const contentBounds = { x: 0, y: TAB_BAR_HEIGHT, width, height: Math.max(0, height - TAB_BAR_HEIGHT) };
  const activeId = shell.tabs.activeTab()?.id;
  for (const tab of shell.tabs.listTabs()) {
    tab.view.setBounds(contentBounds);
    tab.view.setVisible(tab.id === activeId);
  }
}

function createTabView(shell: Shell): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // The canvas opens external docs links; keep them in the user's browser, not in our window.
  view.webContents.setWindowOpenHandler(({ url }) => {
    void electronShell.openExternal(url);
    return { action: "deny" };
  });
  shell.window.contentView.addChildView(view);
  void view.webContents.loadFile(LAUNCHER_PAGE);
  return view;
}

async function createShell(): Promise<Shell> {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "CodeChroma",
    backgroundColor: "#1b1d23",
    fullscreen: true,
  });

  const tabBar = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, "tabbarPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.contentView.addChildView(tabBar);
  await tabBar.webContents.loadFile(TABBAR_PAGE);

  const shell: Shell = { window, tabBar, tabs: undefined as unknown as TabManager<WebContentsView, BrowserWindow> };
  shell.tabs = new TabManager<WebContentsView, BrowserWindow>(() => createTabView(shell));

  window.on("resize", () => layoutShell(shell));
  window.on("closed", () => {
    shells.delete(shell);
    for (const tab of shell.tabs.listTabs()) {
      if (tab.bridge) void stopBridge(tab.bridge.process);
      for (const satellite of tab.satellites.values()) {
        if (!satellite.isDestroyed()) satellite.close();
      }
    }
  });

  shells.add(shell);
  shell.tabs.newTab();
  layoutShell(shell);
  return shell;
}

/**
 * Opens `repoPath`: focuses its tab (in whichever shell already has it open) if there is one,
 * otherwise starts a bridge for it in `requestingTabId` (if that tab is still empty) or a fresh
 * tab in `homeShell`, and loads the canvas into it once the bridge is ready.
 */
async function openRepo(
  homeShell: Shell,
  repoPath: string,
  requestingTabId: string | null,
): Promise<void> {
  for (const shell of shells) {
    const existing = shell.tabs.focusExisting(repoPath);
    if (existing) {
      layoutShell(shell);
      pushTabsChanged(shell);
      shell.window.show();
      shell.window.focus();
      return;
    }
  }

  const requestingTab = requestingTabId ? homeShell.tabs.findTab(requestingTabId) : undefined;
  const tab =
    requestingTab && requestingTab.repoPath === null ? requestingTab : homeShell.tabs.newTab();
  homeShell.tabs.setActive(tab.id);
  layoutShell(homeShell);
  pushTabsChanged(homeShell);

  // The bridge process keeps printing to stdout/stderr for its whole life (not just startup), so
  // this can still fire after the user has closed `tab`'s view -- never send into a destroyed one.
  const report = (line: string) => {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.send("launcher:progress", line);
  };
  let bridge: BridgeHandle;
  try {
    bridge = await startBridge({
      executable: resolveBridgeExecutable({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        repoRoot: REPO_ROOT,
      }),
      repoPath,
      onProgress: report,
    });
  } catch (error) {
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.send("launcher:error", (error as Error).message);
    }
    return;
  }
  try {
    addRecent(storePath(), repoPath, Date.now());
    homeShell.tabs.assignRepo(tab.id, repoPath, bridge);
    pushTabsChanged(homeShell);
    if (!tab.view.webContents.isDestroyed()) await tab.view.webContents.loadURL(bridge.origin);
  } catch (error) {
    // assignRepo hasn't run (or didn't reach here) -- the bridge is still untracked, so stop it
    // ourselves rather than leaking it. Once assignRepo has run the tab owns it and normal
    // tab/window teardown will stop it, so don't kill a bridge that's otherwise fine.
    if (!tab.bridge) void stopBridge(bridge.process);
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.send("launcher:error", (error as Error).message);
    }
  }
}

function closeTabById(shell: Shell, tabId: string): void {
  const outcome = shell.tabs.closeTab(tabId);
  if (!outcome) return;
  if (outcome.bridgeToStop) void stopBridge(outcome.bridgeToStop.process);
  outcome.satellitesToClose.forEach((satellite) => {
    if (!satellite.isDestroyed()) satellite.close();
  });
  shell.window.contentView.removeChildView(outcome.closedView);
  layoutShell(shell);
  pushTabsChanged(shell);
}

/** Opens (or focuses) a tab showing `workspaceId` on the same bridge as the calling tab's project
 * -- used to review a PR in its own tab, keeping the bridge single-per-repo. */
async function openWorkspaceWindow(sender: WebContents, workspaceId: string): Promise<void> {
  const found = shellForTabSender(sender);
  const bridge = found?.tab.bridge;
  if (!found || !bridge) return;
  const { shell, tab } = found;

  const existing = shell.tabs.findWorkspaceTab(workspaceId);
  if (existing) {
    shell.tabs.setActive(existing.id);
    layoutShell(shell);
    pushTabsChanged(shell);
    return;
  }

  const prTab = shell.tabs.addWorkspaceTab(tab.id, workspaceId);
  layoutShell(shell);
  pushTabsChanged(shell);
  if (!prTab.view.webContents.isDestroyed()) {
    await prTab.view.webContents.loadURL(`${bridge.origin}/?workspace=${encodeURIComponent(workspaceId)}`);
  }
}

function closeWorkspaceWindow(sender: WebContents, workspaceId: string): void {
  const found = shellForTabSender(sender);
  if (!found) return;
  const workspaceTab = found.shell.tabs.findWorkspaceTab(workspaceId);
  if (workspaceTab) closeTabById(found.shell, workspaceTab.id);
}

/** Brings `sender`'s shell window to front and switches to its tab -- the desktop-app half of
 * clicking a native agent-status notification (the renderer side restores the agent's own floating
 * window once this tab is showing). */
function focusThisTab(sender: WebContents): void {
  const found = shellForTabSender(sender);
  if (!found) return;
  const { shell, tab } = found;
  shell.tabs.setActive(tab.id);
  layoutShell(shell);
  pushTabsChanged(shell);
  shell.window.show();
  shell.window.focus();
}

async function promptForFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Open repository",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Open",
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** Ensures `shell`'s active tab is an empty/launcher tab, opening a new one only if the active tab
 * already has a repo loaded -- mirrors clicking "+" but reuses an already-empty active tab. */
function ensureLauncherTabActive(shell: Shell): void {
  const active = shell.tabs.activeTab();
  if (active && active.repoPath === null) return;
  shell.tabs.newTab();
  layoutShell(shell);
  pushTabsChanged(shell);
}

function frontShell(): Shell | undefined {
  return shellForWindow(BrowserWindow.getFocusedWindow()) ?? [...shells][0];
}

const updates = new UpdateService(app.getVersion(), state => {
  for (const shell of shells) for (const tab of shell.tabs.listTabs()) {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.send("updates:state", state);
  }
});
async function checkAndNotify(): Promise<void> {
  if (!app.isPackaged) return;
  const state = await updates.check();
  if (state.phase === "available") notifyUpdateAvailable(state.latestVersion!);
}
async function runUpdateFlow(): Promise<void> {
  const state = await updates.check();
  if (state.phase === "error") { dialog.showErrorBox("Check for updates", state.error!); return; }
  if (state.phase !== "available" && state.phase !== "ready") return;
  const choice = await dialog.showMessageBox({ message: `CodeChroma ${state.latestVersion} available`, buttons: [state.phase === "ready" ? "Restart and Update" : "Download update", "Later"], cancelId: 1 });
  if (choice.response !== 0) return;
  if (state.phase === "ready") await updates.restart(restartAfterUpdate);
  else {
    const downloaded = await updates.download();
    if (downloaded.phase === "error") dialog.showErrorBox("Update failed", downloaded.error!);
    else if ((await dialog.showMessageBox({ message: "Update ready", buttons: ["Restart and Update", "Later"], cancelId: 1 })).response === 0) await updates.restart(restartAfterUpdate);
  }
}
function restartAfterUpdate(relaunch: boolean): void {
  if (relaunch) app.relaunch({ execPath: process.env.APPIMAGE ?? process.execPath });
  app.quit();
}

/** Alerts on a newer release; clicking it starts the update using the `info` already fetched. */
function notifyUpdateAvailable(version: string): void {
  const notification = new Notification({
    title: `CodeChroma ${version} available`,
    body: "Click to update.",
  });
  notification.on("click", () => void runUpdateFlow());
  notification.show();
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        {
          label: "Open Repo…",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            const shell = frontShell();
            if (!shell) return;
            shell.window.show();
            shell.window.focus();
            ensureLauncherTabActive(shell);
          },
        },
        {
          label: "New Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => {
            const shell = frontShell();
            if (!shell) return;
            shell.tabs.newTab();
            layoutShell(shell);
            pushTabsChanged(shell);
          },
        },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (!focused) return;
            const shell = shellForWindow(focused);
            const active = shell?.tabs.activeTab();
            if (shell && active) {
              closeTabById(shell, active.id);
            } else {
              focused.close();
            }
          },
        },
        { type: "separator" },
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => void createShell(),
        },
        { type: "separator" },
        {
          label: "Check for Updates…",
          click: () => void runUpdateFlow(),
        },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  for (const action of ["state", "check", "download", "restart"] as const) {
    ipcMain.handle(`updates:${action}`, (event) => {
      if (!shellForTabSender(event.sender)) throw new Error("Unknown update caller");
      if (action === "state") return updates.state;
      if (action === "check") return updates.check();
      if (action === "download") return updates.download();
      return updates.restart(restartAfterUpdate);
    });
  }
  ipcMain.handle("launcher:list-recents", () => readRecents(storePath()));
  ipcMain.handle("launcher:pick-folder", () => promptForFolder());
  ipcMain.handle("launcher:open-repo", (event, repoPath: string) => {
    const found = shellForTabSender(event.sender);
    const shell = found?.shell ?? frontShell();
    if (!shell) return;
    return openRepo(shell, repoPath, found?.tab.id ?? null);
  });
  ipcMain.handle("desktop:open-workspace-window", (event, workspaceId: string) =>
    openWorkspaceWindow(event.sender, workspaceId),
  );
  ipcMain.handle("desktop:close-workspace-window", (event, workspaceId: string) =>
    closeWorkspaceWindow(event.sender, workspaceId),
  );
  ipcMain.handle("desktop:focus-this-tab", (event) => focusThisTab(event.sender));

  ipcMain.handle("tabbar:new", (event) => {
    const shell = shellForTabBarSender(event.sender);
    if (!shell) return null;
    const tab = shell.tabs.newTab();
    layoutShell(shell);
    pushTabsChanged(shell);
    return tab.id;
  });
  ipcMain.handle("tabbar:switch", (event, tabId: string) => {
    const shell = shellForTabBarSender(event.sender);
    if (!shell || !shell.tabs.setActive(tabId)) return;
    layoutShell(shell);
    pushTabsChanged(shell);
  });
  ipcMain.handle("tabbar:close", (event, tabId: string) => {
    const shell = shellForTabBarSender(event.sender);
    if (!shell) return;
    closeTabById(shell, tabId);
  });
  ipcMain.handle("tabbar:list", (event): TabsChangedPayload => {
    const shell = shellForTabBarSender(event.sender);
    if (!shell) return { tabs: [], activeId: null };
    return {
      tabs: shell.tabs.listTabs().map((tab) => ({ id: tab.id, title: tabTitle(tab) })),
      activeId: shell.tabs.activeTab()?.id ?? null,
    };
  });
}

/** `electron . --repo <path>` skips the launcher -- used by the smoke test and handy for devs. */
function repoFromArgv(argv: string[]): string | null {
  const index = argv.indexOf("--repo");
  return index === -1 ? null : (argv[index + 1] ?? null);
}

app.whenReady().then(async () => {
  buildMenu();
  registerIpc();
  const initialShell = await createShell();
  void checkAndNotify();
  const preselected = repoFromArgv(process.argv);
  if (preselected !== null) {
    await openRepo(initialShell, resolve(preselected), null);
  }
  app.on("activate", () => {
    if (shells.size === 0) {
      void createShell();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Teardown is async, so hold the quit until every bridge is actually gone rather than orphaning it.
let quitting = false;
app.on("before-quit", (event) => {
  const bridges = [...shells].flatMap((shell) => shell.tabs.allBridges());
  if (quitting || bridges.length === 0) {
    return;
  }
  event.preventDefault();
  quitting = true;
  void Promise.all(bridges.map((bridge) => stopBridge(bridge.process))).then(() => {
    app.quit();
  });
});
