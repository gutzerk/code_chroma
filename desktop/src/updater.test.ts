import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEB_UPDATE_MESSAGE,
  MAX_ASSET_BYTES,
  assertUserInstallation,
  checkForUpdates,
  cleanupStaleDownloads,
  compareVersions,
  digestHex,
  downloadAsset,
  macAppBundlePath,
  mountPointFromPlist,
  parseTag,
  safeAssetPath,
  selectAsset,
  type ReleaseAsset,
  type ReleaseCache,
  type UpdateInfo,
} from "./updater";

const dl = (name: string, tag = "v0.1.0") => `https://github.com/gutzerk/code_chroma/releases/download/${tag}/${name}`;
const ASSETS: ReleaseAsset[] = [
  { name: "CodeChroma-0.1.0-arm64.dmg", browser_download_url: dl("CodeChroma-0.1.0-arm64.dmg") },
  { name: "CodeChroma-0.1.0-x64.dmg", browser_download_url: dl("CodeChroma-0.1.0-x64.dmg") },
  { name: "CodeChroma-Setup.exe", browser_download_url: dl("CodeChroma-Setup.exe") },
  { name: "CodeChroma-0.1.0-x64.AppImage", browser_download_url: dl("CodeChroma-0.1.0-x64.AppImage") },
];
const jsonFetch = (payload: unknown, extra: Record<string, unknown> = {}) =>
  (async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => payload, ...extra })) as unknown as typeof fetch;

describe("versions", () => {
  it.each([["1.2.3", [1, 2, 3]], ["v2.0.1", [2, 0, 1]], ["not-a-tag", null], ["1.0.0garbage", null], ["1.0.0-01", null]] as const)(
    "parseTag(%s)", (tag, expected) => expect(parseTag(tag)).toEqual(expected));

  it.each([
    ["0.10.0", "0.9.9", 1], ["1.2.3", "v1.2.3", 0], ["2.0.0", "1.9.9", 1], ["1.9.9", "2.0.0", -1],
    ["1.2.3", "1.2.3-beta", 1], ["1.2.3-rc.1", "1.2.3", -1], ["1.0.0-beta.10", "1.0.0-beta.2", 1],
    ["1.0.0-alpha", "1.0.0-beta", -1], ["1.0.0+one", "1.0.0+two", 0],
  ] as const)("compareVersions(%s, %s) has sign %i", (a, b, sign) => expect(Math.sign(compareVersions(a, b))).toBe(sign));

  it("rejects incomplete semantic versions", () => {
    expect(() => compareVersions("1.2", "1.2.0")).toThrow("Invalid semantic version");
  });
});

describe("selectAsset", () => {
  it.each([
    ["darwin", "arm64", "CodeChroma-0.1.0-arm64.dmg"],
    ["darwin", "x64", "CodeChroma-0.1.0-x64.dmg"],
    ["win32", "x64", "CodeChroma-Setup.exe"],
    ["linux", "x64", "CodeChroma-0.1.0-x64.AppImage"],
  ])("picks the installer on %s/%s", (platform, arch, name) => {
    expect(selectAsset(ASSETS, platform, arch)?.name).toBe(name);
  });

  it("accepts a versioned x64 Windows installer name", () => {
    const assets = [{ name: "CodeChroma-0.2.0-x64-Setup.exe", browser_download_url: "u" }];
    expect(selectAsset(assets, "win32", "x64")?.name).toBe("CodeChroma-0.2.0-x64-Setup.exe");
  });

  it("returns null when the platform has no asset yet or is unsupported", () => {
    const noLinux = ASSETS.filter((a) => !a.name.endsWith(".AppImage"));
    expect(selectAsset(noLinux, "linux", "x64")).toBeNull();
    expect(selectAsset(ASSETS, "linux", "arm64")).toBeNull();
  });

  it("does not choose an ARM Windows installer for x64", () => {
    const assets = [{ name: "CodeChroma-arm64-Setup.exe", browser_download_url: "https://dl/arm" }, ...ASSETS];
    expect(selectAsset(assets, "win32", "x64")?.name).toBe("CodeChroma-Setup.exe");
    expect(selectAsset(assets, "win32", "arm64")).toBeNull();
  });
});

describe("small helpers", () => {
  it.each([
    [`sha256:${"a".repeat(64)}`, "a".repeat(64)], [undefined, undefined], ["md5:abc", undefined],
  ])("digestHex(%s)", (input, expected) => expect(digestHex(input)).toBe(expected));

  it.each([
    ["CodeChroma-0.1.0-arm64.dmg", "CodeChroma-0.1.0-arm64.dmg"],
    ["../evil/installer.dmg", "installer.dmg"],
    ["a b;c&d.exe", "a_b_c_d.exe"],
  ])("safeAssetPath(%s)", (input, expected) => expect(safeAssetPath(input)).toBe(expected));

  it.each([
    ["/Users/me/Applications/CodeChroma.app/Contents/MacOS/CodeChroma", "/Users/me/Applications/CodeChroma.app"],
    ["/usr/local/bin/codechroma", null],
  ])("macAppBundlePath(%s)", (input, expected) => expect(macAppBundlePath(input)).toBe(expected));

  it.each([
    ["<key>mount-point</key>\n<string>/Volumes/CodeChroma 0.1.0</string>", "/Volumes/CodeChroma 0.1.0"],
    ["<plist><dict></dict></plist>", null],
  ])("mountPointFromPlist", (plist, expected) => expect(mountPointFromPlist(plist)).toBe(expected));
});

