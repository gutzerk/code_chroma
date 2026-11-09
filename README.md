
<h1 align="center">CodeChroma</h1>

<p align="center">
  <b>See what your AI agent changed — on a map of your architecture.</b><br>
  Agents write code fast. CodeChroma makes sure you still understand it.
</p>

<p align="center">
  <a href="https://github.com/gutzerk/code_chroma/releases/latest"><img src="https://img.shields.io/github/v/release/gutzerk/code_chroma?label=Download%20for%20Mac&logo=apple&color=0a84ff&style=for-the-badge" alt="Download CodeChroma for Mac"></a>
  <a href="https://github.com/gutzerk/code_chroma/releases/latest"><img src="https://img.shields.io/github/v/release/gutzerk/code_chroma?label=Download%20for%20Windows&color=4f9de0&style=for-the-badge" alt="Download CodeChroma for Windows"></a>
  <a href="https://github.com/gutzerk/code_chroma/releases/latest"><img src="https://img.shields.io/github/v/release/gutzerk/code_chroma?label=Download%20for%20Linux&logo=linux&logoColor=white&color=e8a33d&style=for-the-badge" alt="Download CodeChroma for Linux"></a>
</p>
<p align="center">
  <sub>macOS (Apple Silicon or Intel) · Windows 10+ x64 · Linux x64 AppImage · updates itself · no API key needed</sub>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-666666?labelColor=333333" alt="MIT license" /></a>
  <a href="https://github.com/gutzerk/code_chroma/stargazers"><img src="https://img.shields.io/github/stars/gutzerk/code_chroma?labelColor=333333&color=666666&logo=github" alt="GitHub stars" /></a>
</p>

Or install with one command (macOS / Linux):

```sh
curl -fsSL https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh | sh
```

Windows and other options: [install](#install).

## See it in action

![A sequence diagram, a design-patterns diagram and a walkthrough on one canvas](docs/media/demo-canvas.jpg)

*Several diagrams on one canvas — a sequence, design patterns and a walkthrough, each drawn from the real code.*

![Four Claude Code agents in the agents panel, with context, token and cost meters](docs/media/demo-agents.jpg)

*Run several Claude Code agents side by side and see each one's context, tokens and cost.*

![The Change impact view of a pull request: 24 changed files grouped into 13 boxes](docs/media/demo-impact.jpg)

*Review a pull request on the map: every changed box shows its added and removed lines and what it touches.*

## You ask → you see

Type a request in an agent window or the canvas terminal. The answer is a diagram on the map, not a wall of text.

| You ask | What you see |
|---|---|
| `show me what this PR affects` | The Change Impact view: every box the change touches, linked to the code |
| `walk me through how checkout works` | A step-by-step walkthrough over the real functions it runs |
| `review my diff` | Each touched box gets a before/after note from the agent |
| `regenerate the system context diagram` | Your system, its users and outside services, rebuilt from the code |
| `draw a plan for token auth` | Planned boxes for code that does not exist yet, next to the code it will touch |
| `confirm the detected patterns` | The design patterns CodeChroma found, checked by the agent |

## How it works

1. **Open a repo** — a local folder or a GitHub URL. No API key needed.
2. **See its architecture** — CodeChroma builds a zoomable map (System → … → Code) from the real code structure, not the folder layout.
3. **Launch an AI agent** — start Claude Code sessions from the canvas, each in its own git worktree.
4. **Understand the changes** — the Change Impact view shows which boxes the agent touched, and the map updates live as files change.

## Features

- **zoomable canvas** — the code hierarchy (System → … → Code) lives in a left Project tree, and every diagram (C1, patterns, epics, …) sits as a layer on the same canvas.
- **live sync** — edit a file and the map updates in place: new blocks appear, deleted ones fade out, no reload.
- **diagrams as layers** — C1, Design Patterns, Change Impact, Epics, Sequence, or a custom type — show, hide, or delete.
- **AI agents** — describe a diagram in plain language and a built-in agent draws it; run parallel Claude Code sessions, each in its own worktree.
- **PR workspaces** — paste a PR URL and browse its head as a read-only workspace.
- **desktop app** — a native (C# / Avalonia) double-click app and installer, no Python or Node needed.
- **works with or without a key** — analysis, canvas, and live sync run on a deterministic offline summarizer; set a key to unlock AI features.

## Install

Desktop app — one command:

| Platform | Command |
|---|---|
| macOS (Apple Silicon or Intel) / Linux (x64) | `curl -fsSL https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh \| sh` |
| Windows (x64) | `powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.ps1 \| iex"` (or run `distribution/install.cmd`) |

All platforms install per-user (macOS and Linux into `~/Applications`) and do not request administrator
access. The installers check the SHA-256 from the release's `latest.json`, and also run
`gh attestation verify` when the GitHub CLI is installed and logged in (otherwise they warn that only
the checksum was checked).
Re-running the command installs a newer version and skips the same one (`--force` / `-Force` to
reinstall).

**Update:** the app checks for a new release at start-up, every 6 hours and when its window regains
focus; open **Updates** to download, skip a version or turn on automatic download. In-app updates are
verified by SHA-256 checksum only (not signed or attested) and roll back automatically if the new
version fails to start. **Uninstall:**
re-run the installer with `--uninstall` (`-Uninstall` on Windows); add `--purge` / `-Purge` to also
delete settings and caches.

**First launch:** release builds are not yet code-signed. On macOS a browser-downloaded app may need
right-click → Open (or `xattr -dr com.apple.quarantine ~/Applications/CodeChroma.app`); on Windows
SmartScreen may show "More info → Run anyway"; the Linux AppImage needs FUSE (`libfuse2`).

From source — point it at any repo:

```bash
poetry install
cd web && npm install && cd ..
poetry run python -m codechroma.bridge.launch --repo-path /path/to/your/repo
```

Or open a GitHub project without cloning it yourself — `--github` takes a URL or `owner/repo[@ref]`:

```bash
poetry run python -m codechroma.bridge.launch --github owner/repo
```

Open the URL it prints (usually `http://localhost:5173`) and start clicking. See [`QUICKSTART.md`](./QUICKSTART.md) for the full walkthrough, [`web/QUICKSTART.md`](./web/QUICKSTART.md) to explore the UI offline, and [`CLAUDE.md`](./CLAUDE.md) for the command reference and documentation map.

## Docs

- [QUICKSTART.md](./QUICKSTART.md) — install → launch → explore
- [docs/architecture/](./docs/architecture/) — one focused doc per subsystem (engine, diagrams, canvas, PR workspaces, parallel agents, desktop app)

## Development

```bash
poetry install
poetry run pytest           # Python tests
poetry run ruff check .     # lint
cd web && npm install
npm test                    # Vitest
npm run e2e                 # Playwright
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, contributor rules, checks and the PR workflow.
File issues and feature ideas under `docs/planning/`. See [`CLAUDE.md`](./CLAUDE.md) for the architecture map and repo-wide conventions.

## License

CodeChroma is released under the [MIT License](LICENSE).
