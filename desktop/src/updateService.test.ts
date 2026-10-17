import { describe, it, expect, vi } from "vitest";
import { UpdateService } from "./updateService";
import { GitHubRateLimitError, type UpdateInfo } from "./updater";
const info: UpdateInfo = { version: "v2.0.0", assetName: "app", downloadPath: "tmp" };
type CheckOpts = { onLatest?: (version: string) => void };
function setup(update: UpdateInfo | null = info, extra: Record<string, unknown> = {}) {
  const deps = { check: vi.fn(async (_version: string, opts?: CheckOpts) => { opts?.onLatest?.("v2.0.0"); return update; }), download: vi.fn(async () => "tmp"), install: vi.fn(async () => true), writable: vi.fn(async () => {}), ...extra };
  const changed = vi.fn();
  return { service: new UpdateService(update ? "1.0.0" : "2.0.0", changed, deps), deps, changed };
}
describe("UpdateService", () => {
  it("retains installed and latest versions when up to date", async () => {
    const { service } = setup(null);
    expect(await service.check()).toMatchObject({ currentVersion: "2.0.0", latestVersion: "v2.0.0", phase: "up-to-date" });
  });

  it("downloads then waits for explicit restart", async () => {
    const { service, deps, changed } = setup();
    expect((await service.check()).phase).toBe("available");
    expect((await service.download()).phase).toBe("ready");
    expect(changed.mock.calls.some(([s]) => s.phase === "downloading")).toBe(true);
    expect(deps.install).not.toHaveBeenCalled();
    const restart = vi.fn();
    await service.restart(restart);
    expect(restart).toHaveBeenCalledWith(true);
  });

  it.each([
    ["download failure", "download", new Error("Download failed (503)"), "503", true],
    ["a system-owned installation", "writable", new Error("Reinstall with the per-user installer; administrator privileges required"), "per-user", false],
    ["a Sigstore trust-root failure", "download", new Error("root was signed by 0/3 keys"), "Release signature could not be verified (0/3 keys)", true],
  ] as const)("reports %s without installing", async (_name, dep, error, text, downloadAttempted) => {
    const { service, deps } = setup();
    deps[dep].mockRejectedValue(error);
    await service.check();
    expect(await service.download()).toMatchObject({ phase: "error", error: expect.stringContaining(text) });
    expect(deps.install).not.toHaveBeenCalled();
    expect(deps.download).toHaveBeenCalledTimes(downloadAttempted ? 1 : 0);
  });

  it("reports unreachable GitHub", async () => {
    const { service, deps } = setup();
    deps.check.mockRejectedValue(new Error("Network unreachable"));
    expect((await service.check()).phase).toBe("error");
  });

  it("keeps the cached version and suppresses retries during a rate-limit cooldown", async () => {
    const { service, deps } = setup();
    deps.check.mockRejectedValue(new GitHubRateLimitError("Rate limit. Resets in 1 minute.", Date.now() + 60_000));
    service.state.latestVersion = "1.8.0";
    expect(await service.check()).toMatchObject({ phase: "error", latestVersion: "1.8.0", retryAfter: expect.any(Number) });
    expect(deps.check).toHaveBeenCalledOnce();
    await service.check();
    expect(deps.check).toHaveBeenCalledOnce();
  });

  it("loads and persists a cached latest version", async () => {
    const writeLatest = vi.fn();
    const check = vi.fn(async (_v: string, opts?: CheckOpts) => { opts?.onLatest?.("v2.1.0"); return null; });
    const service = new UpdateService("2.1.0", vi.fn(), { check, readLatest: () => "v2.0.0", writeLatest });
    expect(service.state.latestVersion).toBe("v2.0.0");
    expect((await service.check()).latestVersion).toBe("v2.1.0");
    expect(writeLatest).toHaveBeenCalledWith("v2.1.0");
  });

  it("shares one release cache across checks so GitHub can answer 304", async () => {
    const { service, deps } = setup();
    await service.check();
    await service.check();
    const caches = deps.check.mock.calls.map(([, opts]) => (opts as { cache?: object }).cache);
    expect(caches[0]).toBeDefined();
    expect(caches[1]).toBe(caches[0]);
  });
});

describe("skip this version", () => {
  it("hides a skipped version from background checks but shows it on a manual check", async () => {
    const { service } = setup();
    await service.skipVersion("v2.0.0");
    expect((await service.check({ background: true })).phase).toBe("up-to-date");
    expect(await service.check()).toMatchObject({ phase: "available", skippedVersion: "v2.0.0" });
  });

  it("surfaces a release newer than the skipped one", async () => {
    const { service } = setup({ ...info, version: "v2.1.0" });
    await service.skipVersion("v2.0.0");
    expect((await service.check({ background: true })).phase).toBe("available");
  });

  it("persists the skipped version and restores it", async () => {
    const writeSettings = vi.fn();
    const { service } = setup(info, { writeSettings });
    await service.skipVersion("v2.0.0");
    expect(writeSettings).toHaveBeenCalledWith({ skippedVersion: "v2.0.0", autoDownload: false });
    const restored = new UpdateService("1.0.0", vi.fn(), { readSettings: () => ({ skippedVersion: "v2.0.0", autoDownload: true }) });
    expect(restored.state).toMatchObject({ skippedVersion: "v2.0.0", autoDownload: true });
  });
});

describe("auto-download setting", () => {
  it("downloads in the background when an update is found", async () => {
    const { service, deps } = setup(info, { readSettings: () => ({ autoDownload: true }) });
    expect((await service.check({ background: true })).phase).toBe("ready");
    expect(deps.download).toHaveBeenCalledOnce();
    expect(deps.install).not.toHaveBeenCalled();
  });

  it("does not download when off, or for a skipped version", async () => {
    const off = setup();
    await off.service.check({ background: true });
    const skipped = setup(info, { readSettings: () => ({ autoDownload: true, skippedVersion: "v2.0.0" }) });
    await skipped.service.check({ background: true });
    expect(off.deps.download).not.toHaveBeenCalled();
    expect(skipped.deps.download).not.toHaveBeenCalled();
  });

  it("can be toggled and persisted at runtime", async () => {
    const writeSettings = vi.fn();
    const { service } = setup(info, { writeSettings });
    await service.setAutoDownload(true);
    expect(service.state.autoDownload).toBe(true);
    expect(writeSettings).toHaveBeenCalledWith({ skippedVersion: undefined, autoDownload: true });
  });

  it("falls back to the available state when the background download fails", async () => {
    const { service, deps } = setup(info, { readSettings: () => ({ autoDownload: true }) });
    deps.download.mockRejectedValue(new Error("Download failed (503)"));
    expect(await service.check({ background: true })).toMatchObject({ phase: "error", error: expect.stringContaining("503") });
  });
});
