# 011 - Distribution: download, install, update, build pipeline

Status: In progress (installers + CI stream done on this branch; updater/builder stream and docs pass pending)

Independent of the C# migration plans: everything works with today's Electron + PyInstaller build.
Where a later shell replaces Electron, only the updater and `electron-builder.yml` items change.

## Decisions

1. Canonical repo slug is `gutzerk/code_chroma` everywhere (legacy `UshakovDV/code-chroma` removed).
2. Code signing: only hooks now (secret-gated CI steps); Apple Developer ID / Authenticode certs are a
   separate paid decision. Provenance is covered by `gh attestation verify` in the installers.
3. Update channel: `stable` only; the manifest carries `channel` so `beta` can be added later.

## Done in the installers + CI stream

- Tests first: `tests/unit/test_distribution_{installer,manifest,consistency,workflows,pester}.py`,
  `tests/pester/install.Tests.ps1`. Installer tests are parametrized over OS x arch x scope and cover
  checksum mismatch + one retry, oversize, manifest size mismatch, `--system`, unsupported platforms,
  same-version skip / `--force`, failed copy keeping the old app, running app, libfuse2, attestation
  (gh present / failing / absent), `--uninstall` / `--purge`, and the absence of `python3`.
- `distribution/install.sh`: no python; manifest parsed with `tr`/`awk`; downloads into a temp dir
  (stale `~/Downloads` copies from older installers are removed); atomic swap with rollback; skip when
  the same version is installed (state in `$XDG_STATE_HOME/codechroma/installed`); quits a running macOS
  app; libfuse2 warning; Linux `.desktop` entry + `~/.local/bin/codechroma` symlink; `gh attestation
  verify` (pinned to `release-please.yml`) when `gh` is installed and logged in, otherwise a clear
  "SHA-256 only" warning; `--uninstall [--purge]`; `--force`; `--help`.
- `distribution/install.ps1`: reads `latest.json`, uses the manifest's version-pinned URL (host must be
  the canonical releases path), enforces size cap + manifest size + SHA-256, same attestation policy,
  `-Silent`, `-Force`, `-Uninstall [-Purge]`; functions are dot-sourceable for Pester
  (`CODECROMA_PS_LIBRARY=1`). `install.cmd` forwards all arguments.
- `scripts/gen_distribution_manifest.py` is the only manifest generator (CI calls it with the sidecars
  and `gh release view --json assets`); new fields `channel`, `date`, `size`, `min_supported_version`
  (additive); every asset URL is pinned to the release tag, including the Windows installer.
- CI: `release-please.yml` has the non-main dispatch guard, a `gate` job (waits for green `ci.yml`),
  secret-gated signing hooks, a manifest job using the generator + attestation of `latest.json` and
  the sidecars + pinned `install.{sh,ps1,cmd}` release assets, and an `alert` job (opens an issue when
  a release is left as a draft). `ci.yml` gained shellcheck/actionlint and Windows Pester/PSScriptAnalyzer
  jobs; `packaging-smoke.yml` builds PyInstaller + electron-builder `--dir` on pull requests.
  `release-please-config.json` keeps both package-lock files' versions in sync.
- Legacy `scripts/install_desktop.{sh,ps1}` and `scripts/install_linux.sh` are now thin forwarders to
  `distribution/` (kept for one release because README/QUICKSTART still reference them).

## Left / depends on the desktop stream

- Versioned Windows asset name (`CodeChroma-<version>-x64-Setup.exe`): needs `win.artifactName` in
  `desktop/electron-builder.yml`. The updater already accepts the `-x64-Setup.exe` suffix, and
  `PLATFORMS` / the consistency test only need the glob changed. Until then the asset stays
  `CodeChroma-Setup.exe` (the manifest URL is still version-pinned via the tag).
- macOS signing/notarization: remove `identity: null` and add a notarize block in electron-builder.yml;
  Windows: `win.signtoolOptions`. The CI steps already forward `CSC_LINK`/`WIN_CSC_LINK` etc. when the
  `MAC_*` / `WIN_*` secrets exist.
- Linux `.desktop` icon (needs the AppImage icon extracted or shipped as a release asset).
- Updater items (periodic check, skip version, rollback for Windows/Linux, `.deb` message, host
  validation, ETag, shared constants module, About entry), the macOS swap-script test and the
  `updater*.test.ts` parametrization belong to the desktop stream.
- Delete the legacy forwarders after one release.
- Manual matrix on real machines (Gatekeeper, SmartScreen, `/D=` with spaces, FUSE) - not run.

## Doc changes needed (later docs pass)

`README.md` and `QUICKSTART.md` (lines ~29-32): replace the `bash scripts/install_*.sh` /
`install_desktop.ps1 -File` table rows with the `distribution/` one-liners
(`curl -fsSL https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh | sh`,
`irm .../install.ps1 | iex`, `install.cmd`) plus: update (re-run the installer, or in-app), uninstall
(`sh -s -- --uninstall [--purge]`, `-Uninstall -Purge` via script block), user-data locations
(macOS `~/Library/Application Support/CodeChroma`, `~/Library/Logs/CodeChroma`; Linux
`~/.config/CodeChroma`; Windows `%APPDATA%\CodeChroma`; all: `~/.codechroma`), and first-launch
warnings (Gatekeeper right-click Open / `xattr -dr com.apple.quarantine`, SmartScreen More info ->
Run anyway, Linux `chmod +x` / libfuse2). Mention `gh` for attestation verification.

`docs/architecture/desktop-app.md`:
- Fix line 60 (`irm https://codechroma.dev/install.ps1 | iex` -> the raw.githubusercontent URL) and
  the `<host>` placeholders (lines ~80, ~90).
- Replace the statement that `install_desktop.ps1` builds (line ~19-21) and the three legacy-script
  paragraphs (lines ~71-91) with: they are forwarders; `distribution/` is the path.
- Windows installer now reads `latest.json` (not "does not read latest.json", line ~65) and uses a
  version-pinned URL; line ~34 "stable names ... latest/download" is now only the asset name.
- Line ~142-144 ("shell installers verify only the sidecar ... future work"): they now run
  `gh attestation verify` when `gh` is available.
- Add the manifest schema (`version`, `channel`, `date`, `min_supported_version`, `assets`, `sha256`,
  `size`), the single generator (`scripts/gen_distribution_manifest.py --assets-json --sidecars`), the
  update/uninstall flow per OS, install-state file, `--force/--uninstall/--purge`, Pester/test hooks
  (`CODECROMA_MANIFEST_URL`, `CODECROMA_INSTALLER_URL`, `CODECROMA_MAX_BYTES`, `CODECROMA_GH_BIN`,
  `CODECROMA_PS_LIBRARY`, all marked as weakening security), the new release jobs (`gate`, `alert`,
  pinned installer assets, attested manifest), `packaging-smoke.yml`, lint jobs, signing hooks and the
  non-main dispatch guard, `vars.CODECROMA_MIN_SUPPORTED_VERSION`.

`CLAUDE.md`: the "Desktop app" paragraph's installer sentence (per-user, `--system`, Windows resolves
setup and checksum "directly from GitHub") - Windows now uses the manifest; add `--uninstall`.

Stale `.claude/plans/*` (release-versioning, desktop-inapp-update, install-update-hardening,
desktop-crossbuild): add a "superseded by 011" note or remove.
