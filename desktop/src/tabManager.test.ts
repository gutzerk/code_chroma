import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BridgeHandle } from "./bridgeProcess";
import { canonicalRepoPath, TabManager, type ViewLike } from "./tabManager";

class FakeView implements ViewLike {
  webContents = {};
}

let nextPort = 40000;
function fakeBridge(): BridgeHandle {
  const port = nextPort++;
  return { port, origin: `http://127.0.0.1:${port}`, process: {} as unknown as ChildProcess };
}

let viewsCreated: FakeView[];
let manager: TabManager<FakeView>;

beforeEach(() => {
  viewsCreated = [];
  manager = new TabManager<FakeView>(() => {
    const view = new FakeView();
    viewsCreated.push(view);
    return view;
  });
});

describe("newTab", () => {
  it("creates an empty tab via the view factory and makes it active", () => {
    const tab = manager.newTab();

    expect(tab.repoPath).toBeNull();
    expect(tab.bridge).toBeNull();
    expect(manager.activeTab()).toBe(tab);
    expect(viewsCreated).toEqual([tab.view]);
  });
});

describe("opening repos", () => {
  it("assigns two different repos to two separate tabs, each with its own bridge", () => {
    const tabA = manager.newTab();
    const bridgeA = fakeBridge();
    manager.assignRepo(tabA.id, "/repos/atlas", bridgeA);

    const tabB = manager.newTab();
    const bridgeB = fakeBridge();
    manager.assignRepo(tabB.id, "/repos/other", bridgeB);

    expect(manager.listTabs()).toHaveLength(2);
    expect(manager.findByRepoPath("/repos/atlas")).toMatchObject({ id: tabA.id, bridge: bridgeA });
    expect(manager.findByRepoPath("/repos/other")).toMatchObject({ id: tabB.id, bridge: bridgeB });
    expect(manager.allBridges()).toEqual([bridgeA, bridgeB]);
  });

  it("focuses the existing tab instead of duplicating an already-open repo", () => {
    const tab = manager.newTab();
    manager.assignRepo(tab.id, "/repos/atlas", fakeBridge());
    manager.newTab(); // a second, unrelated empty tab is now active

    const found = manager.focusExisting("/repos/atlas");

    expect(found).toMatchObject({ id: tab.id });
    expect(manager.activeTab()).toMatchObject({ id: tab.id });
    expect(manager.listTabs()).toHaveLength(2);
  });

  it("returns null from focusExisting when the repo isn't open anywhere", () => {
    expect(manager.focusExisting("/repos/unknown")).toBeNull();
  });
});

describe("canonical path dedupe", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "codechroma-tabmanager-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a symlink to the same real path", () => {
    const real = join(dir, "real-repo");
    const link = join(dir, "linked-repo");
    mkdirSync(real);
    symlinkSync(real, link);

    expect(canonicalRepoPath(link)).toBe(canonicalRepoPath(real));
  });

  it("finds a repo registered via its real path when asked via a symlink to it", () => {
    const real = join(dir, "real-repo");
    const link = join(dir, "linked-repo");
    mkdirSync(real);
    symlinkSync(real, link);
    const tab = manager.newTab();
    manager.assignRepo(tab.id, real, fakeBridge());

    expect(manager.findByRepoPath(link)).toMatchObject({ id: tab.id });
  });
});

describe("closeTab", () => {
  it("returns null for an unknown tab id", () => {
    expect(manager.closeTab("nope")).toBeNull();
  });

  it("stops only the closed tab's bridge, leaving the other tab and its bridge untouched", () => {
    const tabA = manager.newTab();
    const bridgeA = fakeBridge();
    manager.assignRepo(tabA.id, "/repos/atlas", bridgeA);
    const tabB = manager.newTab();
    const bridgeB = fakeBridge();
    manager.assignRepo(tabB.id, "/repos/other", bridgeB);

    const outcome = manager.closeTab(tabA.id)!;

    expect(outcome.bridgeToStop).toBe(bridgeA);
    expect(outcome.fallbackTab).toBeNull();
    expect(manager.listTabs()).toEqual([tabB]);
    expect(manager.allBridges()).toEqual([bridgeB]);
  });

  it("leaves one fresh empty tab instead of zero tabs when closing the last tab", () => {
    const onlyTab = manager.newTab();
    manager.assignRepo(onlyTab.id, "/repos/atlas", fakeBridge());

    const outcome = manager.closeTab(onlyTab.id)!;

    expect(outcome.fallbackTab).not.toBeNull();
    expect(outcome.fallbackTab!.repoPath).toBeNull();
    expect(manager.listTabs()).toHaveLength(1);
    expect(manager.listTabs()[0]).toBe(outcome.fallbackTab);
    expect(manager.activeTab()).toBe(outcome.fallbackTab);
  });

  it("moves activation to a remaining tab when the active tab closes", () => {
    const tabA = manager.newTab();
    const tabB = manager.newTab();
    expect(manager.activeTab()).toMatchObject({ id: tabB.id });

    manager.closeTab(tabB.id);

    expect(manager.activeTab()).toMatchObject({ id: tabA.id });
  });

  it("returns the closed tab's satellite windows to tear down", () => {
    const tab = manager.newTab();
    const satellite = new FakeView();
    manager.registerSatellite(tab.id, "pr-7", satellite);
    manager.newTab(); // keep at least one other tab open

    const outcome = manager.closeTab(tab.id)!;

    expect(outcome.satellitesToClose).toEqual([satellite]);
  });
});

