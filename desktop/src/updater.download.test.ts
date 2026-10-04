import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadAsset } from "./updater";
import { verifyAttestation } from "./attestation";
vi.mock("./attestation", () => ({ fetchAttestation: vi.fn(async () => ({})), verifyAttestation: vi.fn(async () => {}) }));
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "codechroma-download-test-")); });
afterEach(async () => { vi.unstubAllGlobals(); vi.clearAllMocks(); await rm(directory, { recursive: true, force: true }); });
function info() {
  return { version: "2.0.0", assetName: "CodeChroma-Setup.exe", downloadPath: join(directory, "installer.exe"), downloadUrl: "https://github.com/gutzerk/code_chroma/releases/download/v2.0.0/CodeChroma-Setup.exe", sha256: createHash("sha256").update("installer").digest("hex") };
}
describe("release downloads", () => {
  it("uses the checked release URL and reports progress before verifying provenance", async () => {
    const fetchMock = vi.fn(async () => new Response("installer", { headers: { "content-length": "9" } }));
    vi.stubGlobal("fetch", fetchMock);
    const update = info();
    const progress = vi.fn();
    await downloadAsset(update, progress);
    expect(fetchMock).toHaveBeenCalledWith(update.downloadUrl, expect.any(Object));
    expect(progress).toHaveBeenCalledWith(9, 9);
    expect(verifyAttestation).toHaveBeenCalled();
    expect(await readFile(update.downloadPath, "utf8")).toBe("installer");
  });
  it("reports an HTTP download failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(downloadAsset(info())).rejects.toThrow("download failed (503)");
  });
  it("cleans incomplete downloads after a connection failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("Connection lost")); } }))));
    const update = info();
    await expect(downloadAsset(update)).rejects.toThrow("Connection lost");
    await expect(readFile(`${update.downloadPath}.part`)).rejects.toThrow();
  });
  it("does not prepare an artifact with invalid provenance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("installer")));
    vi.mocked(verifyAttestation).mockRejectedValueOnce(new Error("Invalid provenance"));
    const update = info();
    await expect(downloadAsset(update)).rejects.toThrow("Invalid provenance");
    await expect(readFile(update.downloadPath)).rejects.toThrow();
    await expect(readFile(`${update.downloadPath}.part`)).rejects.toThrow();
  });
});
