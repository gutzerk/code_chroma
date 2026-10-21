# Contributing to CodeChroma

What CodeChroma does and how to install it are in the [README](README.md).
This is how to work on it. [CLAUDE.md](CLAUDE.md) is the command reference and
architecture map.

## Before you start

- Discuss non-trivial changes with a maintainer and settle the scope before
  implementing them. Record feature decisions in `docs/planning/`, the local
  issue tracker; small fixes can go straight to a PR.
- Read the affected subsystem's document in [docs/architecture/](docs/architecture/)
  before changing it. Follow its entry points, callers and tests before searching
  the whole repository.
- If an assumption about an API or the architecture is wrong, correct the
  relevant documentation and explain the finding in the PR.
- Report security vulnerabilities privately to a maintainer. Do not put secrets,
  exploit details or private repository contents in public issues or PRs.

## Getting set up

Use Python 3.14 with Poetry, Node.js 22 with npm, and the .NET 8 SDK for C# work.
These match the versions used by [CI](.github/workflows/ci.yml).

```bash
git clone https://github.com/gutzerk/code_chroma.git
cd code_chroma
git switch stage
git switch -c docs/your-change
poetry install
npm --prefix web ci
```

Run the Python bridge and live web canvas against a repository:

```bash
poetry run python -m codechroma.bridge.launch --repo-path /path/to/repo
```

For UI-only work, `npm --prefix web run dev` uses the mock bridge by default.
The Python engine works offline without an API key; configure credentials only
when testing AI features. Never commit credentials or local settings.

The launcher watches the repository you point it at. Use a disposable checkout
when testing terminal commands, agents or workflows that can change files or git
state, and stop the launcher with Ctrl-C when finished.

See [QUICKSTART.md](QUICKSTART.md) for the walkthrough and
[desktop-app.md](docs/architecture/desktop-app.md) for the native shell's build
and run requirements.

## Working on a change

- Branch from `stage` and target `stage` in your PR.
- Write comments, documentation, test names, logs, error messages and commit
  messages in English.
- Follow [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<scope>): <subject>`. Use `feat`, `fix`, `docs`, `test`,
  `refactor`, `perf` or `chore`; the optional scope names an area such as
  `engine`, `bridge`, `canvas`, `shell` or `deps`. Keep the subject
  imperative, lowercase, without a trailing period, and at most 72 characters
  for the whole header. Explain why in the body. Keep one logical change per
  commit and do not add co-author trailers.
- Add tests with the behavior they cover. Use Arrange-Act-Assert, with no setup
  assignments after the final assertion. Parameterize repeated test shapes
  when it makes them clearer.
- Keep code comments and class/function docstrings to one line, as required by
  the repository's style hook. Explain surprising decisions; put longer
  explanations in the appropriate architecture document.
- Keep the core deterministic, load expensive data lazily, and extend through
  the existing ports. Preserve offline operation when changing AI integration.
- Keep Python and C# graph behavior aligned where parity is required. After
  changing builder, digest or clustering output, regenerate the parity fixtures
  with `poetry run python -m tests.graph_golden`, inspect the changes, and run
  the corresponding C# tests.
- Update affected user and architecture documentation in the same change.
  `docs/planning/` records decisions and staged plans; `specs/<NNN>-<slug>/`
  formalizes them. Keep their feature numbers aligned when both exist.
- Confirm external API behavior before relying on it. Record discoveries in the
  relevant architecture document instead of silently adding a workaround.
- Keep unrelated refactors, dependency updates and formatting sweeps separate.

## Checks before a PR

Run the checks for the areas you change. From the repository root:

```bash
poetry run ruff check .
poetry run pytest -n auto -q
poetry run mypy src/codechroma
```

Mypy is currently advisory in CI. The Python suite includes real subprocess,
PTY and timer tests; parallel execution is preferred for a full run.

For the web canvas:

```bash
npm --prefix web run lint
npm --prefix web run build
npm --prefix web test
```

For browser interaction changes, also install Playwright's browsers with
`cd web && npx playwright install` and run `npm run e2e` from `web/`.

For the affected C# solutions:

```bash
dotnet test dotnet/CodeChroma.sln --configuration Release
dotnet test dotnet/CodeChroma.Bridge.sln --configuration Release
dotnet test dotnet/CodeChroma.Canvas.sln --configuration Release
dotnet test dotnet/CodeChroma.Shell.sln --configuration Release
```

CI also checks installers and workflow syntax, runs the PowerShell installer
tests on Windows, and tests the C# shell on Linux, Windows and macOS. Changes
to distribution or release plumbing need the corresponding checks in
[ci.yml](.github/workflows/ci.yml).

## Pull requests

- Keep each PR to one thing and target `stage`.
- Describe the problem, resulting behavior and validation. Link the planning
  document when there is one; include screenshots for visible UI changes.
- Make the relevant checks green locally and let CI complete. State checks you
  could not run and any known limitations.
- Address review feedback before merging and use a conventional PR title.
- Versions, release tags and `CHANGELOG.md` belong to release-please.
  Do not bump versions by hand in the shell project, `web/package.json` or
  `pyproject.toml`. Releases are built through GitHub from `main`; see the
  [desktop release documentation](docs/architecture/desktop-app.md).

## Code of conduct

Be kind, assume good faith, and keep feedback about the work.

## License

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).
