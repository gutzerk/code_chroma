import {
  checkForUpdates,
  downloadAsset,
  installAsset,
  assertUserInstallation,
  GitHubRateLimitError,
  type UpdateInfo,
} from "./updater";

type UpdateServiceDependencies = {
  check: typeof checkForUpdates;
  download: typeof downloadAsset;
  install: typeof installAsset;
  writable: typeof assertUserInstallation;
  readLatest: () => string | undefined;
  writeLatest: (version: string) => void;
};

export interface UpdateState {
  currentVersion: string;
  latestVersion?: string;
  phase: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "installing" | "error";
  bytes?: number;
  total?: number;
  error?: string;
  retryAfter?: number;
}

/** One shared update transaction for Settings, the File menu, and release notifications. */
export class UpdateService {
  state: UpdateState;
  private info: UpdateInfo | null = null;
  private busy = false;
  private deps: UpdateServiceDependencies;

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
      ...deps,
    };
    this.state = { currentVersion, latestVersion: this.deps.readLatest(), phase: "idle" };
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

  check() {
    return this.run(async () => {
      if (this.state.retryAfter && Date.now() < this.state.retryAfter) return;
      if (this.state.phase === "ready") return;
      this.info = null;
      this.set({ phase: "checking", error: undefined });
      let latestReturned = false;
      this.info = await this.deps.check(this.state.currentVersion, {
        onLatest: latestVersion => {
          latestReturned = true;
          try { this.deps.writeLatest(latestVersion); } catch {}
          this.set({ latestVersion });
        },
      });
      if (!latestReturned && !this.info) {
        throw new Error("No stable release was returned by GitHub.");
      }
      this.set({
        phase: this.info ? "available" : "up-to-date",
        latestVersion: this.info?.version ?? this.state.latestVersion,
        retryAfter: undefined,
      });
    });
  }

  download() {
    return this.run(async () => {
      if (this.state.phase === "ready") return;
      if (!this.info) throw new Error("Check for updates first.");
      await this.deps.writable();
      this.set({ phase: "downloading", bytes: 0, total: undefined, error: undefined });
      await this.deps.download(this.info, (bytes, total) => this.set({ bytes, total }));
      this.set({ phase: "ready" });
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
