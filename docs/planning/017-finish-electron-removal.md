# 017 - Finish the Electron removal

Status: **In progress**. Electron is deleted (plan row 11 done 2026-10-18: `desktop/`, Electron/PyInstaller CI steps, `packaging/bridge.spec`, `cryptoCompat.ts`, the install forwarders; the last Electron commit is the local tag `electron-last-build`; there were no Electron users, so `ElectronMigration`, the legacy update-asset handling and `install.ps1`'s Electron cleanup were also removed). Open: wiki-general port (row 4), the macOS/Linux/CI verification, and the soak row (the row 9 migration-release decision is moot, see below). Continues [016](016-remove-electron.md) (read its Phase 0-5 definitions and "Decisions taken"
first). 016's "Where we are" table is stale; the real state is below.

Goal: ship the C# app (Avalonia shell + bundled C# bridge) as the only desktop app, reach existing Electron users through
the updater, then delete `desktop/` and every Electron/PyInstaller step. Node stays for building `web/`, which the
WebView hosts. Replacing the React canvas and deleting the Python engine is **out of scope** (016 Phase 5).

## Where we are (verified 2026-10-18 against the tree, not the 016 table)

| Piece | State |
|---|---|
| Graph core + native analyzers (11 languages) | Done. Parity-tested against Python goldens; 10-16% of `.tsx/.jsx`, C#, C++ files differ (grammar versions). |
| C# bridge | Most route groups done: graph, canvas, recipes, diffs, agents, PRs, epics, PTY, skill/LLM runners, branches, traces, settings. Bundled into the shell via `-p:BundleCSharpBridge=true`. |
| Shell (tabs, launcher, recents, updater, Velopack packaging) | Code done, booted on Windows only. |
| CI | `dotnet-windows/macos/linux` release jobs exist, never run on real CI. |
| Last review pass | 131-commit review fixed ~40 defects (uncommitted at the time of writing); C# suites green on Windows. |

Not verified at all: macOS, Linux, Unix PTY, the Velopack install/uninstall hooks (`--skipVeloAppCheck` is passed while the
shell never calls `VelopackApp`), the shipped app running on the C# bridge end to end.

## Blockers, by kind

### A. Feature gap in the C# bridge (Electron + Python bridge has these, the C# bundle does not)

Decisions: all confirmed by the owner on 2026-10-18.

