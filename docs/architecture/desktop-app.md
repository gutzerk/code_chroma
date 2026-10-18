# Desktop app (`desktop/`)

```bash
./scripts/dev/build_desktop.sh       # developer build: SPA -> frozen bridge -> desktop/dist/CodeChroma-*.dmg (macOS arm64)
./scripts/dev/build_desktop.sh --install  # build, then replace ~/Applications/CodeChroma.app (quit running app + index refresh)
npm --prefix desktop start          # run the shell against dist/codechroma-bridge (build the bridge first)
npm --prefix desktop start -- --repo /path/to/repo   # skip the launcher screen
npm --prefix desktop test           # vitest (recentRepos, shellPath, bridgeProcess)
poetry run python scripts/make_desktop_icon.py       # regenerate desktop/build/icon.png
curl -fsSL https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh | sh   # end-user install (macOS arm64/x64 / Linux x64) from latest Release via manifest
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.ps1 | iex"   # end-user install (Windows x64)
python3 scripts/gen_distribution_manifest.py --help   # the one latest.json generator (CI and local); see "End-user installs" below
```

`scripts/dev/build_desktop.sh` runs the three shared stages — SPA bundle → frozen Python bridge
(`packaging/bridge.spec`) → electron-builder (`electron-builder.yml`, mac `dmg` target). It is
macOS-only: the `--install` step (and the quit/index-refresh it triggers) shells out to Apple tools
(`hdiutil`, `osascript`, `killall Dock`, `mdimport`). There is no local Windows build script: Windows
installers are built by the `windows` job in `release-please.yml` (npm → pyinstaller →
electron-builder `win`/`nsis`), and the PR-time `packaging-smoke.yml` job exercises the
PyInstaller + `electron-builder --dir` stages on Linux so packaging breakage shows up before a release.

**Releases run on GitHub, not locally.** `.github/workflows/release-please.yml` is the release path:
`release-please` bumps the version + writes CHANGELOG + tags `vX.Y.Z` and opens a Release on merge;
then four platform builds (macOS `macos-14` arm64 and `macos-15-intel` x64, Windows
`windows-latest` x64, and Linux x64) run the same three stages here and upload the installers to that
Release. The release-please action uses the `code_pat_release` repository secret so its Release PR
triggers the follow-on release workflow when merged; configure that secret in repository settings
with repository Contents and Pull requests write access. The macOS matrix passes one architecture
per job and `electron-builder.yml` gives both DMGs explicit architecture names
(`CodeChroma-<version>-arm64.dmg` / `CodeChroma-<version>-x64.dmg`) for the checksum and manifest
steps. Windows uses the versioned asset name `CodeChroma-<version>-x64-Setup.exe` (plus a
`.sha256` sidecar); `install.ps1` finds it through `latest.json`. If a release exists but its
builds or manifest failed, dispatch the Release workflow on
`main` with `release_tag` (for example `v0.3.0`) to rebuild and publish assets for that release;
ordinary pushes only build when release-please creates a release. New releases stay drafts during
asset generation, so `/releases/latest/` continues resolving to the previous published release.
The final manifest-upload step publishes the new release only after all platform builds succeed; a
failed or in-progress build leaves the previous release as latest. A recovery dispatch first returns
its existing release to draft.
The author version lives in `desktop/package.json` (electron-builder reads it for the artifact name);
`release-please-config.json` syncs `web/package.json` and `pyproject.toml` from it. See
`docs/planning/015-distribution-install-update.md` for the plan and remaining work.
Pull-request CI also runs the desktop Vitest suites and TypeScript build.

**End-user installs go through `distribution/`.** One
`distribution/latest.json` manifest is published to every Release (built by the `manifest` CI job after
all platform builds) and lists a download URL + SHA-256 per platform target. The shell installer
uses it for macOS and Linux; Windows downloads its fixed-name installer and checksum directly from
GitHub's latest-release endpoint:
- macOS arm64/x64 / Linux x64: `distribution/install.sh` — `curl -fsSL
  https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh | sh`. Detects
  OS/arch, downloads and verifies the matching artifact, then installs into the current user's
  `~/Applications` without administrator access: macOS copies the `.app` from the `.dmg` via
  `hdiutil`; Linux copies and marks the AppImage executable. Pass `--system` to opt into replacing
  `/Applications/CodeChroma.app` on macOS or installing the Linux `.deb` via `apt`; the installer
  explains that system destination and why administrator authorization is needed before invoking
  `sudo`. This is the recommended end-user path — no checkout, no build, no admin password.
