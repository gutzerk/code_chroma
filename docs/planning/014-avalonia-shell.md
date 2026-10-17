# 014 - Avalonia shell (replace the Electron host with C#)

Status: In progress. Electron (`desktop/`) stays the reference implementation until every item under
"Remaining work" is done and install, update and uninstall have been exercised on all targets.

Source: "Plan 4" of the migration plans (shell moves after the core and bridge plans, before the canvas).
Target is .NET 8 (the only SDK on the dev machine here); move to .NET 10 when the toolchain allows.

## Layout

- `dotnet/CodeChroma.Shell` - UI-free logic: `TabModel`, `BridgeManager`/`BridgeRegistry`, updater
  (`UpdateChecker`, `UpdateDownloader`, `UpdateService`, `InstallPlanner`, `InstallLocation`), `RecentRepos`,
  `WorkspaceSummaries`, `NewProject`, `BridgeLocation`, `BranchBridgeClient`.
- `dotnet/CodeChroma.Shell.Tests` - xUnit, `dotnet test dotnet/CodeChroma.Shell.sln`.
- `dotnet/CodeChroma.Shell.App` - Avalonia 11.3 host. Today only a window with a tab strip over `TabModel`
  (restores and builds; not exercised on a display). No WebView yet.

## Step 0 - baseline (not measured in this change)

No Electron build exists in the worktree and no display was available, so the numbers below are NOT captured.
Do this before deciding the migration is worth finishing:

- Installer size: `cd desktop && npm run dist` then `ls -l desktop/dist/*.{dmg,exe,AppImage,deb}` (or the assets of
  the latest GitHub release). The 72 MB PyInstaller bridge is part of every installer and is unaffected by this plan.
- Electron RSS per tab: open 1, 2, 4 projects; sum the working set of every `CodeChroma` process
  (Windows: `Get-Process CodeChroma | Measure WorkingSet64 -Sum`; macOS/Linux: `ps -o rss= -C CodeChroma` summed).
  Record the bridge processes separately: they are the same in both shells.
- Cold start: time from launch to the launcher window painted (stopwatch or `--trace-startup`).
- Re-run the same three measurements on the Avalonia host once it embeds the canvas WebView (WebView2 is itself a
  Chromium; expect the gain mostly from dropping the Electron main + GPU + utility processes, not from the canvas).

Go/no-go: continue only if the baseline shows a real bottleneck (shell RSS per tab or installer size).

## Test audit (Electron `desktop/src/*.test.ts` to xUnit)

Questions: (1) observable behaviour? (2) already covered elsewhere? (3) tied to the old framework?
Written red first (commit "test(shell): add red xUnit suite", 148 compile errors from missing types), then implemented.

| Electron test file (tests) | Decision | Where / why |
|---|---|---|
| `updater.test.ts` (37) | Merged + parametrized | `UpdateCheckTests` (asset per OS x arch, non-stable ignored, malformed, rate limit, sidecar digest), `VersionTests` (semver table), `UpdaterMatrixTests` (OS x outcome). `digestHex`/`safeAssetPath` kept as theories. |
| `updater.download.test.ts` (4) | Merged | `UpdaterMatrixTests` row set: platform (4) x outcome (digest ok, mismatch, oversized, attestation fails, attestation required but unavailable, HTTP failure) = 24 cases, plus no-digest refusal and verified-file reuse. |
| `updater.install.test.ts` (7) | Rewritten | Mocked `fs`/`child_process` were framework-bound. Now: `InstallPlanner` table, `AppImageInstaller` on a temp dir, `InstallLocation` path-rule table (11 rows). macOS dmg staging / swap script and the NSIS flags are NOT ported: they belong to the installer chosen below. realpath/uid ownership checks are not ported (see Remaining work). |
| `attestation.test.ts` (10) | Dropped for now (gap) | All tests exercise `sigstore-js` and its TUF cache retry. No audited .NET client is adopted (see below), so only the contract (`IAttestationVerifier`: ok / fails / unavailable) is tested in the matrix. |
| `cryptoCompat.test.ts` (3) | Dropped | Electron BoringSSL ECDSA digest shim; .NET uses standard crypto. |
| `updateService.test.ts` (8) | Rewritten | `UpdateServiceTests`; three failure cases collapsed into one theory. |
| `updateCache.test.ts` (2) | Kept | `UpdateCacheTests`; file format identical to Electron's so an existing cache is read. |
| `tabManager.test.ts` (19) | Rewritten | `TabModelTests` over a toolkit-independent model (views are opaque tokens). Symlink dedupe test returns early where symlinks need privileges. |
| `bridgeProcess.test.ts` (5) | Rewritten + extended | `BridgeManagerTests`, `RealProcessBridgeTests`. |
| `recentRepos.test.ts` (8) | Parametrized | `RecentReposTests`; also reads a file written by Electron. |
| `workspaceSummaries.test.ts` (6) | Parametrized | one `MemberData` table (6 rows). |
| `newProject.test.ts` (5) | Parametrized | invalid-name theory, scaffold, non-empty, missing parent, missing git. |
| `bridgeLocation.test.ts` (3) | Parametrized | OS x packaged theory + missing-bridge hint theory. |
| `branchBridge.test.ts` (7) | Rewritten | `BranchBridgeTests`, refusals as a theory. |
| `tutorialProject.test.ts` (8) | Deferred | 555 lines of embedded sample project; pure data, port after the shell runs. |