describe("checkForUpdates", () => {
  const newer = { tag_name: "v2.0.0", assets: [
    { name: "CodeChroma-2.0.0-arm64.dmg", browser_download_url: dl("CodeChroma-2.0.0-arm64.dmg", "v2.0.0") },
    { name: "CodeChroma-2.0.0-arm64.dmg.sha256", browser_download_url: dl("CodeChroma-2.0.0-arm64.dmg.sha256", "v2.0.0") },
  ] };
  const mac = { platform: "darwin", arch: "arm64" };

  it("throws on a non-2xx GitHub API response (offline, not 'no update')", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500, headers: new Headers() })) as unknown as typeof fetch;
    await expect(checkForUpdates("1.0.0", { fetchImpl })).rejects.toThrow(/500/);
  });

  it("reports rate limits and their reset time", async () => {
    const reset = Math.floor(Date.now() / 1000) + 720;
    const make = () => new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
      status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
    });
    const fetchImpl = (async () => make()) as typeof fetch;
    await expect(checkForUpdates("1.0.0", { fetchImpl })).rejects.toMatchObject({ name: "GitHubRateLimitError", retryAt: reset * 1000 });
    await expect(checkForUpdates("1.0.0", { fetchImpl })).rejects.toThrow(/Resets in 12 minutes/);
  });

  it("resolves the digest from the .sha256 sidecar when one is published", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: unknown) => {
      calls.push(String(url));
      if (String(url).endsWith(".sha256")) return { ok: true, text: async () => `${"a".repeat(64)}  CodeChroma-2.0.0-arm64.dmg` };
      return { ok: true, status: 200, headers: new Headers(), json: async () => newer };
    }) as unknown as typeof fetch;
    const info = await checkForUpdates("1.0.0", { ...mac, fetchImpl });
    expect(info?.sha256).toBe("a".repeat(64));
    expect(calls.some((c) => c.endsWith(".sha256"))).toBe(true);
  });

  it("still reports the update when neither a digest nor a sidecar is published", async () => {
    const payload = { tag_name: "v2.0.0", assets: [newer.assets[0]] };
    const info = await checkForUpdates("1.0.0", { ...mac, fetchImpl: jsonFetch(payload) });
    expect(info).toMatchObject({ version: "v2.0.0", sha256: undefined });
  });

  it("reports already up to date while returning the stable version", async () => {
    let latest = "";
    const result = await checkForUpdates("2.0.0", { ...mac, fetchImpl: jsonFetch({ tag_name: "v2.0.0", assets: ASSETS }), onLatest: (v) => { latest = v; } });
    expect(result).toBeNull();
    expect(latest).toBe("v2.0.0");
  });

  it.each([{ prerelease: true }, { draft: true }, { tag_name: "v3.0.0-beta.1" }])("ignores non-stable releases %j", async (flags) => {
    expect(await checkForUpdates("1.0.0", { ...mac, fetchImpl: jsonFetch({ tag_name: "v3.0.0", assets: ASSETS, ...flags }) })).toBeNull();
  });

  it.each([null, {}, { tag_name: "v2.0.0junk", assets: [] }, { tag_name: "v2.0.0", assets: [null] }])("rejects malformed responses %j", async (payload) => {
    await expect(checkForUpdates("1.0.0", { ...mac, fetchImpl: jsonFetch(payload) })).rejects.toThrow("Malformed");
  });

  it("rejects unreachable releases", async () => {
    await expect(checkForUpdates("1.0.0", { fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch })).rejects.toThrow("offline");
  });

  it("does not claim up to date when the architecture has no asset", async () => {
    await expect(checkForUpdates("1.0.0", { platform: "linux", arch: "arm64", fetchImpl: jsonFetch({ tag_name: "v2.0.0", assets: ASSETS }) })).rejects.toThrow("No installer");
  });

  it.each([
    "http://github.com/gutzerk/code_chroma/releases/download/v2.0.0/a.dmg",
    "https://evil.example/gutzerk/code_chroma/releases/download/v2.0.0/a.dmg",
    "https://github.com/someone/else/releases/download/v2.0.0/a.dmg",
    "https://github.com.evil.example/gutzerk/code_chroma/releases/download/v2.0.0/a.dmg",
    "not a url",
  ])("refuses a download URL outside the release repo: %s", async (url) => {
    const payload = { tag_name: "v2.0.0", assets: [{ name: "CodeChroma-2.0.0-arm64.dmg", browser_download_url: url }] };
    await expect(checkForUpdates("1.0.0", { ...mac, fetchImpl: jsonFetch(payload) })).rejects.toThrow("Unexpected download URL");
  });

  describe("conditional requests", () => {
    it("sends If-None-Match and reuses the cached release on 304", async () => {
      const cache: ReleaseCache = { etag: 'W/"abc"', release: newer };
      let sent: Headers | undefined;
      const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
        sent ??= new Headers(init?.headers);
        return { ok: false, status: 304, headers: new Headers() };
      }) as unknown as typeof fetch;
      const info = await checkForUpdates("1.0.0", { ...mac, fetchImpl, cache });
      expect(sent?.get("if-none-match")).toBe('W/"abc"');
      expect(info?.version).toBe("v2.0.0");
    });

    it("stores the ETag and release from a 200", async () => {
      const cache: ReleaseCache = {};
      const headers = new Headers({ etag: 'W/"xyz"' });
      await checkForUpdates("1.0.0", { ...mac, cache, fetchImpl: jsonFetch(newer, { headers }) });
      expect(cache).toMatchObject({ etag: 'W/"xyz"', release: newer });
    });

    it("sends no validator without a cached release", async () => {
      let sent: Headers | undefined;
      const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
        sent = new Headers(init?.headers);
        return { ok: true, status: 200, headers: new Headers(), json: async () => newer };
      }) as unknown as typeof fetch;
      await checkForUpdates("1.0.0", { ...mac, fetchImpl, cache: {} });
      expect(sent?.has("if-none-match")).toBe(false);
    });

    it("falls back to the cached release when the API is rate limited", async () => {
      const cache: ReleaseCache = { etag: 'W/"abc"', release: newer };
      const limited = (async () => new Response("{}", { status: 429, headers: { "retry-after": "60" } })) as typeof fetch;
      const info = await checkForUpdates("1.0.0", { ...mac, fetchImpl: limited, cache });
      expect(info?.version).toBe("v2.0.0");
    });
  });
});

