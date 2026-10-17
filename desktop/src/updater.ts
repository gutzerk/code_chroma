import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, realpath, stat, chmod, copyFile, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, isAbsolute } from "node:path";
import { fetchAttestation, verifyAttestation } from "./attestation";
import { DOWNLOAD_BASE, RELEASES_API, REPO, USER_AGENT, isReleaseDownloadUrl } from "./updateConstants";
import { LINUX_SWAP_SCRIPT, MAC_SWAP_SCRIPT } from "./updateScripts";

export { REPO };

/** Shown instead of the generic error when the app was installed from the .deb package. */
export const DEB_UPDATE_MESSAGE = "CodeChroma was installed from the .deb package, which the app cannot update itself. Update it with apt (sudo apt install --only-upgrade codechroma) or download the new .deb or AppImage from GitHub Releases and reinstall.";

/** A cached /releases/latest payload plus its ETag, so GitHub can answer 304 without spending rate limit. */
export interface ReleaseCache {
  etag?: string;
  release?: unknown;
}

/** What a newer release looks like once fetched: the version plus the matching asset to install. */
export interface UpdateInfo {
  version: string;
  assetName: string;
  /** Absolute path where the installer will be (or was) downloaded. */
  downloadPath: string;
  /** Hex SHA-256 of the installer, when the release provided a digest. */
  sha256?: string;
  downloadUrl?: string;
  /** The release's changelog (GitHub release body), when it has one. */
  notes?: string;
}

