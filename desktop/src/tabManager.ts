import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { BridgeHandle } from "./bridgeProcess";

/** Minimal surface tabManager needs from a real Electron `WebContentsView`/`BrowserWindow`, so this
 * module stays testable with a plain fake instead of real Electron objects. Both a tab's own view
 * and its satellite windows satisfy this (both expose `.webContents` in real Electron) -- identity
 * of `webContents` is how a sender is matched back to its owning tab. */
export interface ViewLike {
  webContents: unknown;
}

export interface Tab<TView extends ViewLike = ViewLike, TWindow extends ViewLike = TView> {
  id: string;
  repoPath: string | null;
  /** The workspace this tab draws when it's not a full repo tab (e.g. `pr-7`); null otherwise. */
  workspaceId: string | null;
  /** Whether this tab stops the bridge it holds at close — true only for the repo tab that spawned
   * the bridge, never for a workspace tab sharing it. */
  ownsBridge: boolean;
  view: TView;
  bridge: BridgeHandle | null;
  /** Extra windows sharing this tab's bridge under a different workspace id (e.g. a PR review
   * opened in its own window), keyed by workspace id so reopening one focuses it instead of
   * duplicating it. */
  satellites: Map<string, TWindow>;
}

export interface CloseTabOutcome<TView extends ViewLike = ViewLike, TWindow extends ViewLike = TView> {
  closedView: TView;
  bridgeToStop: BridgeHandle | null;
  satellitesToClose: TWindow[];
  /** Set when closing this tab left zero tabs -- a fresh empty tab was opened automatically so the
   * window is never left with nothing to show. */
  fallbackTab: Tab<TView, TWindow> | null;
  activeTab: Tab<TView, TWindow>;
}

/** Resolves symlinks so two different strings naming the same directory dedupe to one entry. */
export function canonicalRepoPath(repoPath: string): string {
  const resolved = resolve(repoPath);
  try {
    return existsSync(resolved) ? realpathSync(resolved) : resolved;
  } catch {
    return resolved;
  }
}

/**
 * Tracks every open tab in one shell window: each tab has its own view (and, once a repo is
 * picked, its own bridge process) plus any satellite windows sharing that tab's bridge under a
 * different workspace id. Deliberately Electron-free so tests can use plain fakes instead of real
 * `WebContentsView`/`BrowserWindow` instances.
 */
export class TabManager<TView extends ViewLike = ViewLike, TWindow extends ViewLike = TView> {
  private readonly tabs: Tab<TView, TWindow>[] = [];
  private activeId: string | null = null;
  private counter = 0;

  constructor(private readonly createEmptyView: () => TView) {}

  private makeId(): string {
    this.counter += 1;
    return `tab-${this.counter}`;
  }

  listTabs(): Tab<TView, TWindow>[] {
    return [...this.tabs];
  }

  activeTab(): Tab<TView, TWindow> | undefined {
    return this.tabs.find((tab) => tab.id === this.activeId);
  }

  findTab(tabId: string): Tab<TView, TWindow> | undefined {
    return this.tabs.find((tab) => tab.id === tabId);
  }

  findByRepoPath(repoPath: string): Tab<TView, TWindow> | undefined {
    const target = canonicalRepoPath(repoPath);
    return this.tabs.find(
      (tab) => tab.repoPath !== null && canonicalRepoPath(tab.repoPath) === target,
    );
  }

  isRepoOpen(repoPath: string): boolean {
    return this.findByRepoPath(repoPath) !== undefined;
  }

  /** Finds the tab owning `sender` -- either the tab's own view or one of its satellite windows. */
  findTabBySender(sender: unknown): Tab<TView, TWindow> | undefined {
    for (const tab of this.tabs) {
      if (tab.view.webContents === sender) return tab;
      for (const satellite of tab.satellites.values()) {
        if (satellite.webContents === sender) return tab;
      }
    }
    return undefined;
  }

  /** The workspace tab holding `workspaceId`, if one is open — so reopening the same PR focuses it. */
  findWorkspaceTab(workspaceId: string): Tab<TView, TWindow> | undefined {
    return this.tabs.find(
      (tab) => tab.workspaceId === workspaceId && tab.repoPath === null,
    );
  }