describe("assertUserInstallation", () => {
  it("rejects a Windows system installation", async () => {
    await expect(assertUserInstallation({ platform: "win32", executable: "C:/Program Files/CodeChroma/CodeChroma.exe", localAppData: "C:/Users/me/AppData/Local" })).rejects.toThrow("administrator privileges");
  });

  it.each(["/opt/CodeChroma/codechroma", "/usr/lib/codechroma/codechroma"])("gives the apt/reinstall message for a .deb install at %s", async (executable) => {
    await expect(assertUserInstallation({ platform: "linux", executable, home: "/home/me", appImage: undefined })).rejects.toThrow(DEB_UPDATE_MESSAGE);
    expect(DEB_UPDATE_MESSAGE).toMatch(/apt/);
  });
});

describe("downloadAsset guards", () => {
  const base: UpdateInfo = { version: "2.0.0", assetName: "a.dmg", downloadPath: join(tmpdir(), "updater-guard-test.dmg") };

  it("refuses a release with no SHA-256 digest", async () => {
    await expect(downloadAsset(base)).rejects.toThrow("no SHA-256 digest");
  });

  it("refuses a download URL outside the release repo before fetching", async () => {
    const info = { ...base, sha256: "a".repeat(64), downloadUrl: "https://evil.example/a.dmg" };
    await expect(downloadAsset(info)).rejects.toThrow("Unexpected download URL");
  });

  it("aborts and rejects an oversized download body", async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(MAX_ASSET_BYTES + 1)); c.close(); } });
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, status: 200, body, headers: new Headers() }) as Response) as typeof fetch;
    try {
      const info = { ...base, downloadPath: join(tmpdir(), "updater-too-large-test.dmg"), sha256: "a".repeat(64) };
      await expect(downloadAsset(info)).rejects.toThrow("download too large");
    } finally { globalThis.fetch = original; }
  });
});

describe("cleanupStaleDownloads", () => {
  it("removes leftover installers and partial downloads but nothing else", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codechroma-cleanup-"));
    try {
      const stale = ["CodeChroma-1.0.0-arm64.dmg", "CodeChroma-Setup.exe", "CodeChroma-1.0.0-x64.AppImage", "CodeChroma-Setup.exe.part"];
      for (const name of [...stale, "unrelated.txt", "CodeChroma-notes.txt"]) await writeFile(join(dir, name), "x");
      const removed = await cleanupStaleDownloads(dir);
      expect(removed.sort()).toEqual([...stale].sort());
      expect(await readFile(join(dir, "unrelated.txt"), "utf8")).toBe("x");
      expect(await readFile(join(dir, "CodeChroma-notes.txt"), "utf8")).toBe("x");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("is a no-op for a missing directory", async () => {
    expect(await cleanupStaleDownloads(join(tmpdir(), "codechroma-does-not-exist"))).toEqual([]);
  });
});
