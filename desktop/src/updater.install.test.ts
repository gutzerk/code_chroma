import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, stat, rename, copyFile, realpath, rm } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { assertUserInstallation, installAsset } from "./updater";
vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  access: vi.fn(async () => {}),
  stat: vi.fn(async () => ({ uid: process.getuid?.() ?? 1000 })),
  realpath: vi.fn(async (path: string) => path),
  rename: vi.fn(async () => {}), copyFile: vi.fn(async () => {}), chmod: vi.fn(async () => {}), rm: vi.fn(async () => {}),
}));
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_file: string, _args: string[], callback: (error: null, stdout: string) => void) => callback(null, "<key>mount-point</key><string>/Volumes/CodeChroma</string>")),
  spawn: vi.fn(() => { const child = Object.assign(new EventEmitter(), { unref: vi.fn() }); queueMicrotask(() => child.emit("spawn")); return child; }),
}));
const originalExecutable = process.execPath;
const home = homedir();
const failingSpawn = () => { const child = Object.assign(new EventEmitter(), { unref: vi.fn() }); queueMicrotask(() => child.emit("error", new Error("spawn failed"))); return child as never; };
const installer = (assetName: string, downloadPath: string) => ({ version: "2.0.0", assetName, downloadPath });
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { process.execPath = originalExecutable; vi.unstubAllEnvs(); });

describe("macOS install", () => {
  const destination = join(home, "Applications", "CodeChroma.app");
  const staged = `${destination}.update-${process.pid}`;
  beforeEach(() => { process.execPath = `${destination}/Contents/MacOS/CodeChroma`; });

  it("stages the bundle, hands the swap to a detached script, detaches the DMG and deletes it", async () => {
    const relaunch = await installAsset(installer("app-arm64.dmg", "installer.dmg"), { platform: "darwin", arch: "arm64" });
    expect(relaunch).toBe(false);
    expect(execFile).toHaveBeenCalledWith("ditto", [join("/Volumes/CodeChroma", "CodeChroma.app"), staged], expect.any(Function));
    expect(spawn).toHaveBeenCalledWith("/bin/sh", ["-c", expect.stringContaining("kill -0"), "sh", String(process.pid), staged, destination], expect.objectContaining({ detached: true }));
    expect(execFile).toHaveBeenCalledWith("hdiutil", ["detach", "/Volumes/CodeChroma"], expect.any(Function));
    expect(rm).toHaveBeenCalledWith("installer.dmg", expect.objectContaining({ force: true }));
    expect(rename).not.toHaveBeenCalled();
  });

  it("removes the staged bundle, keeps the DMG and reports failure when the swap script cannot start", async () => {
    vi.mocked(spawn).mockImplementationOnce(failingSpawn);
    await expect(installAsset(installer("app-arm64.dmg", "installer.dmg"), { platform: "darwin", arch: "arm64" })).rejects.toThrow("spawn failed");
    expect(rm).toHaveBeenCalledWith(staged, expect.objectContaining({ recursive: true }));
    expect(rm).not.toHaveBeenCalledWith("installer.dmg", expect.anything());
    expect(execFile).toHaveBeenCalledWith("hdiutil", ["detach", "/Volumes/CodeChroma"], expect.any(Function));
  });
});

describe("Linux AppImage install", () => {
  const destination = join(home, "Applications", "CodeChroma.AppImage");
  beforeEach(() => { vi.stubEnv("APPIMAGE", destination); });

  it("stages a sibling copy and hands the swap and launch watchdog to a detached script", async () => {
    const relaunch = await installAsset(installer("app-x64.AppImage", "installer.AppImage"), { platform: "linux", arch: "x64" });
    expect(relaunch).toBe(false);
    expect(copyFile).toHaveBeenCalledWith("installer.AppImage", expect.stringContaining(".update-"));
    expect(spawn).toHaveBeenCalledWith("/bin/sh", ["-c", expect.stringContaining(".previous"), "sh", String(process.pid), expect.stringContaining(".update-"), destination, expect.any(String)], expect.objectContaining({ detached: true }));
    expect(rm).toHaveBeenCalledWith("installer.AppImage", expect.objectContaining({ force: true }));
  });

  it("cleans the staged copy and keeps the download when the script cannot start", async () => {
    vi.mocked(spawn).mockImplementationOnce(failingSpawn);
    await expect(installAsset(installer("app-x64.AppImage", "installer.AppImage"), { platform: "linux", arch: "x64" })).rejects.toThrow("spawn failed");
    expect(rm).toHaveBeenCalledWith(expect.stringContaining(".update-"), expect.anything());
    expect(rm).not.toHaveBeenCalledWith("installer.AppImage", expect.anything());
  });

  it("explains .deb installs instead of the generic error", async () => {
    vi.stubEnv("APPIMAGE", "");
    process.execPath = "/opt/CodeChroma/codechroma";
    await expect(installAsset(installer("app-x64.AppImage", "installer.AppImage"), { platform: "linux", arch: "x64" })).rejects.toThrow(/apt/);
  });
});

describe("Windows install", () => {
  it("launches the per-user NSIS installer at the existing install directory", async () => {
    const root = join(home, "AppData", "Local");
    vi.stubEnv("LOCALAPPDATA", root);
    process.execPath = join(root, "Programs", "CodeChroma", "CodeChroma.exe");
    expect(await installAsset(installer("CodeChroma-Setup.exe", "installer.exe"), { platform: "win32", arch: "x64" })).toBe(false);
    expect(spawn).toHaveBeenCalledWith("installer.exe", ["/currentuser", "/S", "--updated", "--force-run", `/D=${dirname(process.execPath)}`], expect.objectContaining({ detached: true, windowsHide: true }));
  });
});

describe("user installation guard", () => {
  const appImage = join(home, "app.AppImage");
  const cases: [string, () => void][] = [
    ["an unwritable install", () => vi.mocked(access).mockRejectedValueOnce(new Error("EACCES"))],
    ["a symlink resolving outside the user home", () => vi.mocked(realpath).mockResolvedValueOnce(join(home, "..", "system", "app.AppImage"))],
  ];
  if (process.getuid) cases.push(["a root-owned install", () => vi.mocked(stat).mockResolvedValueOnce({ uid: process.getuid!() + 1 } as Awaited<ReturnType<typeof stat>>)]);

  it.each(cases)("rejects %s", async (_name, arrange) => {
    arrange();
    await expect(assertUserInstallation({ platform: "linux", appImage })).rejects.toThrow("administrator privileges");
  });
});