  /** Creates a new empty (launcher) tab and makes it active -- used at startup, for "+", and as the
   * automatic fallback when the last remaining tab closes. */
  newTab(): Tab<TView, TWindow> {
    const tab: Tab<TView, TWindow> = {
      id: this.makeId(),
      repoPath: null,
      workspaceId: null,
      ownsBridge: false,
      view: this.createEmptyView(),
      bridge: null,
      satellites: new Map(),
    };
    this.tabs.push(tab);
    this.activeId = tab.id;
    return tab;
  }

  /** Adds a workspace tab (e.g. a PR review) that shares `ownerId`'s bridge, and makes it active. */
  addWorkspaceTab(ownerId: string, workspaceId: string): Tab<TView, TWindow> {
    const owner = this.findTab(ownerId);
    const bridge = owner?.bridge ?? null;
    const tab: Tab<TView, TWindow> = {
      id: this.makeId(),
      repoPath: null,
      workspaceId,
      ownsBridge: false,
      view: this.createEmptyView(),
      bridge,
      satellites: new Map(),
    };
    this.tabs.push(tab);
    this.activeId = tab.id;
    return tab;
  }

  /** If repoPath is already open in some tab, makes that tab active and returns it; otherwise null. */
  focusExisting(repoPath: string): Tab<TView, TWindow> | null {
    const tab = this.findByRepoPath(repoPath);
    if (!tab) return null;
    this.activeId = tab.id;
    return tab;
  }

  /** Promotes an empty tab to a project tab once its bridge has started. */
  assignRepo(tabId: string, repoPath: string, bridge: BridgeHandle): void {
    const tab = this.findTab(tabId);
    if (!tab) return;
    tab.repoPath = repoPath;
    tab.bridge = bridge;
    tab.ownsBridge = true;
  }

  setActive(tabId: string): Tab<TView, TWindow> | undefined {
    const tab = this.findTab(tabId);
    if (tab) this.activeId = tab.id;
    return tab;
  }

  registerSatellite(tabId: string, workspaceId: string, window: TWindow): void {
    this.findTab(tabId)?.satellites.set(workspaceId, window);
  }

  findSatellite(tabId: string, workspaceId: string): TWindow | undefined {
    return this.findTab(tabId)?.satellites.get(workspaceId);
  }

  /** Removes a satellite window from its tab without affecting the tab's own bridge -- called from
   * that window's own "closed" listener. Safe to call more than once for the same window. */
  releaseSatellite(window: TWindow): void {
    for (const tab of this.tabs) {
      for (const [workspaceId, satellite] of tab.satellites) {
        if (satellite === window) {
          tab.satellites.delete(workspaceId);
          return;
        }
      }
    }
  }

  /**
   * Closes tabId: returns its bridge (if any) and satellite windows to tear down. Never leaves zero
   * tabs -- closing the last one immediately opens a fresh empty tab via `createEmptyView`,
   * reported back as `fallbackTab` so the caller can load its launcher content.
   */
  closeTab(tabId: string): CloseTabOutcome<TView, TWindow> | null {
    const index = this.tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) return null;
    const [tab] = this.tabs.splice(index, 1);

    let fallbackTab: Tab<TView, TWindow> | null = null;
    if (this.tabs.length === 0) {
      fallbackTab = this.newTab();
    } else if (this.activeId === tab.id) {
      const nextIndex = Math.min(index, this.tabs.length - 1);
      this.activeId = this.tabs[nextIndex].id;
    }

    return {
      closedView: tab.view,
      // Only the tab that spawned the bridge may stop it; a workspace tab shares its owner's.
      bridgeToStop: tab.ownsBridge ? tab.bridge : null,
      satellitesToClose: [...tab.satellites.values()],
      fallbackTab,
      activeTab: this.activeTab()!,
    };
  }

  allBridges(): BridgeHandle[] {
    return this.tabs.flatMap((tab) => (tab.bridge ? [tab.bridge] : []));
  }
}
