import {
  checkForUpdates,
  downloadAsset,
  installAsset,
  assertUserInstallation,
  GitHubRateLimitError,
  type ReleaseCache,
  type UpdateInfo,
} from "./updater";
import { compareVersions } from "./updater";
import type { UpdateSettings } from "./updateCache";

type UpdateServiceDependencies = {
  check: typeof checkForUpdates;
  download: typeof downloadAsset;
  install: typeof installAsset;
  writable: typeof assertUserInstallation;
  readLatest: () => string | undefined;
  writeLatest: (version: string) => void;
  readSettings: () => UpdateSettings;
  writeSettings: (settings: UpdateSettings) => void;
};

export interface UpdateState {
  currentVersion: string;
  latestVersion?: string;
  phase: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "installing" | "error";
  bytes?: number;
  total?: number;
  error?: string;
  retryAfter?: number;
  notes?: string;
  /** A version the user chose to ignore; background checks stay quiet about it. */
  skippedVersion?: string;
  /** Download new releases unprompted (installing still needs an explicit restart). */
  autoDownload: boolean;
}

/** One shared update transaction for Settings, the File menu, and release notifications. */
export class UpdateService {
  state: UpdateState;
  private info: UpdateInfo | null = null;
  private busy = false;
  private deps: UpdateServiceDependencies;
  private releaseCache: ReleaseCache = {};

  constructor(
    currentVersion: string,
    private changed: (state: UpdateState) => void,
    deps: Partial<UpdateServiceDependencies> = {},
  ) {
    this.deps = {
      check: checkForUpdates,
      download: downloadAsset,
      install: installAsset,
      writable: assertUserInstallation,
      readLatest: () => undefined,
      writeLatest: () => {},
      readSettings: () => ({ autoDownload: false }),
      writeSettings: () => {},
      ...deps,
    };
    const settings = this.deps.readSettings();
    this.state = { currentVersion, latestVersion: this.deps.readLatest(), phase: "idle", skippedVersion: settings.skippedVersion, autoDownload: settings.autoDownload };
  }

  private persistSettings() {
    try { this.deps.writeSettings({ skippedVersion: this.state.skippedVersion, autoDownload: this.state.autoDownload }); } catch { /* settings are best effort */ }
  }

  /** Stay quiet about `version` in background checks (a newer release still shows). */
  async skipVersion(version: string) {
    this.set({ skippedVersion: version });
    this.persistSettings();
    return this.state;
  }

  async setAutoDownload(enabled: boolean) {
    this.set({ autoDownload: enabled });
    this.persistSettings();
    return this.state;
  }

  private isSkipped(version: string | undefined): boolean {
    const skipped = this.state.skippedVersion;
    if (!skipped || !version) return false;
    try { return compareVersions(version, skipped) <= 0; } catch { return version === skipped; }
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }

  private async run(action: () => Promise<void>) {
    if (this.busy) return this.state;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      const rateLimit = error instanceof GitHubRateLimitError;
      const message = error instanceof Error ? error.message : String(error);
      const signatureFailure = /root was signed by (\d+)\/(\d+) keys/i.exec(message);
      this.set({
        phase: "error",
        error: rateLimit
          ? error.message
          : signatureFailure
            ? `Release signature could not be verified (${signatureFailure[1]}/${signatureFailure[2]} keys). The release may be unsigned or signed with outdated keys. Update manually from GitHub Releases.`
            : `${message} Try again or update manually from GitHub Releases.`,
        retryAfter: rateLimit ? error.retryAt : undefined,
      });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  check(opts: { background?: boolean } = {}) {
    return this.run(async () => {
      if (this.state.retryAfter && Date.now() < this.state.retryAfter) return;
      if (this.state.phase === "ready") return;
      this.info = null;
      this.set({ phase: "checking", error: undefined });
      let latestReturned = false;
      this.info = await this.deps.check(this.state.currentVersion, {
        cache: this.releaseCache,
        onLatest: latestVersion => {
          latestReturned = true;
          try { this.deps.writeLatest(latestVersion); } catch {}
          this.set({ latestVersion });
        },
      });
      if (!latestReturned && !this.info) {
        throw new Error("No stable release was returned by GitHub.");
      }
      const hidden = opts.background === true && this.isSkipped(this.info?.version);
      if (hidden) this.info = null;
      this.set({
        phase: this.info ? "available" : "up-to-date",
        latestVersion: this.info?.version ?? this.state.latestVersion,
        retryAfter: undefined,
        notes: this.info?.notes,
      });
      if (this.info && this.state.autoDownload && !this.isSkipped(this.info.version)) await this.downloadNow();
    });
  }

  private async downloadNow() {
    if (!this.info) throw new Error("Check for updates first.");
    await this.deps.writable();
    this.set({ phase: "downloading", bytes: 0, total: undefined, error: undefined });
    await this.deps.download(this.info, (bytes, total) => this.set({ bytes, total }));
    this.set({ phase: "ready" });
  }

  download() {
    return this.run(async () => {
      if (this.state.phase === "ready") return;
      await this.downloadNow();
    });
  }

  restart(restartApp: (relaunch: boolean) => void) {
    return this.run(async () => {
      if (this.state.phase !== "ready" || !this.info) throw new Error("Download the update first.");
      this.set({ phase: "installing", error: undefined });
      restartApp(await this.deps.install(this.info));
    });
  }
}
