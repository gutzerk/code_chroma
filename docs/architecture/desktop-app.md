# Desktop app (`desktop/`)

```bash
./scripts/dev/build_desktop.sh       # developer build: SPA -> frozen bridge -> desktop/dist/CodeChroma-*.dmg (macOS arm64)
./scripts/dev/build_desktop.sh --install  # build, then replace ~/Applications/CodeChroma.app (quit running app + index refresh)
npm --prefix desktop start          # run the shell against dist/codechroma-bridge (build the bridge first)
npm --prefix desktop start -- --repo /path/to/repo   # skip the launcher screen
npm --prefix desktop test           # vitest (recentRepos, shellPath, bridgeProcess)
poetry run python scripts/make_desktop_icon.py       # regenerate desktop/build/icon.png
./scripts/install_desktop.sh         # clean-macOS installer (see below)
./scripts/install_desktop.ps1        # clean-Windows installer (see below)
curl -fsSL https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh | sh   # end-user install (macOS arm64/x64 / Linux x64) from latest Release via manifest
python3 scripts/gen_distribution_manifest.py 9.9.9 --build-dir desktop/dist   # reproduce latest.json locally
```

`scripts/dev/build_desktop.sh` runs the three shared stages — SPA bundle → frozen Python bridge
(`packaging/bridge.spec`) → electron-builder (`electron-builder.yml`, mac `dmg` target). It is
macOS-only: the `--install` step (and the quit/index-refresh it triggers) shells out to Apple tools
(`hdiutil`, `osascript`, `killall Dock`, `mdimport`). The equivalent build stages for Windows run
inside `install_desktop.ps1` (npm → pyinstaller → electron-builder `win`/`nsis`), since there is no
bash on Windows.

**Releases run on GitHub, not locally.** `.github/workflows/release-please.yml` is the release path:
`release-please` bumps the version + writes CHANGELOG + tags `vX.Y.Z` and opens a Release on merge;
then four platform builds (macOS `macos-14` arm64 and `macos-15-intel` x64, Windows
`windows-latest` x64, and Linux x64) run the same three stages here and upload the installers to that
Release. The release-please action uses the `code_pat_release` repository secret so its Release PR
triggers the follow-on release workflow when merged; configure that secret in repository settings
with repository Contents and Pull requests write access. The macOS matrix passes one architecture
per job and `electron-builder.yml` gives both DMGs explicit architecture names
(`CodeChroma-<version>-arm64.dmg` / `CodeChroma-<version>-x64.dmg`) for the checksum and manifest
steps. Windows uses the stable asset names `CodeChroma-Setup.exe` and
`CodeChroma-Setup.exe.sha256`; its installer downloads them from GitHub's
`releases/latest/download/` endpoint without reading release metadata. If a release exists but its
builds or manifest failed, dispatch the Release workflow on
`main` with `release_tag` (for example `v0.3.0`) to rebuild and publish assets for that release;
ordinary pushes only build when release-please creates a release. New releases stay drafts during
asset generation, so `/releases/latest/` continues resolving to the previous published release.
The final manifest-upload step publishes the new release only after all platform builds succeed; a
failed or in-progress build leaves the previous release as latest. A recovery dispatch first returns
its existing release to draft.
The author version lives in `desktop/package.json` (electron-builder reads it for the artifact name);
`release-please-config.json` syncs `web/package.json` and `pyproject.toml` from it. See the plan in
`.claude/plans/release-versioning.md` for the design.
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
- Windows x64: `irm https://codechroma.dev/install.ps1 | iex` (or
  `distribution/install.cmd` → `distribution/install.ps1`) — downloads the stable
  `CodeChroma-Setup.exe` and `.sha256` from GitHub's latest-release endpoint, verifies SHA-256, then
  runs the NSIS wizard defaulted to the current user (`perMachine: false`,
  `selectPerMachineByDefault: false`) with automatic elevation disabled
  (`allowElevation: false`); it does not read `latest.json`.
The manifest is served from each Release (`.../releases/latest/download/latest.json`), so no custom
domain is required; `CODECROMA_MANIFEST_URL` overrides the shell installer source. The release
workflow keeps newly created releases in draft until every platform build and manifest upload succeeds,
so a failed build cannot replace the previous working latest release. `scripts/gen_distribution_manifest.py`
reproduces the same manifest locally (e.g. for smoke-testing `install.sh` against a non-release build).
The root `scripts/install_*.sh/.ps1` are legacy direct-release downloaders; they are not
build-from-source installers. `distribution/` is the recommended manifest-based download path.

`./scripts/install_desktop.sh` is a **one-command installer for a clean Mac with no local checkout**:
it detects Apple Silicon or Intel, downloads that architecture's latest DMG and checksum, verifies
the download, then copies the app into `~/Applications` by default without `sudo`. Pass `--system`
to opt into replacing `/Applications/CodeChroma.app`; it explains the shared destination before
requesting administrator authorization. It needs `curl`, `python3`, and `hdiutil`, but does not build
the app. Run with
`curl -fsSL https://<host>/install_desktop.sh | bash` (or `bash scripts/install_desktop.sh`).

`./scripts/install_linux.sh` installs the verified Linux AppImage into `~/Applications` by default.
Pass `--system` to install the `.deb` through apt; that operation modifies system package locations
and requests administrator authorization after an explanation. For the manifest installer, pass
`--system` as `sh -s -- --system` after the curl pipe.

