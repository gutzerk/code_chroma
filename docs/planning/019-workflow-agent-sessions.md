# 019 — Workflow agent sessions: per-step agent, input, provider/model

Status: In progress (Stages 0-3 done on `feat/workflow-agent-sessions`, branched from `stage`)

Design: the "Agents & Workflows Panel Redesign" canvas, https://claude.ai/artifact/UpBEzW3ptZkPhw1dqXQFDR (boards 2, 3, 6, 7, 7b, 8, 9, 10, 11). C# bridge only, like the rest of workflows (`docs/architecture/workflows.md`).

## Problem

A workflow step can only start a fresh agent, with or without the previous step's output tail (`context: previous|fresh`). It cannot keep talking to an earlier step's agent, so a later step has to re-read everything that agent already knew. Every step uses the one `workflow-step` call-site CLI and model. Run inputs are edited away from the steps that use them. A send back re-runs a step on top of the rejected code. The panel has too many buttons for the workflow list.

## Decisions

| Topic | Decision |
|---|---|
| Per-step `agent` | `new` (default for new steps), `handoff` (new + the previous step's output tail and diff stat: today's `previous`), `continue` (the nearest earlier agent step), `continue:<stepId>`. Replaces `context`. |
| Old files | `context: previous` (or no `context`) reads as `handoff`, `fresh` reads as `new`; saving writes `agent` and drops `context`. |
| Step input | Optional `extraPrompt` text (UI label "Step input"), appended after the instructions for that step only; `{{name}}` run inputs are filled in it too. On `stage` the run inputs already live on steps (`input: {name,label}`), so the field is not called `input`. |
| Provider and model | Optional per-step `provider` (an LLM settings provider id) and `model`. Both empty means the `workflow-step` call-site assignment, as today. |
| Continue never falls back | Save rejects (400) a continue whose source is not an earlier agent step, is a review step, or is on another provider, or whose step or source is not on a claude adapter. At run time a continue whose source has no session id, or whose CLI no longer resolves to claude, stops the run with `✗ cannot continue <slug>: ...`. Never a silent fresh agent. |
| Resume | claude only. A continue runs `--resume <sourceSession> --fork-session`, so the source session stays as it was (redo and a second continue from the same source both still see the clean session). Verify `--fork-session` against the installed `claude --help` before Stage 1 lands. |
| Model change | Allowed. The editor warns that switching model on a continue drops the prompt cache and re-reads the session at full price (board 7b). Not a save error. |
| Token growth | Each finished step records its context size from the CLI transcript. Run detail shows "Continuing an N-step session" on continue steps and turns it amber past a threshold (3 steps or 60% of the model's window, both in config). |
| Redo and send back | Redo or send back of step N resets the code to step N's checkpoint and reruns it by resuming (forked) the session of the nearest earlier agent step with a session, which hasn't seen the rejected work; the reviewer note goes in the prompt. No such session, or not claude: a fresh agent in step N's own mode. Send back now resets code too (board 7 copy). |
| Talking to an agent | No Message button on steps (boards 3, 8). "Open agent" on a finished step opens an Agents-tab terminal agent in the run worktree with `claude --resume <stepSession> --fork-session`. `POST /runs/{id}/message` stays for the run agent and its MCP tools. |
| Workflow list | Saved workflows list leaves the Workflows tab (board 2) for an All workflows screen (board 11). Top bar at 760px and full screen is Run workflow + All workflows icon + full screen/collapse; New workflow lives on the All workflows screen only. |
| Parallel steps | Out of scope. |

## Stages

### Stage 0 — Contract and migration

- Done. `Workflows/Models.cs`: `WorkflowStep` gains `Agent`, `ExtraPrompt`, `Provider`, `Model` plus `StepAgents` (modes, `Normalize`, `SourceIndex`, `ChainLength`); `Context` is read for old files only. `StepRecord` gains `Usage { contextTokens, inputTokens, outputTokens, cacheReadTokens }` and `ResumedFrom` (the step id whose session it forked).
- `RunStore.GetWorkflow`: map `context` to `agent` on load (`previous`/missing to `handoff`, `fresh` to `new`), so runs already loaded and old definitions behave as before.
- `Routes/WorkflowRoutes.cs` `ReadDefinition`: validate `agent` values; `continue[:id]` resolves to an earlier agent step (first agent step cannot continue); `provider` exists in `ProviderStore`; continue step and source resolve to the same provider and both to a claude adapter. Messages match board 7b wording. The validator now needs `ProviderStore`/`CliResolver`, so pass them in rather than keeping it static.
- `web/src/workflows/types.ts`: same fields; `agent` union type `"new" | "handoff" | "continue" | \`continue:${string}\``.
- Tests: `RunStoreTests` load-migration cases; `WorkflowValidationTests` (pure `WorkflowValidation.Validate`) for each 400 (continue from first step, from a review step, across providers, non-claude provider, unknown provider).

### Stage 1 — Runner

- Done. `--fork-session` checked against the installed `claude --help` ("When resuming, create a new session ID ... use with --resume or --continue"). The continue check runs before the checkpoint and the launch (`WorkflowRunner.PlanLaunch`); a model-only override goes through `CliResolver.WithModel`.
- `SkillAgent`: `RunOptions` gains `Cli` (a `CliResolution` override); `Start` uses it instead of `resolver.Resolve(Spec.Name, Spec.Model)` when set. `CliResolver.ResolveProvider(providerId, model)` builds the resolution from one provider, reusing `EnvOverrides`.
- `WorkflowRunner.RunAgentStep`: resolve the step's CLI once (step override or call-site default) and use that resolution for `IsClaude`, not the runner-wide agent. Prompt = skill line + instructions + `\n\n` + filled `extraPrompt`. `handoff` keeps `WithContext`; `new` skips it; `continue` resolves the source record, fails the run when its `SessionId` is null or the CLI is not claude, else passes `--resume <id> --fork-session` and sets `ResumedFrom`.
- Reruns (`ResumeFrom` after Stop) keep resuming the step's own session as today.
- Tests (FakeCli `runs[]`, injected session finder): argv per mode; input appended and filled; per-step provider reaches argv/env; continue with no source session stops the run with the error and starts no process; continue across a skipped source stops; a provider changed to non-claude after save stops at run time.

### Stage 2 — Usage and chain length

- Done. Thresholds and the window table are constants in `Workflows/WorkflowLimits.cs` (the C# bridge has no config file to put them in). The run DTO carries per step `chainLength` and a server-computed `chainWarning`, and `usage` gains `model` and `contextWindow`, so the web needs neither the walk nor the thresholds.
- `Agents/Transcripts.cs`: `ReadUsage(sessionId, worktree)` reads the last assistant entry's `usage` in the claude JSONL transcript (input + cache read + cache creation = context size). Injectable like `sessionFinder`.
- Runner writes `StepRecord.Usage` in `Snapshot`. Chain length is computed from the definition (follow continue links), exposed on the run DTO per step so the web does not repeat the walk.
- `config`: `workflowChainWarnSteps` (3), `workflowContextWarnRatio` (0.6), and a model to context-window table (default 200k).
- Tests: transcript fixture parsing, missing transcript yields null usage, chain length for new/handoff/continue chains.

### Stage 3 — Redo and send back

- Done (runner only). `Review` is now async (the route uses `MutateAsync`) because send back awaits the parked loop and does the redo git work. A continue step being redone forks its own source rather than the nearest earlier session, which is what its own mode would do anyway; the source must be on the same provider. The web `RedoCard` keeps/reruns/setsAside copy for send back is not changed here (web stages).
- `WorkflowRunner.Steer.cs` `Redo` and `WorkflowRunner.Review` (sendBack) share one "rerun from" path: keep the attempt branch, reset to the step's checkpoint, pick the nearest earlier agent step with a session on a claude CLI, resume it forked with the note plus step N's instructions; else fresh agent in step N's mode.
- Send back now creates an attempt and resets code like redo (it currently reruns on top of the rejected work); update `RedoCard` keeps/reruns/setsAside text accordingly.
- Tests: redo resumes step N-1's session (argv), redo with no earlier session starts fresh, send back resets the worktree to the checkpoint, the source session is never resumed without `--fork-session`.

### Stage 4 — Editor (boards 6, 7, 7b)

- `WorkflowEditorDialog.tsx`: remove run inputs from the left panel; step pane order = Who does it, Agent cards (New / New + hand-off / Continue with a source select listing earlier agent steps), Provider + Model selects (from `GET /llm/providers` and `/llm/providers/{id}/models`), Instructions, Inputs strip (`{{name}}` chips, + Input, "You fill these in when the run starts"), Step input textarea, Skill, Pause before. Step 1 forces `new` (today it forces `fresh`).
- Rail labels "Agent · <provider> · <mode>", connectors "hand-off → step N" and teal "resumes step N's agent".
- Inline validation mirrors the server (board 7b): Continue disabled with a reason when the provider is not claude; errors for provider mismatch, review/no earlier agent source; amber warning when the model differs from the source.
- Review step Send back select gets the board 7 explanation line.
- Tests: `WorkflowEditorDialog.test.tsx` mode switching, source select only lists earlier agent steps, each 7b state, old definitions open as hand-off, step input round-trips.

### Stage 5 — Run views (boards 3, 8, 9)

- Done (web + agent launch route). `runControls.ts`: `stepModeLabel`, `chainLength`, `sessionBadge` (thresholds `CHAIN_WARN_STEPS` 3, `CONTEXT_WARN_RATIO` 0.6 of `CONTEXT_WINDOW_TOKENS` 200k), `resumesChip`, `canOpenAgent`, `betweenLabel(steps, index)` with hand-off vs resume. `StepRecord.chainLength` (optional) is read when the runner sends it, else computed. The run views had no step Message button left in code; board 9's "Message the step agent…" box was design-only, so the open question is settled as removed; `RunChat` (and its `@step` routing) is unchanged. Open agent: `POST /agents {kind:"claude", run_id, fork_session}` + start runs `claude --resume <id> --fork-session` in the run worktree (`AgentManager.CreateInRun`, `TerminalAgents.Resolve(forkSession)`).

- `StepRail.tsx` / `RunDetail.tsx`: mode labels, "Continuing a N-step session" badge (amber past the thresholds), "Resumes step N's agent session" chip; `runControls.betweenLabel` describes hand-off vs resume.
- Remove the step Message button; add "Open agent" on finished steps with a session (calls the parallel-agents launch with resume args; new bridge param on the agent launch route, claude only).
- Tests: `StepRail.test.tsx` labels and badge thresholds; Open agent hidden without a session.

### Stage 6 — Workflow lists (boards 2, 8, 9, 11)

- `RunsList.tsx`: drop the Saved workflows section; add the "All workflows · N" button.
- New `AllWorkflows.tsx`: table (Workflow, Steps chips colored by mode, Inputs, Last run, Actions: Edit, Run, ⋯ Duplicate/Rename/Delete), search, back, New workflow. Duplicate is a create with a new id; Rename is the existing PUT; Delete needs `DELETE /workflows/{wfId}` (new; 409 while a run of it is active).
- `WorkflowsTab.tsx` top bar: Run workflow, All workflows icon, full screen/collapse; New workflow removed.
- Tests: `WorkflowsTab.test.tsx` top bar, new `AllWorkflows.test.tsx`, route test for delete.

### Stage 7 — Agents full screen (board 10)

- Agents tab full screen (`ActivityPanel` `is-full`): left list of agents only, terminal in the main area, header usage strip (Context meter n/window, Tokens in/out, Cache hit, Cost) and Stop agent. No right panel.
- Usage comes from Stage 2's `ReadUsage` over the agent's session via a new `GET /agents/{id}/usage`, pushed on the agent's existing change events. Cost uses a per-model price table in config; hidden when the model is unknown.
- Tests: usage route with a transcript fixture; strip renders and hides cost when unknown.
- Done: the route is `GET /agents/{id}/usage` (the agent routes are not under `/repos/{id}`) and returns `null` with no claude session. Tokens, cache hit and cost sum every billed reply (`Transcripts.ReadTotals`, one count per `message.id`); context is the last main-thread reply. Prices live in `Workflows/ModelPrices.cs`, a code table beside `WorkflowLimits` rather than user config. The web refetches on the agent's status changes and polls every 5 s only while full screen shows that agent. See `docs/architecture/parallel-agents.md` "Session usage".

### Stage 8 — Docs

Update `docs/architecture/workflows.md` (definition fields, modes, continue errors, redo/send back, usage, delete route), `docs/architecture/parallel-agents.md` (resume launch, usage route), `docs/architecture/llm-settings.md` (per-step provider override), and set this file's status.

## Order

0 → 1 → 2 → 3 are sequential (shared runner code). 4 needs 0; 5 needs 1–2; 6 and 7 are independent of the runner work after Stage 0 (7 needs Stage 2's reader).

## Open questions

- Board 9 still has a "Message the step agent…" input in the live agent view; remove it in Stage 5 for consistency with boards 3 and 8?
- Redo of a `new` step: the decision resumes the earlier step's session even though the step was configured as `new`. Confirm, or limit it to `continue`/`handoff` steps.
- Thresholds (3 steps, 60%) and whether the badge should block or only warn.
