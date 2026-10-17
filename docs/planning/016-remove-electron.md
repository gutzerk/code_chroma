# 016 - Remove Electron completely

Status: Idea. This is the end state of plans 011-014: nothing in the shipped app depends on
Electron, Chromium or Node at runtime. Electron (`desktop/`) stays the shipping app and the reference
until every exit gate below is met. Nothing here is started beyond what plans 011-015 already built.

Target: one cross-platform .NET (C#) desktop app (Avalonia) for Windows, macOS and Linux. It is not a
separate native stack per OS. Swift is out because it cannot ship on Windows or Linux.

## Where we are

Built and merged on `integration/csharp-and-distribution`, none of it wired into a shipped build:

| Piece | Code | State |
|---|---|---|
| Graph core | `dotnet/CodeChroma.Core` | Parity with Python goldens, 144 tests. Analyzers still Python. |
| Bridge | `dotnet/CodeChroma.Bridge` | graph, diagrams, workspaces, transport groups only; stub engine. About 14 route modules missing. |
| Canvas logic + view | `dotnet/CodeChroma.Canvas`, `.Canvas.Avalonia` | Routing, collision, layout, scene graph, pan/zoom/select/drag. No hierarchy canvas, panels or terminal. |
| Shell logic | `dotnet/CodeChroma.Shell`, `.Shell.App` | Tab model, bridge manager, updater logic, stores. Window builds, never run on a display. |

Measured so far: the graph core saves about 100 ms of a 3.6 s analyze, so speed alone does not justify
the rewrite. Electron baselines (memory per tab, installer size, cold start) are NOT measured.

## What "no Electron" requires

Electron currently provides five things. Each needs a replacement before `desktop/` can go.

1. **Window + tab host** (`desktop/src/main.ts`, `tabManager.ts`, `tabbar/`): replaced by `CodeChroma.Shell.App`.
2. **Chromium renderer for the React canvas** (`web/`): replaced by the native canvas, or by an OS
   WebView while the native canvas is incomplete.
3. **Node main-process logic** (`bridgeProcess.ts`, `recentRepos.ts`, `workspaceSummaries.ts`,
   `newProject.ts`, `tutorialProject.ts`, `branchBridge.ts`, `branchPicker.ts`, launcher): replaced by
   `CodeChroma.Shell` (already ported, see 014).
4. **Updater + attestation** (`updater.ts`, `updateService.ts`, `attestation.ts`, `cryptoCompat.ts`,
   `updateScripts.ts`, `updateScheduler.ts`): replaced by the C# updater. Sigstore verification has no
   trusted .NET client yet (see Decisions).
5. **Packaging + installers** (`electron-builder.yml`, NSIS/DMG/AppImage/deb, `release-please.yml`
   build jobs, `distribution/*`, `latest.json`): replaced by .NET publish + new installers.

The Python bridge (PyInstaller, 72 MB) is not part of Electron. It stays until Plan 2 replaces it, and
it is still needed for tracing permanently. Removing Electron does not remove Python.

## Decisions needed before Phase 1

1. **WebView component** for hosting the React canvas during the transition (Avalonia core has none).
   Candidates to evaluate on all three OSes: a WebView2/WKWebView/WebKitGTK wrapper for Avalonia. Pick
   one, prove it loads `http://127.0.0.1:<port>` and passes the existing Playwright journeys.
2. **Terminal.** xterm.js has no mature native .NET equivalent. Options: keep xterm.js in a WebView
   panel (recommended), or build/adopt a native VT control. This decides whether "no Chromium at all"
   is reachable, because a WebView still loads the OS browser engine (not Electron).
3. **Installer format** per OS (MSIX or Velopack on Windows, notarized DMG/pkg on macOS, AppImage/deb
   on Linux) and whether to buy an Apple Developer ID and a Windows Authenticode certificate.
4. **Sigstore on .NET.** The two NuGet clients have unverified publishers and low usage. Either vet one,
   run `gh attestation verify` / `cosign` as a subprocess, or ship checksum-only updates and document it.
5. **Go/no-go.** Decided from the Phase 0 numbers, not from preference.

## Phases

Every phase follows the repo rule: **tests first**. Before porting a test, ask: does it assert
behaviour someone can observe? is it already covered elsewhere? is it tied to Electron/jsdom? Merge
same-shape tests into one table (`[Theory]` / `it.each`). Old code is deleted only in the phase's
final commit, after its exit gate passes.

### Phase 0 - Measure and decide (no code deleted)
- Build the current Electron app. Record installer size, cold start to first canvas, and RSS with 1, 3
  and 5 tabs on Windows, macOS and Linux. Record the Python bridge's cold start (about 4.75 s in a dev
  venv) and the frozen build's size.
- Prototype the same three numbers for `CodeChroma.Shell.App` hosting the React canvas in a WebView.
- Exit gate: written go/no-go in this doc, with the numbers. Stop here if the gain is small.

