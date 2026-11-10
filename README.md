
<h1 align="center">CodeChroma</h1>

<p align="center">
  <b>Stop reading code. Work with the processes it runs.</b><br>
  Investigate, plan, build and review through diagrams — AI agents handle the code.
</p>

<p align="center">
  <a href="#why"><b>Why</b></a>  ·  <a href="#install"><b>Install</b></a>  ·  <a href="#quick-start"><b>Quick start</b></a>  ·  <a href="#the-loop"><b>The loop</b></a>  ·  <a href="#see-it-in-action"><b>Screenshots</b></a>  ·  <a href="#docs"><b>Docs</b></a>  ·  <a href="CONTRIBUTING.md"><b>Contributing</b></a>
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

## Why

With AI agents, a team writes more code than it can read. A month in, no one can say how the product works.

Code visualizers don't fix this: they draw the code, and then you go back to reading files. CodeChroma changes the process instead. You look at the processes your system runs, decide on diagrams, and let agents write and change the code. Code is still one click away — you just rarely need it.

## Install

macOS (Apple Silicon or Intel) and Linux (x64):

```sh
curl -fsSL https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh | sh
```

Windows (x64), in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.ps1 | iex"
```

Or download the installer from the [latest release](https://github.com/gutzerk/code_chroma/releases/latest). No administrator access and no API key needed. Agents run on [Claude Code](https://claude.com/claude-code), so install it and sign in first. Updates, uninstall, first launch and running from source: [install details](#install-details).

## Quick start

1. **Open a repo.** Start CodeChroma and pick a local folder, or choose **Clone repository…** and paste a Git URL.
2. **Look at the map.** CodeChroma builds it from the code in seconds. Zoom from System down to a single function.
3. **Ask how something works.** Open an agent window and type `walk me through how checkout works`. You get a walkthrough drawn over the real code.
4. **Plan and build.** Ask `draw a plan for token auth`, answer the agent's questions on the canvas, then let it build the plan.
5. **Review.** Ask `show me what this PR affects` and check the change box by box.

See [`QUICKSTART.md`](./QUICKSTART.md) for the full walkthrough.

## The loop

| Step | What you do | What you see |
|---|---|---|
| **1. Investigate** | Ask `walk me through how checkout works` | A step-by-step walkthrough over the real functions it runs, not a file list |
| **2. Plan** | Ask `draw a plan for token auth` | Planned boxes for code that does not exist yet, next to the code they will touch. When the agent needs a decision, it asks you on the canvas with a small diagram per option |
| **3. Implement** | Launch agents from the canvas | Several Claude Code agents at once, each in its own git worktree, with their context, tokens and cost |
| **4. Review** | Ask `show me what this PR affects` or `review my diff` | Every box the change touched, with a before/after note — not a 2,000-line diff |

All of it sits on one map, built from the real code structure (System → … → Code), not the folder layout. The map updates live as files change.

## See it in action

### Review a change as a process, not a diff

![The Change impact view of a pull request: 24 changed files grouped into 13 boxes](docs/media/demo-impact.jpg)

A pull request with 24 changed files, shown as 13 boxes. The numbered boxes follow the order the code runs, so you read the change as a story: what starts, what it calls, where the data goes. Each box is marked new, modified or context, shows its added and removed lines, and says in one line what it does. Labelled arrows show how the parts talk to each other. On the right, the agent that drew the view explains what it checked.

### Keep every diagram on one map

![A sequence diagram, a design-patterns diagram and two walkthroughs on one canvas](docs/media/demo-canvas.jpg)

Four diagrams of the same code side by side: a sequence of how blocks are laid out, the design patterns behind it, and two step-by-step walkthroughs. Each one is drawn from the real code and linked to it. Use the Diagrams panel on the left to show, hide, delete or arrange them, or press **Draw** to ask for a new one.

### Run several agents at once

![Four Claude Code agents in the agents panel, with context, token and cost meters](docs/media/demo-agents.jpg)

Four Claude Code agents, each on its own task and in its own git worktree, so they never get in each other's way. For each agent you see how full its context is, the tokens it used, the cache hit rate and the cost so far. Your past prompts are listed on the left, so you can jump back to any answer. When an agent is done, open a pull request with **Create PR**.

## More you can ask

Type a request in an agent window or the canvas terminal. The answer is a diagram on the map, not a wall of text.

| You ask | What you see |
|---|---|
| `regenerate the system context diagram` | Your system, its users and outside services, rebuilt from the code |
| `confirm the detected patterns` | The design patterns CodeChroma found, checked by the agent |
| `highlight the auth check on this diagram` | The path of one process traced on a diagram you already have |

## Features

- **zoomable canvas** — the code hierarchy (System → … → Code) lives in a left Project tree, and every diagram (C1, patterns, epics, …) sits as a layer on the same canvas.
- **live sync** — edit a file and the map updates in place: new blocks appear, deleted ones fade out, no reload.
- **diagrams as layers** — C1, Design Patterns, Change Impact, Epics, Sequence, or a custom type — show, hide, or delete.
- **AI agents** — describe a diagram in plain language and a built-in agent draws it; run parallel Claude Code sessions, each in its own worktree.
- **PR workspaces** — paste a PR URL and browse its head as a read-only workspace.
- **desktop app** — a native (C# / Avalonia) double-click app and installer, no Python or Node needed.
- **works with or without a key** — analysis, canvas, and live sync run on a deterministic offline summarizer; set a key to unlock AI features.

## Install details

On Windows you can also run `distribution/install.cmd`. All platforms install per-user (macOS and Linux into `~/Applications`) and do not request administrator
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