| # | Missing in C# | Python source | Decision | Notes |
|---|---|---|---|---|
| 1 | Design-pattern detection (patterns diagram, `patterns` resolved payload) | `patterns/detector.py` | **Ported 2026-10-18** (Python + Go shapes, resolver, `/patterns`, `/patterns/context`; parity-tested) | Prerequisite for row 2 |
| 2 | Impact resolved payload, `impact-changes`, `{kind}/review`, `patterns/impact/sequence` context | `bridge/impact*.py`, `review.py` | Port (confirmed) | Needs row 1 + change cards |
| 3 | Plain wiki generator, first-open bootstrap, `wiki-context` route | `wiki/`, `bridge/bootstrap_wiki.py`, `bridge/wiki_context.py` | **Port (confirmed)**, docstrings for Python, Go, TypeScript only | Input to wiki-general (row 4) and to the diagram-drawing skills, so not optional |
| 4 | wiki-general `generate`/`update` (C# returns 501) | `wiki_general_pipeline.py`, `_worker.py`, `_agent.py`, `_job_context.py`, `_naming.py`, `check_wiki_general.py` | **Port (confirmed), implemented** (commit 8e8a134: all nine routes and the pipeline); only the real-Claude verification run remains | Token economy: code does the orchestration and Claude only answers bounded zero-tool calls; the skill fallback has Claude Code plan everything and recursed on large repos (planning 058). Needs row 3 |
| 5 | AI summaries via Claude | `summarize/ai_summarizer.py` | Offline-only (confirmed) | CLAUDE.md: the live bridge never calls Claude |
| 6 | SQLite graph persistence | `graph/store.py` | In-memory (confirmed) | Check nothing reads `graph.db` |
| 7 | PR happy path (needs gh), PR `c1_source_root`, foreground-process probe (nested `vim`) | `bridge/prs/`, `terminal/` | Degrade and document (confirmed) | Known gaps in release notes |
| 8 | Execution tracing capture | `trace/` | No decision: stays Python (`sys.monitoring`) | C# only plays traces back; document |

Rule: nothing ships in the C# release that silently regresses vs Electron. Each row is either ported, or listed as a known
gap in the release notes with an owner decision recorded here.

### B. Unverified platforms and flows (the 016 exit gates)

- Phase 1 gate: `web/e2e` Playwright journeys passing inside the C# shell; Electron and C# shell installable side by side.
- Phase 2 gate: install, update from the previous release, rollback after a forced failure, uninstall on Windows, macOS
  (arm64 + x64), Linux (AppImage + deb).
- Velopack hook behaviour on a real install/uninstall.

### C. Migration and release

- Electron-to-C# migration release preserving userData (recent repos, workspace summaries, update settings, canvas state).
- Soak period, documented manual fallback, signing/SmartScreen/Gatekeeper decision (currently unsigned).

## Plan

Estimates are my rough engineering estimates in working days for one person; they are not from the repo and need the owner's
sanity check. "Windows-only" work can start now; macOS/Linux items need hardware or CI runners.

| # | Work | Exit check | Est. |
|---|---|---|---|
| 0 | Commit/land the pending review fixes; run the full Python and C# suites on a clean checkout (clear generated `tests/fixtures/*/.codechroma` first) | Both suites green from clean | 0.5 |
| 1 | Owner decisions on every row of table A (port / degrade / drop). All rows confirmed 2026-10-18 | Decisions recorded in this file | 0.5 |
| 2 | Port the agreed rows of table A: patterns + impact/review (3), plain wiki + `wiki-context` (3-5), wiki-general pipeline + Update (5-8) | Contract cases replayed on both backends (existing `tests/contract` runner); wiki-general checked with a real Claude run | 11-16 |
| 3 | **Code done 2026-10-18:** `VelopackApp.Build().Run()` in `Program.Main`, Velopack 1.2.161 package, `--skipVeloAppCheck` removed from `pack.ps1`/`pack.sh`; real install/uninstall still to verify. Call `VelopackApp` in `Program.Main` (or prove the hook is unnecessary on a real install) | Real install + uninstall on Windows, no ~30 s hang | 1 |
| 4 | Run the `web/e2e` journeys inside the C# shell on Windows; fix WebView2 differences | Phase 1 gate on Windows | 3-5 |
| 5 | Turn on the `dotnet-*` CI jobs on a throwaway tag/branch; fix what real runners expose | Artifacts + manifest + attestations produced for 4 targets | 3-4 |
| 6 | macOS (arm64/x64) pass: WKWebView rendering, xterm/WebGL, Unix PTY, install/update/rollback/uninstall, Gatekeeper behaviour | Phase 2 gate on macOS | 4-6 |
| 7 | Linux pass: WebKitGTK rendering, AppImage + deb, PTY, update/rollback | Phase 2 gate on Linux | 3-5 |
| 8 | ~~Side-by-side install test and Electron-to-C# migration test with a real userData folder~~ Moot: no Electron users exist, so there is nothing to migrate or coexist with | n/a | 0 |
| 9 | Migration release (Phase 3). **Closed 2026-10-18: moot.** The owner confirmed there are no existing Electron users, so no final Electron release and no manual-reinstall fallback is needed; the migration code (`ElectronMigration`, legacy update suffixes, `install.ps1`'s Electron uninstall) was removed | Decision recorded here | 0 |
| 10 | Soak (calendar time, not effort): no migration failures reported | Owner signs off | 2-4 weeks elapsed |
| 11 | **Done 2026-10-18** (done ahead of rows 5-10 on the owner's instruction; the unverified-platform and soak risks below remain open, with no Electron build left to fall back on except the tag). Delete Electron (Phase 4): `desktop/`, Electron/PyInstaller CI steps, `cryptoCompat.ts`, install forwarders, docs rewrite (README, QUICKSTART, CLAUDE.md, `desktop-app.md`, planning 011-017) | Clean checkout builds/tests/releases with no Electron step | 2-3 |

### How much is left

- **Effort:** roughly 36-56 working days with rows 1-4 ported (current decision; the row 2 figures are my rough guesses, not
  measured), or roughly 20-30 if they were degraded instead. Add the 2-4 week soak as elapsed time on top.
- **Shape of it:** about a third is Python-parity porting, about half is verification on macOS/Linux/CI (cannot be done
  from this Windows machine), the rest is migration, release and deletion.
- **Fastest honest path:** decide table A first (row 1), then do Windows-only items (0, 3, 4) while macOS/Linux
  hardware or runners are arranged.
- **What is NOT left:** the shell, updater logic, packaging scripts, installers and the bridge route/analyzer ports are
  already written. The remaining risk is mostly unverified behaviour on other OSes, not missing code.

## Risks specific to finishing

- The three OS WebViews are not Chromium; WebGL (xterm), CSS and DevTools behaviour differ and are untested off Windows.
- Checksum-only update verification is weaker than Sigstore; the UI and docs must keep flagging it
  (`UpdatesPanel.tsx` does not render the notice yet, per 016).
- Unsigned binaries: more SmartScreen/Gatekeeper friction; a signing decision is still open.

## Done when

016's "Done when" holds, plus: every table-A row is ported or recorded as a known gap, and the C# app has been installed,
updated, rolled back and uninstalled on Windows, macOS and Linux from a real CI build.
