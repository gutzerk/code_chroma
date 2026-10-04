import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, open, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fetchAttestation, verifyAttestation } from "./attestation";

export const REPO = "UshakovDV/code-chroma";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_BASE = `https://github.com/${REPO}/releases/latest/download`;

/** What a newer release looks like once fetched: the version plus the matching asset to install. */
export interface UpdateInfo {
  version: string;
  assetName: string;
  /** Absolute path where the installer will be (or was) downloaded. */
  downloadPath: string;
  /** Hex SHA-256 of the installer, when the release provided a digest. */
  sha256?: string;
}

/** A single `assets[]` entry from the GitHub /releases/latest response. */
export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  /** GitHub publishes each asset's digest as `sha256:<hex>`; used for integrity checks. */
  digest?: string;
}

/** One candidate artifact, pre-selected for a platform/arch so the platform code stays dumb. */
export interface AssetMatch {
  name: string;
  /** Hex SHA-256, or undefined when the release didn't publish one. */
  sha256?: string;
}

/** The subset of the release payload we read (kept loose — GitHub may add fields over time). */
interface LatestRelease {
  tag_name?: string;
  assets?: ReleaseAsset[];
}

/** Per-platform/arch install descriptor: artifact suffix and the install step (true = relaunch). */
interface PlatformSpec {
  suffix: string;
  install: (info: UpdateInfo) => Promise<boolean>;
}

/** The body of every per-platform branch in this file lives here, keyed by `platform/arch`. */
const PLATFORMS: Record<string, PlatformSpec> = {
  "darwin/arm64": { suffix: "-arm64.dmg", install: runMacDmg },
  "darwin/x64": { suffix: "-x64.dmg", install: runMacDmg },
  "win32/x64": { suffix: "-Setup.exe", install: runWindowsSetup },
  "linux/x64": { suffix: "-x64.AppImage", install: runLinuxAppImage },
};

/** `v1.2.3` (with or without the `v`) -> `[1, 2, 3]`, or null if the tag isn't a semver. */
export function parseTag(tag: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(tag.trim());
  if (!match) return null;
  const [, major, minor, patch, pre] = match;
  const base = [Number(major), Number(minor), patch === undefined ? 0 : Number(patch)];
  return pre === undefined ? base : [...base, -1];
}

/** Returns <0, 0, >0 for `a < b`, `a == b`, `a > b` treating each dot-segment numerically. */
export function compareVersions(a: string, b: string): number {
  const av = parseTag(a) ?? [0];
  const bv = parseTag(b) ?? [0];
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Picks the installer asset for `platform`/`arch`, or null when the release has none yet. */
export function selectAsset(assets: ReleaseAsset[], platform: string, arch: string): AssetMatch | null {
  const spec = PLATFORMS[`${platform}/${arch}`];
  if (!spec) return null;
  const asset = assets.find((a) => a.name.endsWith(spec.suffix));
  if (!asset) return null;
  return { name: asset.name, sha256: digestHex(asset.digest) };
}

/** Extracts the hex digest from GitHub's `sha256:<hex>` asset digest, or undefined. */
export function digestHex(digest: string | undefined): string | undefined {
  const hex = digest?.match(/^sha256:([0-9a-f]{64})$/i)?.[1];
  return hex ?? undefined;
}

/** Bytes we stop downloading at; a disk-exhaustion guard, not a realistic download limit. */
export const MAX_ASSET_BYTES = 1_000_000_000;

/** Turns a remote asset name into a safe local file name (basename, only `[0-9A-Za-z._-]` kept). */
export function safeAssetPath(name: string): string {
  return basename(name).replace(/[^0-9A-Za-z._-]/g, "_");
}

/** Reports whether we're behind `currentVersion`, and by which asset, from the latest release. */
export async function checkForUpdates(
  currentVersion: string,
  opts: { platform?: string; arch?: string; fetchImpl?: typeof fetch } = {},
): Promise<UpdateInfo | null> {
  const { platform = process.platform, arch = process.arch, fetchImpl } = opts;
  const doFetch = fetchImpl ?? fetch;
  const response = await doFetch(RELEASES_API, { headers: { "User-Agent": "code-chroma-desktop" } });
  // Throw (not return null) on a non-2xx: "no update" must not be conflated with "offline/rejected".
  if (!response.ok) throw new Error(`GitHub API responded ${response.status}`);
  const release = (await response.json()) as LatestRelease;
  const version = release.tag_name ?? "";
  if (version === "" || compareVersions(version, currentVersion) <= 0) return null;
  const asset = selectAsset(release.assets ?? [], platform, arch);
  if (!asset) return null;
  // Prefer GitHub's own asset digest; fall back to our `.sha256` sidecar only when it's absent.
  const sha256 = asset.sha256 ?? (await sidecarHex(asset.name, release.assets ?? [], doFetch));
  // A newer asset with no reachable digest is still "an update", not "up to date": the caller must
  // surface it (a release that forgot its sidecar must not silently masquerade as current).
  return { version, assetName: asset.name, downloadPath: join(tmpdir(), safeAssetPath(asset.name)), sha256 };
}

/** The hex from the release's `<installer>.sha256` sidecar, or undefined when none is published. */
async function sidecarHex(
  assetName: string,
  assets: ReleaseAsset[],
  doFetch: typeof fetch,
): Promise<string | undefined> {
  const sidecar = assets.find((a) => a.name === `${assetName}.sha256`);
  if (!sidecar) return undefined;
  try {
    const response = await doFetch(sidecar.browser_download_url, {
      headers: { "User-Agent": "code-chroma-desktop" },
    });
    if (!response.ok) return undefined;
    const match = /^([0-9a-f]{64})\s+/.exec((await response.text()).trim());
    return match?.[1] ?? undefined;
  } catch {
    return undefined;
  }
}

/** Downloads the installer to `downloadPath` unless a verified copy is already there. */
export async function downloadAsset(info: UpdateInfo): Promise<string> {
  if (!info.sha256) throw new Error("release has no SHA-256 digest to verify against");
  if (await isVerified(info)) return info.downloadPath;
  const dest = info.downloadPath;
  const part = `${dest}.part`;
  const response = await fetch(`${DOWNLOAD_BASE}/${info.assetName}`, {
    headers: { "User-Agent": "code-chroma-desktop" },
  });
  if (!response.ok) throw new Error(`download failed (${response.status})`);
  if (!response.body) throw new Error("download failed (no response body)");
  await mkdir(tmpdir(), { recursive: true });
  await rm(part, { force: true });
  const hash = createHash("sha256");
  const reader = response.body.getReader();
  const out = await open(part, "w");
  try {
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_ASSET_BYTES) await discard(part, "download too large; refusing to write an oversized installer");
      hash.update(value);
      await out.writeFile(value);
    }
    if (hash.digest("hex") !== info.sha256) await discard(part, "download failed integrity check");
  } finally {
    await out.close();
  }
  // Provenance is the authority: the sidecar above only catches corruption, whereas the signed
  // attestation binds this artifact to this repo's release workflow. An unverifiable or mismatched
  // attestation is treated as tampering and the file is never renamed into place.
  const bundle = await fetchAttestation(info.sha256);
  await verifyAttestation(bundle, info.sha256);
  if (info.assetName.endsWith(".AppImage")) {
    await chmod(part, 0o755);
  }
  await rename(part, dest);
  return dest;
}

