import { describe, it, expect, vi } from "vitest";
import { UpdateService } from "./updateService";
import type { UpdateInfo } from "./updater";
const info: UpdateInfo = { version: "2.0.0", assetName: "app", downloadPath: "tmp" };
function setup(update: UpdateInfo | null = info) {
  const deps = { check: vi.fn(async (_version: string, opts?: { onLatest?: (version: string) => void }) => { opts?.onLatest?.("2.0.0"); return update; }), download: vi.fn(async () => "tmp"), install: vi.fn(async () => true), writable: vi.fn(async () => {}) };
  const changed = vi.fn();
  return { service: new UpdateService(update ? "1.0.0" : "2.0.0", changed, deps), deps, changed };
}
describe("UpdateService", () => {
  it("retains installed and latest versions when up to date", async () => {
    const { service } = setup(null);
    expect(await service.check()).toMatchObject({ currentVersion: "2.0.0", latestVersion: "2.0.0", phase: "up-to-date" });
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
  it("reports download failure without installing", async () => {
    const { service, deps } = setup();
    deps.download.mockRejectedValue(new Error("Download failed (503)"));
    await service.check();
    expect(await service.download()).toMatchObject({ phase: "error", error: expect.stringContaining("503") });
    expect(deps.install).not.toHaveBeenCalled();
  });
  it("refuses system-owned installations before downloading", async () => {
    const { service, deps } = setup();
    deps.writable.mockRejectedValue(new Error("Reinstall with the per-user installer; administrator privileges required"));
    await service.check();
    expect(await service.download()).toMatchObject({ phase: "error", error: expect.stringContaining("per-user") });
    expect(deps.download).not.toHaveBeenCalled();
  });
  it("reports unreachable GitHub", async () => {
    const { service, deps } = setup();
    deps.check.mockRejectedValue(new Error("Network unreachable"));
    expect((await service.check()).phase).toBe("error");
  });
});