### Phase 1 - Shell runs the React canvas
- Add the chosen WebView to `CodeChroma.Shell.App`; one view per tab; tab bar from `TabModel`.
- Wire the open-repo flow: launcher, recent repos, branch picker, new project, tutorial project,
  `BridgeRegistry` -> `TabModel` -> navigate. The shell talks to the existing Python bridge unchanged.
- Port the missing behaviour tests: free-port + `ready` handshake end to end, per-repo respawn, PR tab
  sharing a bridge, window title with version, About entry.
- Exit gate: every Playwright journey in `web/e2e/` passes inside the C# shell; Electron and C# shell
  can be installed side by side.

### Phase 2 - Updater, installers, signing for the C# app
- Real update operations and platform installer runner (macOS swap script, Linux AppImage with
  `.previous` rollback, Windows installer); Windows rollback is new design work (Electron has none).
- New installers per decision 3; CI jobs in `release-please.yml` for .NET publish on all four targets;
  `latest.json`, `distribution/install.*` and the consistency test updated for the new asset names.
- Keep the updater able to move an installed Electron copy to the C# app (one-time migration release),
  preserving userData: recent repos, workspace summaries, update settings, per-workspace canvas state.
- Exit gate: install, update (from the previous release), rollback after a forced failure and
  uninstall succeed on Windows, macOS (arm64 and x64) and Linux (AppImage and deb).

### Phase 3 - Migration release
- Ship one release that contains both: the C# app, plus an Electron build that updates itself into it.
- Gate on a soak period with no migration failures reported; document the manual fallback download.

### Phase 4 - Remove Electron (the deletion phase)
Delete only after Phase 3 is out and stable:
- `desktop/` entirely: `src/`, `launcher/`, `tabbar/`, `branchPicker/`, `build/`, `electron-builder.yml`,
  `package.json`, `package-lock.json`, and the Electron/electron-builder/sigstore-js dependencies.
- `cryptoCompat.ts` (the BoringSSL ECDSA shim) and the Electron-specific `attestation.ts` path.
- Electron jobs and steps in `.github/workflows/` (`ci.yml` desktop job, the `release-please.yml` macOS/
  Windows/Linux electron-builder steps, `packaging-smoke.yml` electron stage).
- Legacy `scripts/install_*` forwarders and `scripts/dev/build_desktop.sh` (rewrite for .NET).
- `window.codechromaDesktop` / `codechromaUpdates` preload bridges in `web/` if the React canvas is no
  longer used (see Phase 5), otherwise replace them with the WebView's message channel.
- Docs in the same commit: `README.md`, `QUICKSTART.md`, `CLAUDE.md`, `docs/architecture/desktop-app.md`
  (rewrite for the C# shell), and the planning docs 011-016.
- Exit gate: a clean checkout builds, tests and releases with no Node/Electron step for the desktop app
  (Node may remain for the web canvas if Phase 5 is not done).

### Phase 5 (optional) - Replace the React canvas, and the Python bridge
These are not needed to remove Electron, only to remove the WebView, Node and Python:
- Native canvas parity: expand-in-place hierarchy, `CanvasNodeBox`/`Block` visuals, rubber-band select,
  group drag, undo, trace playback, diff and change cards, agent windows, code popup, syntax
  highlighting. Exit gate per feature: the matching Playwright journey rewritten as a headless Avalonia test.
- Finish the C# bridge (remaining ~14 route modules, PTY host, skill and LLM subprocess runners, trace
  sockets) and swap in the C# graph core; run the Python contract suite against it until it matches.
- Port the analyzers or keep Python only for tracing and wiki generation.
- Only then delete `web/` (or reduce it to the terminal panel) and the PyInstaller bridge.

## Risks

- **Rewrite size.** About 42k LOC of React and 30k of Python behind the canvas and bridge; Phase 5 alone
  is months of work. Phases 0-4 are the part that actually removes Electron.
- **WebView differences.** WebView2, WKWebView and WebKitGTK are not Chromium; rendering, WebGL (xterm)
  and DevTools behaviour must be re-verified per OS.
- **Updater trust.** Moving off Electron's fetch/Sigstore stack must not weaken verification silently;
  checksum-only is a downgrade and must be flagged in the UI and docs.
- **Migration.** Users on Electron must reach the C# app without a manual reinstall and without losing
  their per-user state.
- **Unsigned binaries.** No Apple/Windows signing today; a new native binary may trigger more
  SmartScreen/Gatekeeper friction than Electron's, until signing is decided.
- **Test debt.** Many Electron and DOM tests do not port; each one dropped must have a recorded reason.

## Done when

- No `electron`, `electron-builder` or Chromium in the shipped installers, and no Electron step in CI.
- Install, update, rollback and uninstall verified on all three OSes from the C# installers.
- Existing users reach the new app through the updater with their settings intact.
- Docs describe the C# shell only.
