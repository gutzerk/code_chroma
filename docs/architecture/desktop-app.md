# Desktop app (`dotnet/CodeChroma.Shell*`)

The desktop app is the C# / Avalonia shell with Velopack packaging and updater. It hosts the
unchanged React canvas in one WebView per tab and talks to the **C# bridge** (`dotnet/CodeChroma.Bridge`)
bundled next to it. There is no Electron, PyInstaller or Node at runtime. Node is only used to build
`web/`, which the WebView loads. Electron was removed in plan [017](../planning/017-finish-electron-removal.md);
the last Electron commit is the local tag `electron-last-build` (git history only, nothing ships from it; there were no Electron users, so no migration code exists).
The Python engine/bridge (`src/codechroma/`) remains the reference implementation and the dev path
(`python -m codechroma.bridge.launch`); it is not part of the desktop package.

```bash
dotnet run --project dotnet/CodeChroma.Shell.App -- --repo /path/to/repo   # run the shell; omit --repo for the launcher
dotnet test dotnet/CodeChroma.Shell.sln                                    # shell logic + updater tests (no display needed)
# CI: the `dotnet-shell` job in ci.yml runs that suite on every PR
dotnet publish dotnet/CodeChroma.Shell.App -r <rid> --self-contained -p:BundleCSharpBridge=true -o publish   # app + bundled bridge + web/dist
pwsh distribution/velopack/pack.ps1 -Version X.Y.Z -PublishDir publish -OutDir out   # Windows: Setup + update zip + .sha256
sh distribution/velopack/pack.sh osx-arm64 X.Y.Z publish out                       # macOS / Linux packages
python3 scripts/gen_distribution_manifest.py --help                        # the one latest.json generator (CI and local)
```

Running from source needs `web/dist` built with `VITE_ENGINE_BRIDGE_URL=same-origin VITE_TERMINAL_BRIDGE_URL=same-origin`
and a bridge executable: `BundleCSharpBridge=true` produces it, or point `CODECHROMA_BRIDGE=<exe>` at one.
`CODECHROMA_VERSION` overrides the displayed version.

## Shell layout

Logic is UI-free in `CodeChroma.Shell`; `CodeChroma.Shell.App` only renders.

- `ShellController` drives `BridgeRegistry` -> `TabModel` -> `IShellUi.Navigate`. One `WebView.Avalonia`
  per tab loads `http://127.0.0.1:<port>/?workspace=<id>` from that tab's bridge.
- `Bridge/BridgeManager` launches `codechroma-bridge --repo-path <repo> --port <n>` (`BridgeCli`) and probes
  `/health`. **One bridge process per repo, permanently**: switching the opened repo respawns it. A PR
  workspace or branch opened from the canvas is a *workspace tab* sharing its repo tab's bridge and never
  owns it; closing it leaves the repo tab running. Bridges join a KILL_ON_JOB_CLOSE Job Object on Windows,
  `BridgeRegistry.StopAllAsync` also stops still-starting bridges and `StartAsync` kills the process on
  cancellation or failure.
- `Tabs/TabTitles`: repo tab `"<repo> [Main]"`, PR workspace `"<repo> [PR #n]"`, branch workspace
  `"<repo> [<branch>]"`. Every repo tab loads `/?workspace=main` explicitly so it never inherits another
  window's last pick.
- `Projects/ProjectStores` (recents, with missing folders kept but flagged; per-repo workspace summaries
  read best-effort from `.codechroma/{agents,prs}.json`), `Projects/TutorialProject` (+
  `tutorial-project.json`: the bundled todo-app tutorial restored into `<userData>/codechroma-tutorial`) and
  new-project creation (`git init`, no commit) feed the launcher panel (`LauncherPanel`).
- Opening an already-open project asks which branch to show (`Bridge/BranchBridgeClient`: `GET /branches/choices`,
  `POST /branches`; a 409 names the workspace already showing it and the shell focuses that tab).
- `window.codechromaDesktop` is injected after each navigation and talks to the shell over the WebView message
  channel (`DesktopScript`/`DesktopMessage`). The shell accepts messages only while the tab URL origin equals its
  bridge origin; other navigations are cancelled and opened in the system browser.
- Calls that need an answer (`codechromaUpdates.*`, `saveFile`) go through one page-side `rpc` and are answered by
  `ShellReply.RunAsync` via `window.__ccReply(callId, ok, json)`. `saveFile(name, mime, base64)` (the canvas's Share
  menu) posts `save-file` (`id`=file name, `method`=mime, `arg`=base64); `MainWindow.SaveFileAsync` runs
  `CodeChroma.Shell/FileSaver` over Avalonia's `SaveFilePickerAsync` and replies `{saved}` (`false` = cancelled).
