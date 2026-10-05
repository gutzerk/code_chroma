# Runtime executable environment

The bridge captures the user's environment once at startup, before repository analysis.
Each bridge process owns one `RuntimeEnvironment`; provider selection, Git/GitHub detection,
agent PTYs, headless agents, worker subprocesses, npm and process inspection reuse it.
Electron no longer runs a synchronous shell query. Capture happens on a dedicated worker;
refresh keeps the previous immutable generation usable while the worker runs.

## Capture and safety

On macOS/Linux shell selection uses the explicit runtime setting, an executable `SHELL`,
the passwd login shell, then `/bin/sh`. There are invocation adapters for POSIX shells,
fish, Nu, csh/tcsh, xonsh, and PowerShell. Windows normally uses the inherited environment;
an explicit PowerShell override enables profile capture there too.

The shell launches a small isolated Python helper, or the frozen bridge's `--printenv`
mode. The helper emits JSON between cryptographically random markers. Startup output is
spooled to a temporary file and the parser reads a bounded tail. Stderr is discarded.
A valid JSON environment is accepted after a nonzero exit (or after timeout cleanup).
Invalid/missing data falls back to the inherited environment and common directories.

The probe runs from HOME, with closed stdin, no controlling TTY and its own process
session/group. The default timeout is 10 seconds; timeout kills the complete group/tree.
`CODECHROMA_RESOLVING_ENVIRONMENT=1` is present for startup files to skip costly work.
Repository direnv/mise control variables are removed before the probe. No repository
working directory is used to discover global providers.

Captured variables override inherited variables. PATH uses captured entries first,
inherited entries second, with duplicates removed; empty/relative entries cannot cause
implicit executable lookup inside an open repository. Bundler/probe/settings internals
are stripped before child launches. Bridge URL and per-run workspace identity remain
available for the existing bundled skills. Diagnostics contain names, PATH entries,
sources, timestamps, duration, generation and safe error messages, never variable values.

## Executables and refresh

Resolution prefers an explicit executable path, then the snapshot PATH, then common
locations such as `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. It returns an
absolute launcher path without canonicalizing symlinks, together with the exact launch
environment and its generation. Fallback directories are also added to that launch PATH.
Aliases/functions are never launched; configure an executable wrapper instead.

Positive records are generation-scoped and revalidated for existence/executable access.
Negative records expire after 3 seconds. Missing CLI rechecks can trigger a background
recapture, limited to once per 30 seconds; Re-detect and settings changes explicitly
force refresh. ENOENT/EACCES invalidates records and requests capture. A failed launch
is not retried automatically, avoiding duplicate execution of side-effecting commands.
App focus re-scans previously unresolved names. Version verification is optional and
not performed automatically, so detection does not execute provider CLIs.

## Settings and APIs

Settings > CLI tools exposes the shell path, capture timeout, per-tool executable paths
and Re-detect. Machine settings are stored at `~/.codechroma/runtime-environment.json`.
`codechroma_RUNTIME_SETTINGS_FILE` overrides this location for tests/deployments.

- `GET/PUT /runtime/settings`: read/save shell, timeout and `cli_paths`.
- `GET /runtime/environment`: safe snapshot diagnostics.
- `GET /runtime/cli/{name}`: resolution provenance or failure reason.
- `POST /runtime/refresh`: explicit Re-detect.
- `POST /runtime/focus`: recheck unresolved executables after focus.

Example settings:

```json
{
  "shell": "/opt/homebrew/bin/fish",
  "timeout_seconds": 10,
  "cli_paths": {"claude": "/Users/me/.local/bin/claude", "gh": "/opt/homebrew/bin/gh"}
}
```

Existing assistant/provider selection and adapter flags stay unchanged. The skill/plugin
pipeline still uses its existing workspaces, prompts, model routing and plugin discovery;
only subprocess executable lookup and environment construction are centralized.