export class GitHubRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAt: number,
  ) {
    super(message);
    this.name = "GitHubRateLimitError";
  }
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
  body?: string | null;
  assets?: ReleaseAsset[];
  draft?: boolean;
  prerelease?: boolean;
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
function semver(tag: string): { base: number[]; pre: string[] } | null {
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(tag.trim());
  if (!m) return null;
  const pre = m[4]?.split(".") ?? [];
  if (pre.some(x => /^\d+$/.test(x) && x.length > 1 && x[0] === "0")) return null;
  const base = m.slice(1, 4).map(Number);
  return base.every(Number.isSafeInteger) ? { base, pre } : null;
}
export function parseTag(tag: string): number[] | null {
  const v = semver(tag);
  return v ? [...v.base, ...(v.pre.length ? [-1] : [])] : null;
}
export function compareVersions(a: string, b: string): number {
  const av = semver(a), bv = semver(b);
  if (!av || !bv) throw new Error("Invalid semantic version");
  for (let i = 0; i < 3; i++) if (av.base[i] !== bv.base[i]) return av.base[i] - bv.base[i];
  if (!av.pre.length || !bv.pre.length) return Number(!av.pre.length) - Number(!bv.pre.length);
  for (let i = 0; i < Math.max(av.pre.length, bv.pre.length); i++) {
    const x = av.pre[i], y = bv.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Picks the installer asset for `platform`/`arch`, or null when the release has none yet. */
export function selectAsset(assets: ReleaseAsset[], platform: string, arch: string): AssetMatch | null {
  const spec = PLATFORMS[`${platform}/${arch}`];
  if (!spec) return null;
  const asset = assets.find((a) => a.name.startsWith("CodeChroma-") && a.name.endsWith(spec.suffix)
    && (platform !== "win32" || a.name === "CodeChroma-Setup.exe" || a.name.endsWith("-x64-Setup.exe")));
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
  opts: { platform?: string; arch?: string; fetchImpl?: typeof fetch; onLatest?: (version: string) => void; cache?: ReleaseCache } = {},
): Promise<UpdateInfo | null> {
  const { platform = process.platform, arch = process.arch, fetchImpl, cache } = opts;
  const doFetch = fetchImpl ?? fetch;
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (cache?.etag && cache.release) headers["If-None-Match"] = cache.etag;
  const response = await doFetch(RELEASES_API, { signal: AbortSignal.timeout(15_000), headers });
  let payload: unknown;
  if (response.status === 304 && cache?.release) {
    payload = cache.release;
  } else if (!response.ok) {
    // Throw (not return null) on a non-2xx: "no update" must not be conflated with "offline/rejected".
    if (await isRateLimitResponse(response)) {
      if (!cache?.release) throw await rateLimitError(response);
      payload = cache.release;
    } else throw new Error(`GitHub API responded ${response.status}`);
  } else {
    payload = await response.json();
    const etag = response.headers?.get("etag");
    if (cache) { cache.release = payload; cache.etag = etag ?? undefined; }
  }
  const release = payload as LatestRelease;
  if (!release || typeof release.tag_name !== "string" || !semver(release.tag_name) || !Array.isArray(release.assets) || release.assets.some(a => !a || typeof a.name !== "string" || typeof a.browser_download_url !== "string")) throw new Error("Malformed GitHub release response. Try again or visit GitHub Releases.");
  const version = release.tag_name;
  if (release.draft || release.prerelease || semver(version)!.pre.length) return null;
  opts.onLatest?.(version);
  if (compareVersions(version, currentVersion) <= 0) return null;
  const asset = selectAsset(release.assets ?? [], platform, arch);
  if (!asset) throw new Error(`No installer for ${platform}/${arch}. Install manually from GitHub Releases.`);
  // Prefer GitHub's own asset digest; fall back to our `.sha256` sidecar only when it's absent.
  const downloadUrl = release.assets.find(a => a.name === asset.name)!.browser_download_url;
  if (!isReleaseDownloadUrl(downloadUrl)) throw new Error(`Unexpected download URL for ${asset.name}. Update manually from GitHub Releases.`);
  const sha256 = asset.sha256 ?? (await sidecarHex(asset.name, release.assets ?? [], doFetch));
  // A newer asset with no reachable digest is still "an update", not "up to date": the caller must
  // surface it (a release that forgot its sidecar must not silently masquerade as current).
  return { version, assetName: asset.name, downloadUrl, downloadPath: join(tmpdir(), safeAssetPath(asset.name)), sha256, notes: releaseNotes(release.body) };
}

/** Trimmed release body capped at 20k chars, or undefined when empty/non-string. */
function releaseNotes(body: unknown): string | undefined {
  const text = typeof body === "string" ? body.trim() : "";
  return text ? text.slice(0, 20_000) : undefined;
}

async function isRateLimitResponse(response: Response): Promise<boolean> {
  if (response.status === 429 || response.headers?.get("x-ratelimit-remaining") === "0") return true;
  if (response.status !== 403) return false;
  const body = await response.clone().json().catch(() => null) as { message?: unknown } | null;
  return typeof body?.message === "string" && /rate limit/i.test(body.message);
}

async function rateLimitError(response: Response): Promise<GitHubRateLimitError> {
  const now = Date.now();
  const reset = Number(response.headers?.get("x-ratelimit-reset"));
  const retryAfter = response.headers?.get("retry-after");
  const retryAfterSeconds = Number(retryAfter);
  const retryAfterDate = retryAfter && Number.isNaN(retryAfterSeconds) ? Date.parse(retryAfter) : NaN;
  const retryAt = Number.isFinite(reset) && reset * 1000 > now
    ? reset * 1000
    : Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? now + retryAfterSeconds * 1000
      : Number.isFinite(retryAfterDate) && retryAfterDate > now
        ? retryAfterDate
        : now + 60_000;
  const delay = describeDelay(retryAt - now);
  const message = Number.isFinite(reset) && reset * 1000 > now
    ? `GitHub API rate limit reached (unauthenticated). Resets in ${delay}. Update manually from GitHub Releases.`
    : `GitHub API rate limit reached (unauthenticated). Try again in ${delay} or update manually from GitHub Releases.`;
  return new GitHubRateLimitError(message, retryAt);
}

function describeDelay(milliseconds: number): string {
  const minutes = Math.ceil(milliseconds / 60_000);
  return minutes <= 1 ? "about 1 minute" : `${minutes} minutes`;
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
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return undefined;
    const match = /^([0-9a-f]{64})\s+/.exec((await response.text()).trim());
    return match?.[1] ?? undefined;
  } catch {
    return undefined;
  }
}

/** Downloads the installer to `downloadPath` unless a verified copy is already there. */
export async function downloadAsset(info: UpdateInfo, onProgress: (bytes: number, total?: number) => void = () => {}): Promise<string> {
  if (!info.sha256) throw new Error("release has no SHA-256 digest to verify against");
  if (await isVerified(info)) {
    const bundle = await fetchAttestation(info.sha256);
    await verifyAttestation(bundle, info.sha256);
    return info.downloadPath;
  }
  const dest = info.downloadPath;
  const part = `${dest}.part`;
  const url = info.downloadUrl ?? `${DOWNLOAD_BASE}/${info.assetName}`;
  if (!isReleaseDownloadUrl(url)) throw new Error(`Unexpected download URL for ${info.assetName}. Update manually from GitHub Releases.`);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15 * 60_000),
    headers: { "User-Agent": USER_AGENT },
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
      if (bytes > MAX_ASSET_BYTES) throw new Error("download too large; refusing to write an oversized installer");
      hash.update(value);
      await out.writeFile(value);
      onProgress(bytes, Number(response.headers.get("content-length")) || undefined);
    }
    if (hash.digest("hex") !== info.sha256) throw new Error("download failed integrity check");
  } catch (error) {
    await out.close();
    await rm(part, { force: true });
    throw error;
  } finally {
    await out.close();
  }
  // Verify provenance before promoting the temporary file to a prepared update.
  try {
    const bundle = await fetchAttestation(info.sha256);
    await verifyAttestation(bundle, info.sha256);
    if (info.assetName.endsWith(".AppImage")) await chmod(part, 0o755);
    await rename(part, dest);
    return dest;
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
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

/** Installs `info`; true when the app should relaunch (only Linux; macOS and Windows hand the swap and relaunch to a detached helper). */
export async function installAsset(
  info: UpdateInfo,
  opts: { platform?: string; arch?: string } = {},
): Promise<boolean> {
  const { platform = process.platform, arch = process.arch } = opts;
  const spec = PLATFORMS[`${platform}/${arch}`];
  if (!spec) throw new Error(`no install path for ${platform}/${arch} / ${info.assetName}`);
  await assertUserInstallation({ platform });
  return spec.install(info);
}

/** Stages the new bundle from the dmg, then hands the swap to a detached script that runs once this app has quit. */
async function runMacDmg(info: UpdateInfo): Promise<boolean> {
  const plist = await execFileP("hdiutil", ["attach", info.downloadPath, "-nobrowse", "-plist"]);
  const vol = mountPointFromPlist(plist);
  if (!vol) throw new Error("could not locate mounted dmg volume");
  const src = join(vol, "CodeChroma.app");
  const dest = join(homedir(), "Applications", "CodeChroma.app");
  const staged = `${dest}.update-${process.pid}`;
  try {
    await execFileP("ditto", [src, staged]);
    await spawnDetached("/bin/sh", ["-c", MAC_SWAP_SCRIPT, "sh", String(process.pid), staged, dest]);
  } catch (error) {
    await removeBestEffort(staged);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not update ${dest} without administrator privileges. Reinstall CodeChroma into ~/Applications, then retry. ${reason}`);
  } finally {
    await execFileP("hdiutil", ["detach", vol]);
  }
  await removeBestEffort(info.downloadPath);
  return false;
}

/** Removes a leftover bundle with retries (ENOTEMPTY races); a failure must not fail the update. */
async function removeBestEffort(path: string): Promise<void> {
  try { await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { /* leftover is harmless */ }
}

/** Starts `file` detached so it outlives this process; resolves once it has spawned. */
function spawnDetached(file: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
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

/** Runs the per-user NSIS installer silently; it replaces the app once this process quits and relaunches it. */
async function runWindowsSetup(info: UpdateInfo): Promise<boolean> {
  await spawnDetached(info.downloadPath, ["/currentuser", "/S", "--updated", "--force-run", `/D=${dirname(process.execPath)}`]);
  return false;
}

/** Promisifies node:child_process execFile. Kept local: vitest can't bundle the promises subpath. */
function execFileP(file: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/** True when the executable lives in a system prefix, i.e. it came from the .deb package. */
function isDebInstall(executable: string): boolean {
  return /^\/(opt|usr)\//.test(executable.replace(/\\/g, "/"));
}

/** Seconds the new AppImage must stay alive before the update counts as a successful launch. */
const LAUNCH_GRACE_SECONDS = "8";

/** Stages a sibling copy, then a detached script swaps it in (old one kept as `.previous`) and restores the old one if the new one fails to launch. */
async function runLinuxAppImage(info: UpdateInfo): Promise<boolean> {
  const current = process.env.APPIMAGE;
  if (!current) throw new Error(isDebInstall(process.execPath) ? DEB_UPDATE_MESSAGE : "Not running from a user-local AppImage. Reinstall the AppImage in your home directory to enable updates without administrator privileges.");
  const staged = join(dirname(current), `.${basename(current)}.update-${process.pid}`);
  try {
    await copyFile(info.downloadPath, staged);
    await chmod(staged, 0o755);
    await spawnDetached("/bin/sh", ["-c", LINUX_SWAP_SCRIPT, "sh", String(process.pid), staged, current, LAUNCH_GRACE_SECONDS]);
  } catch (error) {
    await rm(staged, { force: true });
    throw error;
  }
  await removeBestEffort(info.downloadPath);
  return false;
}

/** Deletes leftover installers and `.part` files from earlier updates in `dir`; returns the names removed. */
export async function cleanupStaleDownloads(dir: string = tmpdir()): Promise<string[]> {
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const stale = names.filter((n) => /^CodeChroma-.*(\.dmg|\.exe|\.AppImage)(\.part)?$/.test(n));
  const removed: string[] = [];
  for (const name of stale) {
    try { await rm(join(dir, name), { force: true }); removed.push(name); } catch { /* in use: leave it */ }
  }
  return removed;
}

/** Refuse system installs before downloading or invoking any installer. */
export async function assertUserInstallation(opts: { platform?: string; executable?: string; home?: string; appImage?: string; localAppData?: string } = {}): Promise<void> {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const executable = opts.executable ?? process.execPath;
  const target = platform === "darwin" ? macAppBundlePath(executable) : platform === "linux" ? (opts.appImage ?? process.env.APPIMAGE) : dirname(executable);
  const root = platform === "win32" ? (opts.localAppData ?? process.env.LOCALAPPDATA) : home;
  const rel = target && root ? relative(root, target) : "..";
  const message = "This installation cannot be updated without administrator privileges. Reinstall CodeChroma in ~/Applications on macOS, as a user-local AppImage on Linux, or with the per-user Windows installer, then retry. Your settings and repositories will be preserved.";
  if (platform === "linux" && !target && isDebInstall(executable)) throw new Error(DEB_UPDATE_MESSAGE);
  if (!target || !root || rel.startsWith("..") || isAbsolute(rel)) throw new Error(message);
  if (platform === "darwin" && target !== join(home, "Applications", "CodeChroma.app")) throw new Error(message);
  try {
    const resolvedTarget = await realpath(target);
    const resolvedRoot = await realpath(root);
    const resolvedRelative = relative(resolvedRoot, resolvedTarget);
    if (resolvedRelative.startsWith("..") || isAbsolute(resolvedRelative)) throw new Error(message);
    if (process.getuid && ((await stat(target)).uid !== process.getuid() || (await stat(dirname(target))).uid !== process.getuid())) throw new Error(message);
    await access(target, constants.W_OK);
    await access(dirname(target), constants.W_OK);
  } catch { throw new Error(message); }
}