- Chrome: no native menu bar on Windows/Linux; the tab strip (`#1b1d23` bar, `#6c8cff` active underline) ends in a
  "⋯" flyout (Open Repo, New Tab, Close Tab, Check for Updates, About; Ctrl+O/T/W work). macOS gets a native menu.
  `App.axaml` carries the shared styles. The icon art is `Assets/icon.png`; `Assets/icon.ico` is generated from it by
  `scripts/make_ico.ps1` and `Assets/icon.icns` (one 256px `ic08` PNG entry) by `scripts/make_icns.py` (pure Python, no
  Pillow); regenerate both after changing `icon.png`. `pack.ps1` passes the `.ico` to `vpk --icon`; `pack.sh` passes the
  `.icns` for `osx-*` and the `.png` for `linux-x64`. On Linux `install.sh` extracts the icon from the installed AppImage
  (`--appimage-extract '*.png'`) into `~/.local/share/icons/hicolor/256x256/apps/codechroma.png`, adds `Icon=codechroma` to
  the `.desktop` entry, and `--uninstall` removes it; if extraction fails the entry is written without `Icon=` and a
  warning is printed.
- 🔴 Windows needs `app.manifest` with a `supportedOS` entry or the native WebView host throws at startup.
  Linux needs WebKitGTK (and `libfuse2` for the AppImage).
- 🔴 `Program.Main` calls `VelopackApp.Build().Run()` first so Velopack's install/uninstall hooks work. Real
  install/uninstall hooks are still unverified on a real install.
- The environment for agent PTYs and skills comes from the bridge's `RuntimeEnvironment` (login-shell PATH, see
  [`runtime-environment.md`](runtime-environment.md)); every agent terminal and headless skill run gets `CODECHROMA_WORKSPACE_ID` (the agent/job id) and
  `CODECHROMA_BRIDGE_URL` (the real dynamic port, `BareSkill.BridgeUrl`) from `BridgeAddress.ExportIdentity`, so a
  terminal-panel agent, which has no browser, can reach the right bridge. 🔴 Both names are upper-case: env
  names are case-sensitive on macOS/Linux, and the skills and check scripts read exactly these two.
- The bridge serves the SPA (`web/` folder next to it), so there is no `file://` origin and no CORS; both client
  contexts map the build-time `same-origin` sentinel to `window.location.origin`
  (`web/src/engine-client/sameOrigin.test.ts`).
- User data lives in `AppPaths.UserDataDir` (`%APPDATA%/CodeChroma`, `~/Library/Application Support/CodeChroma`,
  `$XDG_CONFIG_HOME/CodeChroma`).

## Distribution and updates

Everything is published to GitHub Releases by `.github/workflows/release-please.yml`; releases are not built
locally. `release-please` (using the `code_pat_release` secret so merging its Release PR triggers the build)
bumps the version, writes CHANGELOG and tags `vX.Y.Z`; the author version is the shell csproj `<Version>`
(release-please `xml` extra-file, guarded by `tests/unit/test_dotnet_version_sync.py`), synced with
`web/package.json` and `pyproject.toml` via `release-please-config.json`. A `gate` job waits for a green `ci.yml`
on the same commit, new releases stay drafts until every platform build and the manifest upload succeed (so
`/releases/latest/` keeps the previous release on failure), an `alert` job opens an issue when one is left as a
draft, and dispatching the workflow on `main` with `release_tag` rebuilds a release's assets.

**Packaging** (`distribution/velopack/pack.ps1|pack.sh`, `vpk` 1.2.161 pinned) produces, each with a `.sha256`:
`CodeChroma-<v>-win-x64-Installer.exe` (Velopack Setup, fresh installs), `CodeChroma-<v>-win-x64.zip` (update
payload whose `current/` folder is swapped in), `CodeChroma-<v>-osx-{arm64,x64}.zip` (the `.app`) and
`CodeChroma-<v>-linux-x86_64.AppImage`. The bridge ships in `<app>/bridge/codechroma-bridge/`.

**Manifest.** `distribution/latest.json` is attached to every Release by the `manifest` job (which also attests it
and uploads version-pinned copies of the installers). Shape: `{"version", "channel", "date",
"min_supported_version", "assets": {target: url}, "sha256": {target: hex}, "size": {target: bytes}}`; fields are
additive, so never rename or remove `version`/`assets`/`sha256`. Targets: `dotnet-windows-x64` (Setup), `dotnet-windows-x64-update` (zip), `dotnet-macos-arm64`, `dotnet-macos-x64`, `dotnet-linux-x64`; the `dotnet-` prefix is historical. `scripts/gen_distribution_manifest.py` is the
only generator (`tests/unit/test_distribution_manifest.py` proves CI and local output are identical) and
`tests/unit/test_distribution_consistency.py` fails if artifact names drift between the packer, workflow globs,
the updater and the generator.

