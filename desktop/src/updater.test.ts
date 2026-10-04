import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_ASSET_BYTES,
  checkForUpdates,
  compareVersions,
  digestHex,
  downloadAsset,
  mountPointFromPlist,
  parseTag,
  safeAssetPath,
  selectAsset,
  type UpdateInfo,
  type ReleaseAsset,
} from "./updater";

const ASSETS: ReleaseAsset[] = [
  { name: "CodeChroma-0.1.0-arm64.dmg", browser_download_url: "https://dl/dmg" },
  { name: "CodeChroma-0.1.0-x64.dmg", browser_download_url: "https://dl/dmg-intel" },
  { name: "CodeChroma-Setup.exe", browser_download_url: "https://dl/exe" },
  { name: "CodeChroma-0.1.0-x64.AppImage", browser_download_url: "https://dl/appimage" },
];

describe("parseTag", () => {
  it("parses a plain semver", () => {
    expect(parseTag("1.2.3")).toEqual([1, 2, 3]);
  });

  it("parses a v-prefixed tag", () => {
    expect(parseTag("v2.0.1")).toEqual([2, 0, 1]);
  });

  it("returns null for a non-semver tag", () => {
    expect(parseTag("not-a-tag")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders numeric segments, not lexicographic", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("sees equal versions as equal", () => {
    expect(compareVersions("1.2.3", "v1.2.3")).toBe(0);
  });

  it("treats a missing segment as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });

  it("ranks a newer version higher", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.9.9", "2.0.0")).toBeLessThan(0);
  });

  it("ranks a release above its own prerelease", () => {
    expect(compareVersions("1.2.3", "1.2.3-beta")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3-rc.1", "1.2.3")).toBeLessThan(0);
  });
});

describe("selectAsset", () => {
  it("picks the dmg on darwin/arm64", () => {
    expect(selectAsset(ASSETS, "darwin", "arm64")?.name).toBe("CodeChroma-0.1.0-arm64.dmg");
  });

  it("picks the dmg on darwin/x64", () => {
    expect(selectAsset(ASSETS, "darwin", "x64")?.name).toBe("CodeChroma-0.1.0-x64.dmg");
  });

  it("picks the Setup.exe on win32/x64", () => {
    expect(selectAsset(ASSETS, "win32", "x64")?.name).toBe("CodeChroma-Setup.exe");
  });

  it("picks the AppImage on linux/x64", () => {
    expect(selectAsset(ASSETS, "linux", "x64")?.name).toBe("CodeChroma-0.1.0-x64.AppImage");
  });

  it("returns null when the platform/arch has no asset yet", () => {
    const noLinux = ASSETS.filter((a) => !a.name.endsWith(".AppImage"));
    expect(selectAsset(noLinux, "linux", "x64")).toBeNull();
  });

  it("returns null for an unsupported platform/arch", () => {
    expect(selectAsset(ASSETS, "linux", "arm64")).toBeNull();
  });
});

describe("digestHex", () => {
  it("extracts the hex from GitHub's sha256:<hex> form", () => {
    expect(digestHex(`sha256:${"a".repeat(64)}`)).toBe("a".repeat(64));
  });

  it("returns undefined without a proper sha256: prefix", () => {
    expect(digestHex(undefined)).toBeUndefined();
    expect(digestHex("md5:abc")).toBeUndefined();
  });
});

describe("safeAssetPath", () => {
  it("keeps a plain asset name unchanged", () => {
    expect(safeAssetPath("CodeChroma-0.1.0-arm64.dmg")).toBe("CodeChroma-0.1.0-arm64.dmg");
  });

  it("strips directory components from a path", () => {
    expect(safeAssetPath("../evil/installer.dmg")).toBe("installer.dmg");
  });

  it("replaces characters outside the safe set", () => {
    expect(safeAssetPath("a b;c&d.exe")).toBe("a_b_c_d.exe");
  });
});

describe("mountPointFromPlist", () => {
  it("returns the mount-point string from hdiutil -plist output", () => {
    const plist = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<plist version=\"1.0\">",
      "<dict>",
      "<key>mount-point</key>",
      "<string>/Volumes/CodeChroma 0.1.0</string>",
      "<key>system-entities</key>",
      "</dict>",
      "</plist>",
    ].join("\n");
    expect(mountPointFromPlist(plist)).toBe("/Volumes/CodeChroma 0.1.0");
  });

  it("returns null when no mount-point key is present", () => {
    expect(mountPointFromPlist("<plist><dict></dict></plist>")).toBeNull();
  });
});

describe("downloadAsset", () => {
  it("refuses a release with no SHA-256 digest", async () => {
    const info: UpdateInfo = { version: "2.0.0", assetName: "a.dmg", downloadPath: "/tmp/a.dmg" };
    await expect(downloadAsset(info)).rejects.toThrow("no SHA-256 digest");
  });

  it("aborts and rejects an oversized download body", async () => {
    // Inject a body whose first chunk already exceeds the cap, so no real bytes are written.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_ASSET_BYTES + 1));
        controller.close();
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        body,
        headers: new Headers(),
      }) as Response) as typeof fetch;
    try {
      const info: UpdateInfo = {
        version: "2.0.0",
        assetName: "a.dmg",
        downloadPath: join(tmpdir(), "updater-too-large-test.dmg"),
        sha256: "a".repeat(64),
      };
      await expect(downloadAsset(info)).rejects.toThrow("download too large");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("checkForUpdates", () => {
  const newerRelease = {
    tag_name: "v2.0.0",
    assets: [
      { name: "CodeChroma-2.0.0-arm64.dmg", browser_download_url: "https://dl/dmg" },
      { name: "CodeChroma-2.0.0-arm64.dmg.sha256", browser_download_url: "https://dl/dmg.sha256" },
    ],
  };

  it("throws on a non-2xx GitHub API response (offline, not 'no update')", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500 })) as typeof fetch;
    await expect(checkForUpdates("1.0.0", { fetchImpl })).rejects.toThrow(/500/);
  });

  it("resolves the digest from the .sha256 sidecar when one is published", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: unknown) => {
      calls.push(String(url));
      if (String(url).endsWith(".sha256")) {
        return { ok: true, text: async () => `${"a".repeat(64)}  CodeChroma-2.0.0-arm64.dmg` };
      }
      return { ok: true, json: async () => newerRelease };
    }) as typeof fetch;
    const info = await checkForUpdates("1.0.0", { platform: "darwin", arch: "arm64", fetchImpl });
    expect(info?.sha256).toBe("a".repeat(64));
    expect(calls.some((c) => c.endsWith(".sha256"))).toBe(true);
  });

  it("reports the update even when neither a digest nor a sidecar is published", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v2.0.0",
        assets: [{ name: "CodeChroma-2.0.0-arm64.dmg", browser_download_url: "https://dl/dmg" }],
      }),
    })) as typeof fetch;
    const info = await checkForUpdates("1.0.0", { platform: "darwin", arch: "arm64", fetchImpl });
    // A newer version with no reachable digest is still an update (the caller must surface it),
    // not "up to date".
    expect(info?.sha256).toBeUndefined();
    expect(info?.version).toBe("v2.0.0");
  });
});