Added (no Electron precedent; `main.ts` was untested):

- Launch on a free port and pass `--repo-path/--port`; ready via the `bridge ready at` line OR `/health`; early exit
  reported at once; timeout stops the process (`BridgeManagerTests`).
- Per-repo registry: separate bridges per repo, reuse, respawn only the crashed repo, concurrent callers share one
  start, stop-all (`BridgeRegistryTests`).
- PR tab shares the owner's bridge, does not own it, closing it does not stop the bridge, and it follows the owner
  to a respawned bridge (`TabModelTests`).

Result: `dotnet test dotnet/CodeChroma.Shell.sln` - 170 passed, 0 failed, 0 skipped.

## Updater verification

- SHA-256: done (streamed, size cap, `.part` file removed on any failure, verified file reused).
- Sigstore attestation: **gap, documented**. NuGet has `Sigstore.Net` 1.0.3 (author Oleg Zimakov, ~1.6k downloads,
  unverified publisher, net8+) and `Sigstore` 1.1.1 (Mitch Denny, ~11k downloads, unverified). Neither is
  established or audited enough to make a trust root out of. `ChecksumOnlyAttestationVerifier` is the default and
  every `DownloadResult` carries `Provenance.ChecksumOnly` so the UI must say "checksum only". `UpdateDownloader`
  has `requireAttestation` to refuse such installs once a verifier exists. Next step: evaluate `Sigstore.Net`
  against the pinned workflow identity (`release-please.yml@refs/heads/main`, GitHub Actions OIDC issuer), or shell
  out to `gh attestation verify` when `gh` is installed.

## Installer and signing notes

- Windows: per-user MSIX needs a signing certificate to install at all; an unsigned per-user installer
  (Velopack/Squirrel-style, or keep NSIS-equivalent via WiX/Inno) avoids that and matches today's no-admin flow.
  Recommendation: Velopack (handles delta updates, per-user install, rollback) before MSIX; decide after the
  baseline. Authenticode is a paid decision, tracked with the distribution plan.
- macOS: builds are unsigned today. Avalonia output needs an `.app` bundle, hardened runtime and notarization
  (Apple Developer ID, paid) for a clean first launch; until then keep the right-click Open instruction.
- Linux: AppImage (self-replace implemented in `AppImageInstaller`) and `.deb`.
- WebView: Avalonia core ships no WebView. Candidates: `Avalonia.Controls.WebView`/`NativeWebView` (check licence),
  or host WebView2 / WKWebView / WebKitGTK through a community control. Must be chosen and verified per OS.
- `latest.json`, release-please and `distribution/install.*` stay; only asset names/globs change (coordinate with the
  distribution plan, which currently edits `desktop/src/updater*.ts`).

## Remaining work

1. Step 0 measurements (above) and the go/no-go.
2. WebView per tab hosting the existing web canvas; `ProcessBridgeLauncher` wiring into `main`-equivalent startup
   (open repo -> `BridgeRegistry.EnsureAsync` -> `TabModel.AssignRepo` -> navigate to the origin).
3. Graceful bridge stop: `Process.Kill(entireProcessTree)` is used; Electron sent SIGTERM then SIGKILL.
4. Avalonia views: launcher, branch picker, recent-repos tree (workspace summaries), About/version, update panel.
5. Updater: real `IUpdateOperations` (checker + downloader + platform installer runner), attestation verifier,
   realpath/ownership checks in `InstallLocation`, installer-specific swap/relaunch (replaces the dmg swap script and
   NSIS flags), periodic check.
6. `tutorialProject` port.
7. Installer, signing and notarization; CI matrix for `dotnet test` and the publish jobs.
8. Only then: delete `desktop/`, update `.github/workflows/release-please.yml`, `distribution/install.*`,
   `docs/architecture/desktop-app.md`, `CLAUDE.md`, `README.md` (separate commit, after install/update/uninstall are
   exercised on all four targets).