**Installers** (`distribution/install.sh`, `install.ps1`, `install.cmd`): read the manifest, enforce a size cap and
the SHA-256, and also run `gh attestation verify` when the GitHub CLI is installed and logged in (otherwise warn
that only the checksum was checked). Per-user by default, no administrator rights: macOS unzips the `.app` into
`~/Applications`, Linux installs the AppImage with a `.desktop` entry and `~/.local/bin/codechroma`, Windows runs the
Velopack Setup. Options: `--force`, `--uninstall`, `--purge` (`-Force`/`-Uninstall`/`-Purge` on Windows). `--dotnet`/`-Dotnet` are accepted and ignored (old command lines keep working); `--system` is rejected because there is no system-wide package (so no `.deb`). Test hooks that
weaken security and must never be set in production: `CODECROMA_MANIFEST_URL`, `CODECROMA_MAX_BYTES`,
`CODECROMA_GH_BIN` (`sh`), `CODECROMA_INSTALLER_URL` (`install.cmd`). Pester/shell tests:
`tests/pester/install.Tests.ps1`, `tests/unit/test_distribution_installer.py`.

**In-app updater** (`dotnet/CodeChroma.Shell/Updater/`): `UpdateChecker` (trusted-URL check, ETag cache),
`UpdateDownloader`, `UpdateOperations`, `PlatformInstaller` (stages next to the install, writes a helper from
`UpdateScripts`, starts it detached, then the host quits), `UpdateSettingsStore`/`UpdateScheduler`,
`InstallOutcomeStore`, `UpdatesBridge`. `CodeChroma.Shell.App/UpdateHost.cs` wires it: scheduled checks at startup,
every 6 h and on window focus (per-user installs only), Help -> Check for Updates, and the "updated / rolled back"
report (`Dialogs.ShowInstallResultAsync`: coloured status chip, headline, explanation, monospace detail block, next-step hint, Continue). Accepting an update shows `Dialogs.ShowProgress` (indeterminate, non-dismissable) while it downloads. The "update available" prompt is `Dialogs.ShowUpdateAsync` (release notes rendered by `MarkdownText`, scrollable and capped to the window height; Install / Skip this version / Later — Later reappears next launch, Skip persists `skippedVersion`). The canvas's `window.codechromaUpdates` (`web/src/assistant/UpdatesPanel.tsx`) round-trips over the WebView
channel; `UpdatesBridge.ToJson` adds `verificationNotice`, `provenance` and `lastInstall`.
`UpdateConstants` is the single source for the repo slug, intervals and wording; download URLs must be
credential-free `https://github.com/<repo>/releases/(latest/)?download/...` with no `.`/`..`/`%2e` segments.

- 🔴 **Checksum-only verification.** The updater verifies the SHA-256 (GitHub asset digest, `.sha256` sidecar or
  manifest) only: no Sigstore check and no Apple/Windows certificate. `UpdateState.VerificationNotice`
  (`UpdateConstants.ChecksumOnlyNotice`) is set when an update is offered and when it is ready, and
  `UpdateState.Provenance` carries `ChecksumOnly`. A compromised release pipeline is not detected in-app.
  The shell dialogs show the notice; `UpdatesPanel.tsx` does not render it yet.
- **Swap and rollback** (`UpdateScripts`): after the app exits the helper moves `target` to `target.previous`, moves
  the staged copy in, launches it and watches it for 8 s; if it dies (Windows/Linux: non-zero exit; macOS: no process
  via `pgrep`) the previous copy is restored and relaunched. The result lands in `<userData>/update-result.json`
  (`updated`/`rolled-back`/`failed`) and surfaces as `UpdateState.LastInstall`. Windows swaps `...\CodeChroma\current`
  with a hidden PowerShell, macOS replaces `~/Applications/CodeChroma.app` via `ditto`, Linux keeps `.previous`.
  🔴 The helper writes `updated` *before* launching the new version (the 8 s health check only overwrites it with `rolled-back`), because the new app reads the result file once at startup; writing it after the health check made the "updated" report show a launch late. `UpdateHost.QuitForUpdate` closes the window and force-exits (`Environment.Exit`) after 10 s, so a hung bridge shutdown cannot leave the helper waiting out its 120 s for the PID.
  🔴 On Windows a directory that is any process's cwd cannot be renamed, so the helper starts with the temp dir as its cwd (`ProcessHelperLauncher`, plus `Set-Location` in the script) and, before the swap, waits up to 10 s for processes running from `$Target` (bridge/agent children) and then force-stops them; otherwise the update fails with "could not move the current version aside".
  No delta updates (full package each time). `apply-update.sh` unsets `APPIMAGE APPDIR ARGV0 OWD` and removes itself.
