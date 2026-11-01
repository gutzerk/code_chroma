# AGENTS.md

Shared rules for every coding agent (Claude Code, Codex, Kimi CLI, Gemini, ...). Claude Code imports this file from `CLAUDE.md`, so edit rules here, not there. Keep it short: Codex stops reading at 32 KiB combined and long files lower adherence.

## Project

CodeChroma builds a zoomable architecture hierarchy from a repo's code. Python engine in `src/codechroma/`, React canvas in `web/`, C# bridge/shell in `dotnet/`. Subsystem details live in `docs/architecture/*.md`; open the relevant one before a non-trivial change.

## Commands

- Python: `poetry install`, `poetry run pytest -n auto`, `poetry run ruff check .`
- Web (`web/`): `npm test`, `npm run lint`, `npm run build`
- C#: `dotnet test dotnet`

## Rules

- **Bridge features must land in C# too.** The desktop app ships only the C# bridge (`dotnet/CodeChroma.Bridge`); the Python bridge (`src/codechroma/bridge/`) is the reference. Never change one without porting to the other in the same change, with a shared case in `tests/fixtures/bridge_contract/*.cases.json`. Record any deliberate gap in `docs/planning/012-csharp-bridge.md` and state it in your final report. C#-only features (e.g. workflows) are the only exception.
- Keep docs in sync: update the affected `docs/architecture/*.md`, README or QUICKSTART in the same change.
- One-line comments and docstrings only.
- Tests use Arrange-Act-Assert: no setup statements after the final `assert`.
- Skills live in `skills/`; never edit `.claude/skills/` (generated).
- Use Conventional Commits (`feat:`, `fix:`, `BREAKING CHANGE:`); release-please parses them.
- Rules above are summaries; `CLAUDE.md` has the full wording (hook enforcement, skill sync, docs map).
- Skip `node_modules/`, `dist/`, `build/`, `.venv/` and other gitignored paths when searching.