describe("satellites (e.g. PR review windows)", () => {
  it("round-trips registerSatellite/findSatellite", () => {
    const tab = manager.newTab();
    const satellite = new FakeView();

    manager.registerSatellite(tab.id, "pr-7", satellite);

    expect(manager.findSatellite(tab.id, "pr-7")).toBe(satellite);
  });

  it("resolves findTabBySender for both a tab's own view and its satellite", () => {
    const tab = manager.newTab();
    const satellite = new FakeView();
    manager.registerSatellite(tab.id, "pr-7", satellite);

    expect(manager.findTabBySender(tab.view.webContents)).toBe(tab);
    expect(manager.findTabBySender(satellite.webContents)).toBe(tab);
  });

  it("returns undefined from findTabBySender for an unrelated sender", () => {
    manager.newTab();

    expect(manager.findTabBySender({})).toBeUndefined();
  });

  it("removes a satellite via releaseSatellite without touching its tab's bridge", () => {
    const tab = manager.newTab();
    const bridge = fakeBridge();
    manager.assignRepo(tab.id, "/repos/atlas", bridge);
    const satellite = new FakeView();
    manager.registerSatellite(tab.id, "pr-7", satellite);

    manager.releaseSatellite(satellite);

    expect(manager.findSatellite(tab.id, "pr-7")).toBeUndefined();
    expect(manager.findByRepoPath("/repos/atlas")).toMatchObject({ bridge });
  });

  it("is idempotent when releasing an already-released satellite", () => {
    const tab = manager.newTab();
    const satellite = new FakeView();
    manager.registerSatellite(tab.id, "pr-7", satellite);
    manager.releaseSatellite(satellite);

    expect(() => manager.releaseSatellite(satellite)).not.toThrow();
  });
});

describe("workspace tabs (e.g. a PR review in its own tab)", () => {
  it("adds a workspace tab sharing the owner's bridge, without owning it", () => {
    const owner = manager.newTab();
    const bridge = fakeBridge();
    manager.assignRepo(owner.id, "/repos/atlas", bridge);

    const prTab = manager.addWorkspaceTab(owner.id, "pr-7");

    expect(prTab.workspaceId).toBe("pr-7");
    expect(prTab.repoPath).toBeNull();
    expect(prTab.bridge).toBe(bridge);
    expect(prTab.ownsBridge).toBe(false);
    expect(manager.activeTab()).toMatchObject({ id: prTab.id });
  });

  it("finds an existing workspace tab for a given workspace id", () => {
    const owner = manager.newTab();
    const bridge = fakeBridge();
    manager.assignRepo(owner.id, "/repos/atlas", bridge);
    manager.addWorkspaceTab(owner.id, "pr-7");

    const found = manager.findWorkspaceTab("pr-7");

    expect(found).toMatchObject({ workspaceId: "pr-7" });
  });

  it("does not stop the shared bridge when a workspace tab closes", () => {
    const owner = manager.newTab();
    const bridge = fakeBridge();
    manager.assignRepo(owner.id, "/repos/atlas", bridge);
    const prTab = manager.addWorkspaceTab(owner.id, "pr-7");

    const outcome = manager.closeTab(prTab.id)!;

    expect(outcome.bridgeToStop).toBeNull();
    expect(manager.allBridges()).toEqual([bridge]);
  });

  it("stops the bridge when its owning repo tab closes", () => {
    const owner = manager.newTab();
    const bridge = fakeBridge();
    manager.assignRepo(owner.id, "/repos/atlas", bridge);
    manager.addWorkspaceTab(owner.id, "pr-7");

    const outcome = manager.closeTab(owner.id)!;

    expect(outcome.bridgeToStop).toBe(bridge);
  });

  it("a repo tab with no bridge yields a bridge-less workspace tab", () => {
    const owner = manager.newTab();

    const prTab = manager.addWorkspaceTab(owner.id, "pr-9");

    expect(prTab.bridge).toBeNull();
  });
});