- ⚠ Releases are unsigned: SmartScreen and Gatekeeper show an "unverified publisher" warning; a `.deb` or
  system-wide install is not updated in place.

## Embedding model download

The fast process-diagram path needs a 162 MB ONNX model; it is not in the installer. On first use the bridge downloads it from the `models-v1` GitHub release into `~/.codechroma/models` and checks its SHA-256 ([`context-tool.md`](context-tool.md)). Offline, the generate route reports "embedding model unavailable".

## Bridge gaps vs the Python bridge

The C# bridge replaces the Python one in the shipped app. Known, owner-confirmed differences (plan 017 table A):
summaries are offline-only (no Claude call), the graph is in-memory (no `graph.db`), PR happy path needs `gh`,
nested-process foreground probing is degraded, and execution tracing capture stays Python (`sys.monitoring`; C#
only plays traces back). Everything else (graph, canvas, recipes, diffs, agents, PRs, epics, PTY, skill/LLM runners,
branches, traces, settings, patterns, impact/review, plain wiki) is ported. Workflow runs (steerable stop/pause/breakpoints, [`workflows.md`](workflows.md)) exist only in the C# bridge; the Python bridge has no mirror yet; the wiki-general generate/update port is in progress (plan 017 row 4); see
[`engine.md`](engine.md) and [`graph-bridge-core.md`](graph-bridge-core.md).

## Tests

`TcpPortFinder.FindFreePort(repoPath)` returns a stable port per repository (FNV-1a of the canonical repo path, mapped into 20000–31999) so the bridge URL survives app restarts and agent tasks stay valid; if that port is taken it probes the next 63 in the range, then falls back to an OS-assigned port. Once a bridge is ready, `BridgeEndpointFile` (re)writes `<repo>/.codechroma/bridge.json` (`origin`, `port`, `updated_at`) so agents that outlive a restart re-read the live URL; it is not deleted on exit, so a refused connection means re-read and retry.
`RealProcessBridgeTests.A_taken_port_falls_back_to_another_bindable_one` holds the preferred port open
while requesting and binding the fallback, then closes both even if an assertion fails; a respawned bridge
keeps its port (`RealBridgeEndToEndTests`).
The probe does not reserve a port for the child bridge between discovery and startup.

`dotnet/CodeChroma.Shell.Tests/` (updater, tabs, stores, bridge manager, `UpdatesBridge`), `dotnet/CodeChroma.Bridge.Tests/`,
`tests/unit/test_distribution_*.py`, `tests/pester/install.Tests.ps1`. Smoke on a display: `dotnet/CodeChroma.Shell.App/smoke/smoke.mjs`.
macOS and Linux behaviour (WKWebView/WebKitGTK rendering, Unix PTY, install/update/rollback/uninstall) was reviewed
from code and is not verified on real hardware.

🔴 macOS crash: WebView.Avalonia 11.0.0.1 runs `ExecuteScriptAsync(script)` on macOS as `__dispatchMessageCallback("<script>")` (a Blazor-only hook)
and does `result.ToString()` on the null result, an unhandleable NRE inside a native callback that aborts the app. Two guards: `UpdateHost`
only receives tabs that are on the bridge origin (`MainWindow` filters with `IsBridgeOrigin`; empty tabs get no scripts), and `web/index.html`
defines `window.__dispatchMessageCallback` (evals the source, always returns a string) so scripts sent to a loaded page never return null.

## macOS privacy (TCC) prompts

Issue #189: macOS asked to allow Apple Music / media library / photo access. The app declares no usage-description keys and needs none. The only code that walks an arbitrary folder is `AgentBootstrap.Walk` (first-commit plan for a non-repo folder); opening a home-level folder made it recurse into `~/Music`, `~/Pictures`, `~/Movies` and `~/Library`, and macOS attributes that access to CodeChroma. `AgentBootstrap.IsMacProtectedFolder` now skips those direct children of the home folder on macOS (`MacProtectedFolderTests`). 🔴 Unverified on a real macOS build: `vpk` generates `Info.plist`, so no custom keys or entitlements are shipped; if a prompt persists, find the other trigger (a spawned CLI or login shell run from `~`) rather than adding usage strings.

## CLI lookup and clipboard notes

- `CodeChroma.Bridge/Stores/CliLocator.cs` searches the process PATH, then well-known install dirs (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, npm global, GitHub CLI dirs), because a GUI-launched app inherits a minimal PATH (agents `claude` / `gh` not found).
- `DesktopScript.cs` adds a guarded fallback for Ctrl/Cmd+C/X/V/A that only acts when the webview raised no native clipboard event (unverified on macOS).
