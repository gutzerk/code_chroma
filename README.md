# CodeChroma

<p align="center">
  <a href="#install"><img src="https://img.shields.io/badge/license-MIT-666666?labelColor=333333" alt="MIT license" /></a>
  <a href="https://github.com/gutzerk/code-chroma/stargazers"><img src="https://img.shields.io/github/stars/gutzerk/code-chroma?labelColor=333333&color=666666&logo=github" alt="GitHub stars" /></a>
</p>

<video src="https://github.com/gutzerk/code_chroma/raw/main/docs/media/schema-diagram.mp4" controls muted width="100%"></video>

[Watch the demo](docs/media/schema-diagram.mp4)

**Navigate any codebase like a map, not a maze.**

- **zoomable canvas** — the code hierarchy (System → … → Code) lives in a left Project tree, and every diagram (C1, patterns, epics, …) sits as a layer on the same canvas.
- **live sync** — edit a file and the map updates in place: new blocks appear, deleted ones fade out, no reload.
- **diagrams as layers** — C1, Design Patterns, Change Impact, Epics, Sequence, or a custom type — show, hide, or delete.
- **AI agents** — describe a diagram in plain language and a built-in agent draws it; run parallel Claude Code sessions, each in its own worktree.
- **PR workspaces** — paste a PR URL and browse its head as a read-only workspace.
- **desktop app** — a double-click `.app`/installer, no Python or Node needed.
- **works with or without a key** — analysis, canvas, and live sync run on a deterministic offline summarizer; set a key to unlock AI features.

## install

Desktop app — one command:

| Platform | Command |
|---|---|
| macOS (Apple Silicon or Intel) | `bash scripts/install_desktop.sh` |
| Windows (x64) | `powershell -ExecutionPolicy Bypass -File scripts/install_desktop.ps1` |
| Linux (x64) | `bash scripts/install_linux.sh` |

macOS and Linux install per-user into `~/Applications` and do not request administrator access.
For a system-wide macOS app or Linux `.deb` package, explicitly pass `--system`; that writes to
shared system locations and requests administrator authorization.

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

## docs

- [QUICKSTART.md](./QUICKSTART.md) — install → launch → explore
- [docs/architecture/](./docs/architecture/) — one focused doc per subsystem (engine, diagrams, canvas, PR workspaces, parallel agents, desktop app)

## development

```bash
poetry install
poetry run pytest           # Python tests
poetry run ruff check .     # lint
cd web && npm install
npm test                    # Vitest
npm run e2e                 # Playwright
```

## contributing

File issues and feature ideas under `docs/planning/`. See [`CLAUDE.md`](./CLAUDE.md) for the architecture map and repo-wide conventions.

## license

CodeChroma is released under the [MIT License](LICENSE).
