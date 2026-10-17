# Distribution: in-app updater doc changes needed

Written by the updater stream of Plan 5 (the `distribution-install-update` planning doc was not present, so this is a standalone section file for the docs pass to merge). Code is in `desktop/src/` on the updater branch; no docs were edited.

## `docs/architecture/desktop-app.md`

- Constants: `desktop/src/updateConstants.ts` is the single source for the repo slug (`REPO`), the releases/attestations/download URLs, the pinned Sigstore issuer and workflow identity (`...release-please.yml@refs/heads/main`), `PERIODIC_CHECK_MS` (6 h), `FOCUS_MIN_GAP_MS` (1 h) and `isReleaseDownloadUrl`. `updater.ts` re-exports `REPO`, `attestation.ts` re-exports `ATTESTATIONS_API`. A repo rename is a one-line change; `updateConstants.test.ts` fails if the slug leaks into other updater sources or drifts from `package.json` `homepage`.
- Download URL validation: asset URLs must be `https://github.com/<REPO>/releases/(latest/)?download/...` (no credentials). Checked both when the release is parsed and again in `downloadAsset`.
- Rate limits: `checkForUpdates` takes a `ReleaseCache {etag, release}` (held in memory by `UpdateService`). It sends `If-None-Match`; a 304 or a rate-limit response reuses the cached release, so the unauthenticated 60/h limit is rarely hit. Not persisted across restarts; not yet reading `latest.json` from the release.
- Periodic check: `updateScheduler.ts` (`UpdateScheduler`) checks every 6 h and on `browser-window-focus` (throttled to 1 h), packaged builds only. A background check stays silent for a skipped version and notifies once per version.
- Settings: `update-settings.json` in userData (`skippedVersion`, `autoDownload`) via `updateCache.ts`; `UpdateService.skipVersion/setAutoDownload`, IPC `updates:skip` / `updates:auto-download`, preload `codechromaUpdates.skip/setAutoDownload`, UI in `web/src/assistant/UpdatesPanel.tsx`. A manual check always shows a skipped version. Auto-download downloads and verifies only; installing still needs the explicit restart.
- Update flow per OS (replace the old description):
  - macOS: DMG mounted, `.app` copied with `ditto` to `~/Applications/CodeChroma.app.update-<pid>`, DMG detached and deleted; the detached `MAC_SWAP_SCRIPT` (`updateScripts.ts`) waits for the app to exit, swaps, removes the backup, reopens; it restores the old bundle if the swap fails.
  - Linux AppImage: staged as a sibling `.update-<pid>` copy; the detached `LINUX_SWAP_SCRIPT` waits for exit, keeps the old AppImage as `<name>.previous`, launches the new one and, if it exits non-zero within 8 s, restores `.previous` and launches it. The `.previous` file stays until the next update (one extra AppImage of disk). `installAsset` now returns `false` on Linux (the script relaunches, not Electron).
  - Windows: unchanged (per-user NSIS `/currentuser /S --updated --force-run /D=<dir>`). There is no automatic rollback on Windows; NSIS replaces in place. Gap, see below.
  - `.deb`: an install under `/opt` or `/usr` gets `DEB_UPDATE_MESSAGE` (update with apt or reinstall) instead of the generic "administrator privileges" error.
- Cleanup: the downloaded installer is deleted after a successful hand-off on macOS and Linux; on Windows (installer still running) and after crashes, `cleanupStaleDownloads()` removes `CodeChroma-*.dmg|.exe|.AppImage[.part]` from the temp dir at startup.
- About and title: Help > About CodeChroma (Windows/Linux; macOS uses the app-menu About) and the window title `<tab> - CodeChroma <version>` (`appVersion.ts`).
- Delta updates: out of scope. Every update is a full download (100 MB+ installer). Revisit with `.blockmap`/electron-updater after the bridge shrinks.
- Tests: `updater.test.ts`, `updater.download.test.ts`, `updater.install.test.ts` are now table-driven (platform x outcome); new `updateScripts.test.ts` runs both swap scripts under `sh` in a temp dir including rollback (skipped when `sh` is missing), plus `updateScheduler`, `updateConstants` (also checks `electron-builder.yml` artifact names against `selectAsset`), `appVersion`.

## `README.md` / `QUICKSTART.md`

- Mention Help > About / window title version, "Skip this version" and "Download updates automatically" in the Updates panel, and the 6-hourly background check.
- Linux: the old AppImage is kept as `CodeChroma.AppImage.previous` after an update and restored automatically if the new one fails to start.
- `.deb` users update with apt or reinstall; the app says so.

## `CLAUDE.md`

- The "Desktop app" paragraph can stay; if the update flow is described, add that updates are checked every 6 h and on focus.

## Known gaps (for the planning doc)

- Windows rollback is not implemented (NSIS in-place upgrade); needs a design (backup of the install dir or a versioned side-by-side install).
- Windows artifact is still `CodeChroma-Setup.exe` (unversioned) because the workflow globs and manifest generator belong to the distribution stream; `selectAsset` already accepts `CodeChroma-<v>-x64-Setup.exe`, so a rename is safe on the updater side. Old installed updaters also match that name by suffix.
- The updater does not yet prefer a previously downloaded `latest.json`; ETag plus cached release covers the rate limit.
- Signing hooks (macOS notarization, Windows `signtoolOptions`) in `electron-builder.yml` were not added in this stream.
