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
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { process.execPath = originalExecutable; vi.unstubAllEnvs(); });
describe("user installation paths", () => {
  it("stages the macOS user bundle, detaches the DMG and hands the swap to a detached script", async () => {
    const destination = join(home, "Applications", "CodeChroma.app");
    process.execPath = `${destination}/Contents/MacOS/CodeChroma`;
    const relaunch = await installAsset({ version: "2.0.0", assetName: "app-arm64.dmg", downloadPath: "installer.dmg" }, { platform: "darwin", arch: "arm64" });
    expect(relaunch).toBe(false);
    expect(execFile).toHaveBeenCalledWith("ditto", [join("/Volumes/CodeChroma", "CodeChroma.app"), `${destination}.update-${process.pid}`], expect.any(Function));
    expect(spawn).toHaveBeenCalledWith("/bin/sh", ["-c", expect.stringContaining("kill -0"), "sh", String(process.pid), `${destination}.update-${process.pid}`, destination], expect.objectContaining({ detached: true }));
    expect(rename).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledWith("hdiutil", ["detach", "/Volumes/CodeChroma"], expect.any(Function));
  });
  it("removes the staged bundle and reports failure when the swap script cannot start", async () => {
    const destination = join(home, "Applications", "CodeChroma.app");
    process.execPath = `${destination}/Contents/MacOS/CodeChroma`;
    vi.mocked(spawn).mockImplementationOnce(() => { const child = Object.assign(new EventEmitter(), { unref: vi.fn() }); queueMicrotask(() => child.emit("error", new Error("spawn failed"))); return child as never; });
    await expect(installAsset({ version: "2.0.0", assetName: "app-arm64.dmg", downloadPath: "installer.dmg" }, { platform: "darwin", arch: "arm64" })).rejects.toThrow("spawn failed");
    expect(rm).toHaveBeenCalledWith(`${destination}.update-${process.pid}`, expect.objectContaining({ recursive: true }));
    expect(execFile).toHaveBeenCalledWith("hdiutil", ["detach", "/Volumes/CodeChroma"], expect.any(Function));
  });
  it("atomically replaces the user-local AppImage", async () => {
    const destination = join(home, "Applications", "CodeChroma.AppImage");
    vi.stubEnv("APPIMAGE", destination);
    expect(await installAsset({ version: "2.0.0", assetName: "app-x64.AppImage", downloadPath: "installer.AppImage" }, { platform: "linux", arch: "x64" })).toBe(true);
    expect(copyFile).toHaveBeenCalled();
    expect(rename).toHaveBeenCalledWith(expect.stringContaining(".update-"), destination);
  });
  it("launches the per-user NSIS installer at the existing install directory", async () => {
    const root = join(home, "AppData", "Local");
    vi.stubEnv("LOCALAPPDATA", root);
    process.execPath = join(root, "Programs", "CodeChroma", "CodeChroma.exe");
    expect(await installAsset({ version: "2.0.0", assetName: "CodeChroma-Setup.exe", downloadPath: "installer.exe" }, { platform: "win32", arch: "x64" })).toBe(false);
    expect(spawn).toHaveBeenCalledWith("installer.exe", ["/currentuser", "/S", "--updated", "--force-run", `/D=${dirname(process.execPath)}`], expect.objectContaining({ detached: true, windowsHide: true }));
  });
  it("rejects unwritable installations", async () => {
    vi.mocked(access).mockRejectedValueOnce(new Error("EACCES"));
    await expect(assertUserInstallation({ platform: "linux", appImage: join(home, "app.AppImage") })).rejects.toThrow("administrator privileges");
  });
  it("rejects symlinks resolving outside the user home", async () => {
    vi.mocked(realpath).mockResolvedValueOnce(join(home, "..", "system", "app.AppImage"));
    await expect(assertUserInstallation({ platform: "linux", appImage: join(home, "app.AppImage") })).rejects.toThrow("administrator privileges");
  });
  it("rejects root-owned user-local installations on Unix", async () => {
    if (!process.getuid) return;
    vi.mocked(stat).mockResolvedValueOnce({ uid: process.getuid() + 1 } as Awaited<ReturnType<typeof stat>>);
    await expect(assertUserInstallation({ platform: "linux", appImage: join(home, "app.AppImage") })).rejects.toThrow("administrator privileges");
  });
});