`./scripts/install_desktop.ps1` is the Windows x64 installer: it resolves the latest `Setup.exe`,
verifies its published checksum, and launches the interactive NSIS installer. It downloads the
prebuilt release and does not clone or build the repository. Run with
`curl -fsSL https://<host>/install_desktop.ps1 | powershell -ExecutionPolicy Bypass -` (or
`powershell -ExecutionPolicy Bypass -File scripts/install_desktop.ps1`).

**Updates are checked in-app and installed from GitHub, not in place.** On startup the main
process (`desktop/src/updater.ts`) queries the latest GitHub Release against `app.getVersion()`; if a
newer version exists it raises a native Notification ("Update to vX.Y.Z available") plus a
File → "Check for Updates…" menu item. The startup check only runs for packaged installs
(`app.isPackaged`) so a dev run never hits the API. Clicking either opens a confirm dialog, then
downloads the correct per-platform artifact and runs it: on macOS `hdiutil -plist` mounts the `.dmg`
(the mount point is parsed from XML, so space-y volume names can't break the path) and `ditto` copies
the new `.app` over the running app bundle with the current user's permissions (it never prompts
for elevation; system-wide installs must be moved to `~/Applications` before in-app updates); on
Windows it launches the `-Setup.exe` (per-user NSIS shows the overwrite prompt without UAC); on Linux it
atomically replaces the running AppImage in place. The download streams to a `.part` sibling while
hashing SHA-256 in one pass (aborting and discarding anything past 1 GiB), is verified against the
release's published `.sha256` sidecar, then **provenance-checked** before it's renamed into place:
`desktop/src/attestation.ts` fetches the artifact's signed attestation from GitHub
(`/repos/UshakovDV/code-chroma/attestations/sha256:<hex>`) and verifies it with `sigstore-js`,
pinning the OIDC issuer and workflow identity of `release-please.yml` — so the signed attestation,
not the release's own sidecar, is the authority binding the artifact to this repo's release pipeline.
`desktop/package.json` pins Sigstore to v4: Electron 33 embeds Node 20, while Sigstore v5 requires
Node 22.22.2+, 24.15+, or 26+ and is incompatible with the packaged desktop runtime.
A release that publishes no attestation refuses to update (it would be an unverified install), and
one whose installer has no reachable `sha256` digest surfaces the update but asks the user to install
manually instead of silently pretending to be current. Asset names are sanitized to
`[A-Za-z0-9._-]` before they become local paths (`safeAssetPath` in the updater, `safe_name` in the
shell installers). The AppImage replacement renames a PID-suffixed temp sibling over the running
file. After install the app either
relaunches (`app.relaunch()`, macOS/Linux) or lets the installer take over (Windows). It connects to
`api.github.com/repos/UshakovDV/code-chroma/releases/latest` using Node's built-in `fetch` — no
runtime dependency. The one-command installers (`install_desktop.sh`, `install_linux.sh`,
`install_desktop.ps1`) reuse the same model: fetch the sidecar first, verify before mounting or
launching, and redownload once if a stale cached copy fails its checksum — only a second
mismatch is treated as tampering.
⚠ On **unsigned macOS**, Gatekeeper shows the standard "unverified publisher"
warning for the freshly copied `.app`; the update still works, it just can't be silent/delta (that
is the trade-off for not having a paid Developer ID). Release workflow actions are pinned to commit
SHAs (kept current by Dependabot). The release pipeline attests every installer with
`actions/attest-build-provenance` (short-lived OIDC identity, Sigstore/SLSA provenance), and the
in-app updater verifies that signed attestation (see above) — so the in-app path is protected
against a compromised release pipeline, not just corruption. ⚠ **The one-command shell installers**
(`install_*.sh`/`.ps1`) still verify only the same-release `.sha256` sidecar, so they guard against
corruption but not against a compromised pipeline; extending them to `gh attestation verify` is
future work. The in-app check is advisory: it never downloads or installs without user consent.

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
  shares its repo tab's bridge and titles `#<number>` — it never spawns a second bridge, and closing
  it leaves the repo tab (and its bridge) running. PR tabs are `ownsBridge: false`, so
  `closeTab`'s bridge-stop only ever hits the tab that actually started the process.
- **`bridge/resources.py` is the only module that knows about freezing.**
  `resource_path("skills"|"web"|"detect")` resolves to `_MEIPASS/codechroma_data/...` when frozen, else
  the source tree. Anything new that reads a repo data file at runtime must go through it, and be
  listed in `packaging/bridge.spec`, or it will work in dev and 404 in the app.
- 🔴 **`desktop/src/shellPath.ts` is load-bearing.** A desktop launch can inherit an incomplete
  PATH, so the CLI and git may be invisible. It asks the host shell for its real PATH once at
  startup, using the host path separator; every spawned child inherits the fix.
- `desktop/launcher/` is deliberately plain HTML/JS outside the tsc build: it renders *before* any
  bridge exists, so it cannot be part of the served SPA. Its typed contract is `preload.ts`'s
  `LauncherApi`. Recents live in `app.getPath('userData')/recent.json`.
- `desktop/build/icon.png` is generated by `scripts/make_desktop_icon.py` (pure-stdlib PNG writer) and
  committed; `.gitignore` un-ignores it against the global `build/` rule.
- Tests: `tests/unit/test_resources.py`, `tests/unit/test_bridge_spa_mount.py`,
  `web/src/engine-client/sameOrigin.test.ts`, and the Vitest suites in `desktop/src/*.test.ts`.