/** Removes the in-progress `.part` then throws; used on any failure mid-download. */
async function discard(part: string, why: string): Promise<never> {
  await rm(part, { force: true });
  throw new Error(why);
}

/** True when a file at `downloadPath` exists and its SHA-256 matches `info.sha256`. */
async function isVerified(info: UpdateInfo): Promise<boolean> {
  try {
    return (await sha256Hex(info.downloadPath)) === info.sha256;
  } catch {
    return false;
  }
}

/** Hex SHA-256 of the file at `path` (streamed, so large installers aren't loaded whole), rejecting if unreadable/missing. */
async function sha256Hex(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

/** Installs `info`; true when the app should relaunch (mac/Linux own the swap, Windows NSIS does). */
export async function installAsset(
  info: UpdateInfo,
  opts: { platform?: string; arch?: string } = {},
): Promise<boolean> {
  const { platform = process.platform, arch = process.arch } = opts;
  const spec = PLATFORMS[`${platform}/${arch}`];
  if (!spec) throw new Error(`no install path for ${platform}/${arch} / ${info.assetName}`);
  return spec.install(info);
}

/** Mounts the dmg and replaces this user's app bundle without requesting elevation. */
async function runMacDmg(info: UpdateInfo): Promise<boolean> {
  const plist = await execFileP("hdiutil", ["attach", info.downloadPath, "-nobrowse", "-plist"]);
  const vol = mountPointFromPlist(plist);
  if (!vol) throw new Error("could not locate mounted dmg volume");
  const src = join(vol, "CodeChroma.app");
  const dest = macAppBundlePath(process.execPath);
  if (!dest) throw new Error("could not locate CodeChroma.app; reinstall the app into ~/Applications to update without administrator privileges");
  try {
    await execFileP("ditto", [src, dest]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not update ${dest} without administrator privileges. Reinstall CodeChroma into ~/Applications, then retry. ${reason}`);
  }
  await execFileP("hdiutil", ["detach", vol]);
  return true;
}

/** Returns the enclosing .app bundle for an executable inside it, or null outside an app bundle. */
export function macAppBundlePath(executablePath: string): string | null {
  const marker = ".app/";
  const index = executablePath.indexOf(marker);
  return index < 0 ? null : executablePath.slice(0, index + marker.length - 1);
}

/** Pulls the first `<key>mount-point</key>` value out of hdiutil's `-plist` XML output. */
export function mountPointFromPlist(plist: string): string | null {
  const match = /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
  return match?.[1] ?? null;
}

/** Runs the Windows NSIS installer (it shows its own UAC/overwrite prompt and relaunches itself). */
async function runWindowsSetup(info: UpdateInfo): Promise<boolean> {
  await execFileP(info.downloadPath);
  return false;
}

/** Promisifies node:child_process execFile. Kept local: vitest can't bundle the promises subpath. */
function execFileP(file: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/** Replaces the running AppImage via sibling-tmp + atomic rename (rename avoids ETXTBSY, no root). */
async function runLinuxAppImage(info: UpdateInfo): Promise<boolean> {
  const current = process.env.APPIMAGE;
  if (!current) throw new Error("not running from an AppImage; install the .deb instead");
  const tmp = join(dirname(current), `.${basename(current)}.update-${process.pid}`);
  await copyFile(info.downloadPath, tmp);
  await chmod(tmp, 0o755);
  await rename(tmp, current);
  return true;
}
