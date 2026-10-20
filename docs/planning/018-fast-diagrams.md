# 018 — Fast diagrams: semantic context tool + bare CLI runs

Status: In progress (tool, model hosting, bare runs and the process-diagram route done; see `docs/architecture/context-tool.md`)

## Problem

Drawing a process diagram sent an agent through 25–30 steps (~2 minutes, ~436k token-equivalents) of reading wiki pages, querying the graph and opening files.

## Goal

A local embedding model picks the relevant components and a tool prints a compact context; a CLI run with no ambient context draws from it with the skill text as its prompt. Prototype result: 22 s / 39k vs 126 s / 436k.

## Decisions

| Topic | Decision |
|---|---|
| Model hosting | GitHub release asset `models-v1`, downloaded on first use, SHA-256 pinned. Not LFS, not bundled. |
| Engine | C# bridge only. |
| Bare scope | All headless `SkillAgent` runs; terminal/parallel agents unchanged. |
| Reranker | Not enabled (lost end to end in the prototype). |

## Remaining

- Publish the release (`publish-model.yml`, manual) and verify first-run download on a clean machine.
- Raise recall: the 10-query Sonnet benchmark found 13 of 21 expected components (see `context-tool.md`); look at per-component file budgets and phrase-aware file choice.
- Verify codex / kimi-cli isolation flags against their real `--help` (neither CLI is installed on the dev machine, so `BareArgs` is still empty for them).
- Convert the other headless kinds to short inline skill bodies and measure each (they already run bare with the full skill text inlined).
- Measure Opus (not run: the owner asked not to use it).