- Windows x64: `irm https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.ps1 | iex`
  (or `distribution/install.cmd` → `distribution/install.ps1`) — reads `latest.json`, requires a
  GitHub-releases URL, enforces a size cap plus the manifest size and SHA-256, then runs the NSIS
  wizard defaulted to the current user (`perMachine: false`, `selectPerMachineByDefault: false`,
  `allowElevation: false`). Options: `-Silent` (no wizard, per-user), `-Force`, `-Uninstall`,
  `-Purge`.
- Both installers also run `gh attestation verify` when the GitHub CLI is installed and logged in
  (a failed verification aborts the install) and otherwise warn that only the checksum was
  checked. Both support `--uninstall` / `-Uninstall` (`--purge` / `-Purge` also removes user data),
  skip an already-installed version unless forced, and `install.sh` swaps the app atomically with
  rollback, quits a running macOS app first, warns when `libfuse2` is missing, and on Linux writes
  a `.desktop` entry and a `~/.local/bin/codechroma` symlink. Test hooks that weaken security and
  must never be set in production: `CODECROMA_MANIFEST_URL`, `CODECROMA_MAX_BYTES`,
  `CODECROMA_GH_BIN` (`sh`), `CODECROMA_INSTALLER_URL` (`install.cmd`).
The manifest is served from each Release (`.../releases/latest/download/latest.json`), so no custom
domain is required; `CODECROMA_MANIFEST_URL` overrides the installer source (test hook). Its shape is
`{"version", "channel", "date", "min_supported_version", "assets": {target: url}, "sha256": {target: hex},
"size": {target: bytes}}` with targets `macos-arm64`, `macos-x64`, `windows-x64`, `linux-x64` (`.deb`)
and `linux-appimage`. Fields are additive: already-installed versions read only `version`/`assets`/
`sha256`, so never rename or remove those. `scripts/gen_distribution_manifest.py` is the **only**
generator — the release workflow's `manifest` job and developers call the same code
(`tests/unit/test_distribution_manifest.py` proves CI and local mode produce identical JSON), and
`tests/unit/test_distribution_consistency.py` fails if artifact names drift between
`electron-builder.yml`, the workflow globs, `updater.ts` and the generator. The `manifest` job also
attests `latest.json` and the `.sha256` sidecars and uploads version-pinned copies of
`install.sh`/`install.ps1`/`install.cmd` (use `.../releases/download/vX.Y.Z/install.sh` instead of
the mutable `main` URL to pin the installer itself). The Windows asset is the versioned
`CodeChroma-<version>-x64-Setup.exe` and its manifest URL is pinned to the release tag. Releases
published before the rename carry the unversioned `CodeChroma-Setup.exe`; `selectAsset` in
`updater.ts` keeps accepting both, and installed updaters match by the `-Setup.exe` suffix.

The release workflow keeps newly created releases in draft until every platform build and manifest
upload succeeds, so a failed build cannot replace the previous working latest release; a `gate` job
makes the builds wait for a green `ci.yml` on the same commit, manual dispatch from a branch other
than `main` fails fast (the attestation identity is pinned to `main`), and an `alert` job opens an
issue when a release is left as a draft. macOS/Windows signing steps exist but are gated on secrets
and do nothing while they are absent.

The root `scripts/install_desktop.sh`, `install_linux.sh` and `install_desktop.ps1` are deprecated
thin forwarders to `distribution/` (kept for one release; delete them once nothing references them).

