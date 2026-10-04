import {
  checkForUpdates,
  downloadAsset,
  installAsset,
  assertUserInstallation,
  type UpdateInfo,
} from "./updater";

export interface UpdateState {
  currentVersion: string;
  latestVersion?: string;
  phase: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "installing" | "error";
  bytes?: number;
  total?: number;
  error?: string;
}

/** One shared update transaction for Settings, the File menu, and release notifications. */
export class UpdateService {
  state: UpdateState;
  private info: UpdateInfo | null = null;
  private busy = false;

  constructor(
    currentVersion: string,
    private changed: (state: UpdateState) => void,
    private deps = {
      check: checkForUpdates,
      download: downloadAsset,
      install: installAsset,
      writable: assertUserInstallation,
    },
  ) {
    this.state = { currentVersion, phase: "idle" };
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
      this.set({
        phase: "error",
        error: `${error instanceof Error ? error.message : error} Try again or update manually from GitHub Releases.`,
      });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  check() {
    return this.run(async () => {
      if (this.state.phase === "ready") return;
      this.info = null;
      this.set({ phase: "checking", latestVersion: undefined, error: undefined });
      this.info = await this.deps.check(this.state.currentVersion, {
        onLatest: latestVersion => this.set({ latestVersion }),
      });
      if (!this.state.latestVersion && !this.info) {
        throw new Error("No stable release was returned by GitHub.");
      }
      this.set({
        phase: this.info ? "available" : "up-to-date",
        latestVersion: this.info?.version ?? this.state.latestVersion,
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
