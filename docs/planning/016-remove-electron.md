# 016 - Remove Electron completely

Status: Phase 0 measured (Windows only); owner decided GO on Phases 1-5 despite the modest numbers. This is the end state of plans 011-014: nothing in the shipped app depends on
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
the rewrite. Electron and WebView-shell baselines are in "Phase 0 results" below (Windows only).

## Phase 0 results (2026-10-17, Windows 11 x64 only)

Method: installed Electron 0.12.0 vs a throwaway Avalonia 11.3 + `WebView.Avalonia` 11.0.0.1 (WebView2)
prototype, both loading the same frozen Python bridge (`dist/codechroma-bridge`) against small fixture repos
(`tests/fixtures/*`). Cold start = process spawn until `#root` has >40 DOM nodes (read over CDP). Memory =
summed working set of the whole process tree after settling (shared pages are counted per process, so treat
it as an upper bound; private bytes are about 35% lower for both). Two runs each; the runs agree within ~10%.
The Electron tabs were opened one after another in a running app; the prototype was started fresh with
1/3/5 views (all views alive, like Electron's `WebContentsView`s).

| Metric | Electron | C# + WebView2 | Delta |
|---|---|---|---|
| Cold start to first canvas | 5.2-5.6 s | 5.0-5.1 s | about equal (bridge-bound) |
| RSS, 1 tab | 700-830 MB | 557-563 MB | -20 to -30% |
| RSS, 3 tabs | 1.13-1.29 GB | 0.90-0.91 GB | about -20 to -30% |
| RSS, 5 tabs | 1.61-1.73 GB | 1.25-1.26 GB | about -25% |
| Per-tab bridge (Python, unchanged) | 88 MB | 87 MB | none; 440 MB of the 5-tab total either way |
| Installer | 139 MB (NSIS 0.12.1, unsigned, includes the bridge) | not built; self-contained publish is 108 MB on disk / 44 MB zipped, plus the 68 MB bridge | est. 30-40% smaller |
| Installed size | 450 MB | about 176 MB (shell 108 + bridge 68) | about -60% |

Not measured: macOS and Linux (no hardware here), WKWebView/WebKitGTK behaviour, the Python bridge cold
start on its own (about 4.75 s in a dev venv per earlier notes, which is what dominates cold start here).
The prototype also showed that `WebView.Avalonia` needs an `app.manifest` with a supported-OS list or the
native control host throws at startup. The C# shell reuses the same React canvas, so the canvas itself
costs the same in both; the saving is Electron's own processes, not the work.

### Go/no-go

The gain from Phases 0-4 on Windows is real but modest: about a quarter less memory, a smaller install,
and no change in startup, because both are limited by the Python bridge, which stays. It costs a new
installer/updater/signing pipeline plus a migration release, and the only WebView component for Avalonia 11
that supports all three OSes in the evidence so far is a community package (111k downloads, one publisher)
that is unproven on macOS and Linux. Recommendation: **no-go on a full Electron removal for performance
reasons alone**; go only if the driver is something the numbers do not capture (e.g. dropping the Node/
Electron toolchain and Sigstore shim, or a single .NET codebase). Decision is the owner's.

### Decisions taken (2026-10-17)

- Go/no-go: **go, Phases 1-5** (owner decision; the Phase 0 recommendation above was no-go on performance alone).
- WebView: `WebView.Avalonia` 11.0.0.1 (+ `.Desktop`), needs an `app.manifest` supported-OS list on Windows.
- Terminal: xterm.js stays in the WebView panel, backed by the existing PTY bridge.
- Installers: Velopack on all three OSes.
- Update verification: **checksum-only** (SHA-256 from `latest.json`/sidecar). This is a downgrade from Sigstore
  attestation and must be flagged in the UI and docs. No Apple/Windows certificates.

## Status after the first implementation pass (2026-10-17)

Merged into `integration/csharp-and-distribution`, nothing pushed or released. Windows host only.

| Phase | State |
|---|---|
| 0 | Done, measured. |
| 1 | Code done (WebView per tab, open-repo flow, tests). **Exit gate not met**: `web/e2e` Playwright journeys not run in the shell, no side-by-side install test, native dialogs not clicked through. |
| 2 | Code done (updater with rollback, Velopack packaging, checksum-only verification, Electron migration, gated CI jobs). **Exit gate not met**: nothing run on macOS/Linux/CI, no `.deb`, `Shell.App` now calls the updater, the migration and shows the checksum-only notice in its dialogs (wired and checked on Windows only; `UpdatesPanel.tsx` does not render the notice yet). |
| 3 | Not started (needs a published migration release and a soak period). |
| 4 | **Not done and must not be done yet**: it is gated on Phase 3 being out and stable. `desktop/` is intact. |
| 5 | Partial. Canvas: hierarchy, select, drag, undo, code popup, diff, trace, agent-window layer ported with headless tests, but not wired to a live bridge. Bridge: assistant, runtime, llm settings, traces, issues, diagram types, branches and C# graph core done; agents, prs, canvas, recipes, diffs, epics, wiki_general, PTY host and skill/LLM runners remain. |

Suites after the merge: Shell 307, Canvas 503 + 66, Bridge 173, Core 144 (all pass, 0 skipped); desktop vitest 214 (2 skipped); web vitest 1483; Python contract + distribution
tests pass and `ruff` is clean when run from a clean checkout (run inside the main checkout they fail because `.claude/worktrees/` holds duplicate repo copies).

### Update 2026-10-18: C# bridge and analyzers merged

Merged into `integration/csharp-and-distribution` (not pushed): all route groups except those listed below, a real
cross-platform PTY host (`Porta.Pty`; the Windows `[detached]` close-after-20ms bug of the frozen Python bridge is
covered by real-process tests, not yet verified in the shipped app), and C# analyzers for all 11 languages
(`TreeSitter.DotNet`, `YamlDotNet`; exact parity with Python on Go, Rust, Java, PHP, Ruby, C, YAML, Python; about 10-16% of
`.tsx`/`.jsx`, C# and C++ files differ because the packaged grammars are not the pinned pip versions). Synthetic 53k-line
repo: 4.65 s Python vs 0.3-0.5 s C# (export plus graph build; Python figure includes its SQLite save). Not yet measured in the
app, because the app still launches the Python bridge.

Suites after the merge (Windows): Core 190, Canvas 503 + 66, Shell 321, Bridge 534 (with `CODECHROMA_PYTHON`) and 520 + 1 skipped
(without), Python contract + distribution + theme tests 429, `ruff` clean (from a clean checkout; web/desktop vitest not re-run).

Swapped in (2026-10-18): the C# bridge now takes `--repo-path`/`--port` (`BridgeCli`), serves the same-origin canvas from a
`web/` folder next to its executable, and `dotnet publish dotnet/CodeChroma.Shell.App -p:BundleCSharpBridge=true` (after
`VITE_ENGINE_BRIDGE_URL=same-origin VITE_TERMINAL_BRIDGE_URL=same-origin npm --prefix web run build`) bundles it as
`bridge/codechroma-bridge/` (self-contained, installer 111 MB vs 85 MB). Locally installed on Windows: the bridge is
healthy 2.5 s after the app starts with `--repo` (the Python bridge took about 5 s) and `structure` answers in 0.25 s.
CI (`release-please.yml`) still bundles the Python bridge; switching it needs the web build step in the three publish jobs.

Still missing: patterns and impact resolved payloads, `impact-changes`, `{kind}/review`, `wiki-context`, wiki-general
generate/update, `GET /diagram-types` registries, PR happy path (gh), foreground-process status probing, skills packaged
next to the bridge. Unix PTY and everything on macOS/Linux is untested.

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

Phase 1 status: shell side built (WebView per tab, tab bar, launcher, recents, branch picker, new/tutorial project, title
with version, About, respawn) and booted on Windows; see 014 "Phase 1 shell". The exit gate (Playwright journeys inside
the shell, side-by-side install) is NOT met.

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