**Updates are checked in-app and installed from GitHub, not in place.** On startup the main
process (`desktop/src/updater.ts`) queries the latest GitHub Release against `app.getVersion()`; if a
newer version exists it raises a native Notification ("Update to vX.Y.Z available") plus a
File → "Check for Updates…" menu item. The Settings → Updates dialog
(`web/src/assistant/UpdatesPanel.tsx`) shows current/latest stable versions, a "What's new in X" button that opens the release's changelog (GitHub release body, carried as `UpdateInfo.notes`/`UpdateState.notes`) in a separate window, check and download
progress, signature errors, and the explicit restart action. Its release-notes link opens in the
system browser. The startup check only runs for packaged installs (`app.isPackaged`) so a dev run
never hits the API. The native notification and menu actions still use a confirm dialog, then
download the correct per-platform artifact and run it: on macOS `hdiutil -plist` mounts the `.dmg`
(the mount point is parsed from XML, so space-y volume names can't break the path) and `ditto` stages the new `.app` next to the install as `CodeChroma.app.update-<pid>` with the current user's permissions (it never prompts for elevation; system-wide installs must be moved to `~/Applications` before in-app updates), then a detached `/bin/sh` script waits for this process to exit, swaps the staged bundle in (rolling back on failure), deletes the old bundle best-effort and `open`s the app — the running bundle is never modified while in use, which is what caused the `ENOTEMPTY` failure of #118; on Windows it silently runs the per-user `-Setup.exe` (`/currentuser /S --updated --force-run`, no UAC and no wizard; the NSIS template waits for the app to close and relaunches it); on Linux it
atomically replaces the running AppImage in place. The download streams to a `.part` sibling while
hashing SHA-256 in one pass (aborting and discarding anything past 1 GiB), is verified against
GitHub's asset digest (falling back to the release `.sha256` sidecar), then **provenance-checked**
before it's renamed into place:
`desktop/src/attestation.ts` fetches the artifact's signed attestation from GitHub
(`/repos/gutzerk/code_chroma/attestations/sha256:<hex>`) and verifies it with `sigstore-js`,
pinning the OIDC issuer and workflow identity of `release-please.yml` — so the signed attestation,
not the release's own sidecar, is the authority binding the artifact to this repo's release pipeline.
`desktop/package.json` pins Sigstore to v5. Electron 44.5.1 embeds Node 24.21.0, satisfying
Sigstore's Node 22.22.2+ runtime requirement.
If Sigstore's on-disk TUF cache can't chain to the live root (`root was signed by N/M keys`), `verifyAttestation` retries once with a throwaway `tufCachePath` seeded from the bundled root.
🔴 Electron's BoringSSL has no default digest for EC keys, but `@tufjs/models` (inside `sigstore`) calls
`crypto.verify(undefined, …)` on the Sigstore TUF root's ECDSA keys, so every root signature failed
and the updater reported "root was signed by 0/3 keys" (shown as "Release signature could not be
verified") — unrelated to commit/tag signing. `desktop/src/cryptoCompat.ts`'s `installEcdsaDigestShim`
(installed by `attestation.ts`) supplies sha256/sha384 by curve; node alone never reproduces the bug,
so check it under Electron (`ELECTRON_RUN_AS_NODE=1 electron script.cjs`).
A release that publishes no attestation refuses to update (it would be an unverified install), and
one whose installer has no reachable `sha256` digest surfaces the update but asks the user to install
manually instead of silently pretending to be current. Asset names are sanitized to
`[A-Za-z0-9._-]` before they become local paths (`safeAssetPath` in the updater, `safe_name` in the
shell installers). The AppImage replacement renames a PID-suffixed temp sibling over the running
file. After install the app either
relaunches (`app.relaunch()`, Linux only) or lets the detached helper/installer relaunch it (macOS, Windows). It connects to
`api.github.com/repos/gutzerk/code_chroma/releases/latest` using Node's built-in `fetch` — no
runtime dependency. The release version is cached in the app's userData directory, so the Updates
panel can retain the last successful result when GitHub is unavailable. GitHub API rate limits
surface their reset time when provided, and the manual GitHub Releases path remains available while
the retry button is disabled until the cooldown expires. The one-command installers (`distribution/install.sh`, `install.ps1`) reuse the same model: verify
the manifest SHA-256 before mounting or launching, and redownload once if a stale cached copy fails
its checksum — only a second mismatch is treated as tampering (a size mismatch against the manifest is
fatal immediately).
⚠ On **unsigned macOS**, Gatekeeper shows the standard "unverified publisher"
warning for the freshly copied `.app`; the update still works, it just can't be silent/delta (that
is the trade-off for not having a paid Developer ID). Release workflow actions are pinned to commit
SHAs (kept current by Dependabot). The release pipeline attests every installer with
`actions/attest-build-provenance` (short-lived OIDC identity, Sigstore/SLSA provenance), and the
in-app updater verifies that signed attestation (see above) — so the in-app path is protected
against a compromised release pipeline, not just corruption. ⚠ **The one-command installers** verify the manifest SHA-256 and, when `gh` is installed and logged in,
`gh attestation verify`; without `gh` they warn that only the checksum was checked, so that path guards
against corruption but not a compromised pipeline. The in-app check is advisory: it never downloads or installs without user consent.

**Updater behaviour added with the distribution work** (`desktop/src/`):
- `updateConstants.ts` is the single source for the repo slug, the releases/attestations/download URLs,
  the pinned Sigstore issuer and workflow identity (`...release-please.yml@refs/heads/main`),
  `PERIODIC_CHECK_MS` (6 h) and `FOCUS_MIN_GAP_MS` (1 h). A repo rename is a one-line change;
  `updateConstants.test.ts` fails if the slug leaks into other updater sources.
- Asset URLs must be `https://github.com/<REPO>/releases/(latest/)?download/...` (no credentials), checked
  when the release is parsed and again in `downloadAsset`.
- `checkForUpdates` takes a `ReleaseCache {etag, release}` held in memory by `UpdateService` and sends
  `If-None-Match`; a 304 or a rate-limit response reuses the cached release. Not persisted across restarts.
- `updateScheduler.ts` checks every 6 h and on window focus (throttled to 1 h), packaged builds only; a
  background check stays silent for a skipped version and notifies once per version.
- `update-settings.json` in userData (`skippedVersion`, `autoDownload`) via `updateCache.ts`; IPC
  `updates:skip` / `updates:auto-download`; UI in `UpdatesPanel.tsx`. A manual check always shows a skipped
  version; auto-download only downloads and verifies — installing still needs the explicit restart.
- Per-OS install: macOS and Linux use detached swap scripts in `updateScripts.ts`. The Linux script keeps
  the old AppImage as `<name>.previous` and, if the new one exits non-zero within 8 s, restores it and
  launches it. Windows is unchanged (per-user NSIS `/currentuser /S --updated --force-run /D=<dir>`) and
  has **no automatic rollback** (NSIS replaces in place). A `.deb` install under `/opt` or `/usr` gets a
  clear "update with apt or reinstall" message.
- The downloaded installer is deleted after a successful hand-off on macOS/Linux; `cleanupStaleDownloads()`
  removes `CodeChroma-*.dmg|.exe|.AppImage[.part]` leftovers from the temp dir at startup.
- The version shows in Help → About CodeChroma (Windows/Linux; macOS uses the app-menu About) and in the
  window title (`appVersion.ts`).
- Out of scope: delta updates (every update is a full download of 100 MB+; revisit with
  `.blockmap`/electron-updater once the bridge shrinks), signing hooks in `electron-builder.yml`, and
  reading a previously downloaded `latest.json` in the updater.

`CodeChroma.app` is a double-click app with no Python or Node on the user's machine: an Electron
shell that shows a recents/"Open folder…" launcher, then spawns a **PyInstaller-frozen bridge** on a
free port and loads `http://127.0.0.1:<port>` in the same window. macOS builds target arm64 and x64 DMGs;
Windows builds target an NSIS installer. `python -m codechroma.bridge.launch` remains the
browser/dev path and is unaffected.
The desktop shell opens in a regular windowed state so the operating system's minimize, maximize,
and close controls remain available. Its tab strip uses the canvas background color (`#1b1d23`).

Things worth knowing before touching it:

- **The bridge serves the SPA**, so there is no `file://` origin and no CORS in the desktop path:
  `create_app` mounts `web/dist` at `/` **after every router** (so `/repos/...` still wins) and adds
  `GET /health` for the readiness poll. The renderer needs no IPC to find its backend — it reads
  `window.location.origin`, which already carries the dynamic port. Both client contexts map the
  build-time sentinel `same-origin` to that origin (`SAME_ORIGIN` in `EngineClientContext.tsx`,
  `terminalBaseUrl` in `TerminalClientContext.tsx`); unset still means the fixture mock.
- ⚠ **A terminal-panel agent has no browser, so it can't read `window.location.origin`.**
  `bridge_main.py` exports `codechroma_BRIDGE_URL=http://<host>:<port>` into `os.environ` right after
  it resolves the free port; `_terminal_env()` inherits it into every PTY spawned for the terminal
  panel. The `codechroma-*` skills (`draw-diagram`/`review-diagram`/`plan`/`diagram-type`)
  read this env var first and fall back to `http://localhost:8000` (the dev-launcher default) only
  when it's unset — without it, a skill run from the packaged app's terminal panel hits a dead port
  and can't write.
- **One bridge process per repo, permanently.** `create_app(repo_root)` analyzes `main` as it builds,
  so switching the *opened* repo is a respawn (agent worktrees are a different thing: those are extra
  `Workspace`es inside the same process) — `main.ts` kills and re-spawns. `packaging/bridge_main.py`
  passes `--repo-path` straight to `create_app`, so a relative path is now fine there; only the
  `codechroma_BRIDGE_REPO_PATH` fallback still needs an absolute value to beat `PROJECT_ROOT`.
  A PR review opened from the canvas becomes a **workspace tab** (`TabManager.addWorkspaceTab`) that
  shares its repo tab's bridge — it never spawns a second bridge, and closing
  it leaves the repo tab (and its bridge) running. PR tabs are `ownsBridge: false`, so
  `closeTab`'s bridge-stop only ever hits the tab that actually started the process.
  🔴 **Tab titles are workspace-labeled** (`main.ts`'s `tabTitle`, #87): a repo tab reads
  `"<repo> [Main]"`, a PR workspace tab reads `"<repo> [PR #n]"` (found by matching the shared
  `bridge` identity back to its owning repo tab) — so two tabs on the same project stay
  distinguishable instead of one showing the bare repo name and the other a bare `#<number>`.
- 🔴 **Opening an already-open project asks which branch to show (#123).** `openRepo` no longer just
  focuses the existing tab: for a plain reopen it surfaces that tab, fetches `GET /branches/choices`
  from the project's bridge (`branchBridge.ts`) and shows `branchPicker.ts`'s modal window
  (`branchPicker/index.html`, plain JS like the launcher; contract in `branchPickerPreload.ts`). The
  user can pick an existing branch, create a new one (from a chosen start branch), or cancel (the open
  tab was already surfaced). A branch some workspace already shows is never opened twice — the bridge
  answers `POST /branches` with a 409 naming the holder and the shell focuses that workspace's tab
  (the repo tab for `main`/an agent). Otherwise `POST /branches` provisions a
  worktree (see `graph-bridge-core.md`'s branch workspaces) and the result opens as a *workspace tab*
  (`TabManager.addWorkspaceTab(owner, id, label)`, `openWorkspaceTab` in `main.ts`) on the same
  bridge, titled `Project [<branch>]` via `Tab.label`. A recents-tree click that names a workspace
  still just focuses. Every repo tab now loads `/?workspace=main` explicitly, so it never inherits
  another window's last pick from `agents.json`. Tests: `branchBridge.test.ts`, `tabManager.test.ts`.
- **`bridge/resources.py` is the only module that knows about freezing.**
  `resource_path("skills"|"web"|"detect")` resolves to `_MEIPASS/codechroma_data/...` when frozen, else
  the source tree. Anything new that reads a repo data file at runtime must go through it, and be
  listed in `packaging/bridge.spec`, or it will work in dev and 404 in the app.
- 🔴 **`desktop/src/shellPath.ts` is load-bearing.** A desktop launch can inherit an incomplete
  PATH, so the CLI and git may be invisible. It asks the host shell for its real PATH once at
  startup, using the host path separator; every spawned child inherits the fix.
- `desktop/launcher/` is deliberately plain HTML/JS outside the tsc build: it renders *before* any
  bridge exists, so it cannot be part of the served SPA. Its typed contract is `preload.ts`'s
  `LauncherApi`. Recents live in `app.getPath('userData')/recent.json`. Entries whose folder is gone are kept but flagged `missing` (greyed with ⚠); clicking one shows "Project not found at <path>…" and offers removal, and every entry has a hover × (`removeRecent`, list-only) (#56).
  Each recent entry also lists its known workspaces as child rows (#87's "Recent Projects: display
  Workspaces as child items") — `workspaceSummaries.ts`'s `listWorkspacesForRepo` does a best-effort
  read of that repo's own `.codechroma/{agents,prs}.json` (never the running bridge; the repo need
  not even be open), so a corrupt or missing file just means "no workspaces yet" rather than
  blocking the list. Clicking a workspace row opens the repo straight into it via `openRepo`'s
  `workspaceId` param, which loads `<bridge origin>/?workspace=<id>` — the same query param
  `agentStore.initialWorkspace()` already read for a PR's "Open in New Window". This only takes
  effect the first time that repo is opened in the run; reopening an already-open repo with a named workspace still just
  focuses its existing tab, so the requested workspace is dropped — switching to it from inside that
  tab's own Agent rail/PR dialog remains the way to get there (a *plain* reopen now asks for a branch,
  see the bullet below).
- **"New project…" on the launcher (#52)** creates a repo from scratch: name + location →
  `launcher:create-project` IPC → `desktop/src/newProject.ts`'s `createProject` writes
  `README.md`, `.gitignore`, `src/main.py` into `<location>/<name>` and runs `git init` (no commit, so
  no git identity needed; a missing `git` is tolerated), then the launcher opens it through the normal
  `openRepo` path. It refuses an invalid name or a non-empty existing folder. Tests:
  `desktop/src/newProject.test.ts`.
- **"Tutorial" button on the launcher** (top-right) opens a bundled example project:
  `launcher:create-tutorial` IPC → `desktop/src/tutorialProject.ts`'s `createTutorialProject` writes a
  tiny todo app (TypeScript `frontend/`, Python `backend/`, SQLite `db/`, plus prebuilt
  `c1`/`patterns`/`impact` diagram files the tutorial's stage 2 "draws"; `git init` also commits an
  older `backend/service.py` so the working tree carries a diff for the Change impact diagram) into
  `<userData>/codechroma-tutorial` (files are restored on every click, `git init` once) and the launcher
  opens it through the normal `openRepo` path. The canvas then runs the guided walkthrough
  (see [`web-panels.md`](web-panels.md)). Tests: `desktop/src/tutorialProject.test.ts`.
- `desktop/build/icon.png` is generated by `scripts/make_desktop_icon.py` (pure-stdlib PNG writer) and
- **"New project…" on the launcher (#52)** creates a repo from scratch: name + location →
  `launcher:create-project` IPC → `desktop/src/newProject.ts`'s `createProject` writes
  `README.md`, `.gitignore`, `src/main.py` into `<location>/<name>` and runs `git init` (no commit, so
  no git identity needed; a missing `git` is tolerated), then the launcher opens it through the normal
  `openRepo` path. It refuses an invalid name or a non-empty existing folder. Tests:
  `desktop/src/newProject.test.ts`.
  committed; `.gitignore` un-ignores it against the global `build/` rule.
- Tests: `tests/unit/test_resources.py`, `tests/unit/test_bridge_spa_mount.py`,
  `web/src/engine-client/sameOrigin.test.ts`, and the Vitest suites in `desktop/src/*.test.ts`.

**C# app distribution and updater (016 Phase 2; gated, nothing ships it yet).**
- 🔴 **Checksum-only downgrade.** The C# updater verifies the SHA-256 from GitHub's asset digest / `.sha256` sidecar
  / `latest.json` only. There is no Sigstore check and no Apple/Windows certificate. `UpdateState.VerificationNotice`
  (`UpdateConstants.ChecksumOnlyNotice`) is set when an update is offered and again when it is ready, and
  `UpdateState.Provenance` carries `ChecksumOnly`; the UI must show it. `install.sh --dotnet` / `install.ps1 -Dotnet`
  print the same warning. A compromised release pipeline is therefore not detected in-app.
- **Packaging** (`distribution/velopack/pack.ps1|pack.sh`, vpk 1.2.161 pinned): produces
  `CodeChroma-<v>-win-x64-Installer.exe` (Velopack Setup, fresh installs), `CodeChroma-<v>-win-x64.zip` (update
  payload; its `current/` folder is swapped in), `CodeChroma-<v>-osx-{arm64,x64}.zip` (the `.app`), and
  `CodeChroma-<v>-linux-x86_64.AppImage`, each with a `.sha256`. Names avoid every Electron suffix so installed
  Electron updaters ignore them; manifest targets are `dotnet-windows-x64`, `dotnet-windows-x64-update`,
  `dotnet-macos-arm64|x64`, `dotnet-linux-x64` (Electron targets unchanged). Release jobs `dotnet-windows|macos|linux`
  run only when repo variable `CODECROMA_BUILD_DOTNET` is `true` and ship the bridge in `<app>/bridge/codechroma-bridge/`
  (contract the shell must honour). The app does not call `VelopackApp.Run()` yet, so vpk runs with `--skipVeloAppCheck`.
- **Updater code** (`dotnet/CodeChroma.Shell/Updater/`): `UpdateChecker` (native names preferred, Electron names =
  `AssetKind.ElectronLegacy`, trusted-URL check, ETag cache), `UpdateDownloader`, `UpdateOperations`,
  `PlatformInstaller` (stages next to the install, writes a helper from `UpdateScripts`, starts it detached; the host
  then quits), `UpdateSettingsStore`/`UpdateScheduler`/`StaleDownloads`, `InstallOutcomeStore`.
- **Swap + rollback** (`UpdateScripts`): after the app exits the helper moves `target` to `target.previous`, moves the
  staged copy in, launches it and watches it for 8 s; if it dies (Windows/Linux: non-zero exit; macOS: no process
  via `pgrep`) the previous copy is restored and relaunched. The result lands in `<userData>/update-result.json`
  (`updated`/`rolled-back`/`failed`) and surfaces as `UpdateState.LastInstall`. Windows (new): directory swap of
  `...\CodeChroma\current` by a hidden PowerShell; macOS: `~/Applications/CodeChroma.app` via `ditto`; Linux keeps
  `.previous`. No delta updates (full zip each time).
- **Electron to C# migration**: `ElectronMigration` finds the old install, copies top-level `*.json` (recents, update
  settings/cache) and the tutorial project into the C# user-data dir once (never overwrites, never touches the source;
  no-op if the C# app uses the same dir, which it should: `ElectronUserDataDir`). Browser localStorage (canvas camera,
  expansion) is keyed by the random bridge port, so it never persisted and is not migrated. macOS/Linux installs
  replace the same path in place; on Windows `install.ps1 -Dotnet` (or `RemovalFor`) silently runs the NSIS uninstaller.
- Tests: `dotnet/CodeChroma.Shell.Tests/Updater/`, `tests/unit/test_distribution_{velopack,consistency,manifest,installer,workflows}.py`, `tests/pester/install.Tests.ps1`.

> Migration in progress: a C# / Avalonia replacement for this Electron shell is tracked in [`docs/planning/014-avalonia-shell.md`](../planning/014-avalonia-shell.md) (code in `dotnet/`). Electron remains the reference until it lands.

## C# shell (`dotnet/CodeChroma.Shell*`, in progress - plans 014/016)

The Avalonia replacement for the Electron host, not shipped yet; `desktop/` stays the shipping app. Run with
`dotnet run --project dotnet/CodeChroma.Shell.App -- --repo <path>` (needs `dist/codechroma-bridge`, or `CODECHROMA_BRIDGE=<exe>`;
`CODECHROMA_VERSION` overrides the displayed version). Logic is UI-free in `CodeChroma.Shell` (`ShellController` drives
`BridgeRegistry` -> `TabModel` -> `IShellUi.Navigate`); `CodeChroma.Shell.App` only renders. One `WebView.Avalonia` per tab
loads `http://127.0.0.1:<port>/?workspace=<id>` from the unchanged Python bridge. 🔴 Windows needs `app.manifest` with a
`supportedOS` entry or the native WebView host throws at startup. User data lives in the same folder as Electron's
(`%APPDATA%/CodeChroma`), so recents are shared. The canvas's `window.codechromaDesktop` is injected after each navigation
and talks to the shell over the WebView message channel (`DesktopScript`/`DesktopMessage`); `codechromaUpdates` is not
provided yet. Tests: `dotnet test dotnet/CodeChroma.Shell.sln`; smoke: `dotnet/CodeChroma.Shell.App/smoke/smoke.mjs`.

**Shell updater wiring (016 Phase 1 follow-up).** `CodeChroma.Shell.App/UpdateHost.cs` builds `UpdateService` over the
real `UpdateOperations` and owns: the first-run `ElectronMigration.Detect/ImportUserData` (failures never block startup),
the "updated / rolled back" report from `InstallOutcomeStore`, the scheduled checks (startup, every 6 h, window focus;
only for per-user installs via `UpdateScheduler`) and Help, Check for Updates, whose dialogs show
`VerificationNotice` (the checksum-only warning) before a download and before the restart. The page API
`window.codechromaUpdates` (`DesktopScript.cs`) round-trips over the WebView message channel: the page posts
`{type:"updates", callId, method, arg}`, `UpdatesBridge` (in `CodeChroma.Shell`, unit-tested) runs it and the shell replies
through `window.__ccUpdatesReply`; state changes are pushed with `window.__ccUpdatesPush` to every tab's `subscribe`.
`UpdatesBridge.ToJson` keeps the shape `web/src/assistant/UpdatesPanel.tsx` expects and adds `verificationNotice`,
`provenance`, `lastInstall`. The csproj `<Version>` is bumped by release-please (`xml` extra-file) and guarded by
`tests/unit/test_dotnet_version_sync.py`. Verified on a Windows display with `smoke/smoke.mjs`; `UpdatesPanel.tsx` does not
render `verificationNotice` yet (web is untouched), so in-page the warning is only in the shell dialogs.


### C# bridge bundling

`dotnet publish dotnet/CodeChroma.Shell.App -r <rid> --self-contained -p:BundleCSharpBridge=true` also publishes `dotnet/CodeChroma.Bridge` into `bridge/codechroma-bridge/` (apphost renamed to `codechroma-bridge[.exe]`) and copies `web/dist` (built with `VITE_ENGINE_BRIDGE_URL=same-origin VITE_TERMINAL_BRIDGE_URL=same-origin`) to its `web/` folder, which the bridge serves. The shell launches it as `codechroma-bridge --repo-path <repo> --port <n>` (`BridgeCli`) and probes `/health`. The gated `dotnet-*` release jobs use this option; the Electron jobs still freeze the Python bridge.

The shell icon is `dotnet/CodeChroma.Shell.App/Assets/icon.ico` (generated from `desktop/build/icon.png` by `scripts/make_ico.ps1`); it is the exe's `ApplicationIcon`, the window icon, and passed to `vpk pack --icon` for the shortcuts. macOS (`.icns`) and Linux icons for the Velopack packages are not wired yet.

The shell has no native menu bar: the tab strip (styled like the Electron tab bar: `#1b1d23` bar, `#6c8cff` active underline) ends in a "⋯" button whose flyout holds Open Repo, New Tab, Close Tab, Check for Updates and About (the Ctrl+O/T/W shortcuts still work). `App.axaml` carries the shared styles (rounded 7-10px buttons/inputs, primary/tutorial/flat classes) that mirror `desktop/launcher/index.html`, and `LauncherPanel` follows that page's layout.
