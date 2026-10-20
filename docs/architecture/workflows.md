# Workflows (steerable runs)

Open the Workflows tab in the attached right panel. Run workflow opens a picker that always offers
Add new workflow. The editor accepts a name and ordered agent/review steps with instructions.
`POST /repos/{repoId}/workflows` validates and persists the definition in `.codechroma/workflows`;
duplicate ids return 409 and read-only workspaces cannot create definitions. Saved workflows are
immediately available to run. The segmented progress bar stays visible when the steps collapse.


C# bridge only (the Python bridge has no mirror). Plan: Phase 0 foundation + Stage 1 runner of the "steer a running workflow" plan.

## Files

- Definition: `<repo>/.codechroma/workflows/<id>.json` = `{ id, name, steps: [{ id, slug, kind: "agent"|"review", prompt }] }` (hand-authored; no builder UI yet).
- Run record: `<repo>/.codechroma/runs/<runId>.json` = `Run { id, workflowId, state, currentStepId, stopAfter, attempt, attempts[{n,branch}], breakpoints[], steps[StepRecord] }`, `StepRecord { stepId, attempt, status, output, diffStat, checkpointRef, sessionId }`. camelCase, written atomically by `RunStore`.
- Code: `dotnet/CodeChroma.Bridge/Workflows/` (`RunStateMachine.cs` pure table, `Models.cs`, `RunStore.cs`, `WorkflowRunner.cs`), `Routes/WorkflowRoutes.cs` (also holds `WorkflowRunners`, one runner per workspace).

## Behaviour

- States: running, paused, stopping, held, stopped, needs_you, done. `RunStateMachine.TryApply(state, command)` is the only transition table; an illegal pair returns null (`Apply` returns the state unchanged, the runner answers 409).
- Each run gets its own worktree (`WorktreeOps.WorktreePath(repo, "wf-<runId>")`, branch `workflow/<runId>`). Steps run sequentially through the `workflow-step` `SkillAgent` kind (registered in `SkillAgents`), keyed by run id, with the worktree as cwd; the `workflow-step` spec is `SkillAgentSpec.NoArtifact(...)` (null `Artifact`/`Validate`/`InvalidError`: nothing is snapshotted or restored, so no step failure or cancel rolls the code back) and a step counts as completed on exit code 0 alone. Only the chat agent has a scratch marker file in the temp dir (`WorkflowRunner.Marker("chat", key)`, key sanitized with `Path.GetInvalidFileNameChars` plus backslash), pre-written by `AskAgent`.
- Checkpoint: before an agent step starts, `git add -A` + an empty-allowed commit in the worktree; the sha goes in `checkpointRef`. After a step the session id (`Transcripts.FindSessionId`) and `git diff --shortstat` land in the record.
- Pause: `PauseGate` is awaited by `SkillAgent.ReadEvents` after each stream line is read and before it is parsed or queued, and by the flush loop before every flush (`RunOptions.PauseGate`, defaulting to a completed-task gate so the reader and flush loop just `await gate(token)`; `PauseGate.WaitAsync` reads its state lock-free). `Pause` flips run and step status to paused at once; from then on no output is flushed or written to the run record, and a line that arrives meanwhile is held (not lost, not duplicated) until resume. The gate wait honors the cancellation token and `Stop` opens the gate, so Stop while paused reaps the process promptly. Limit: pause is soft, the process is not suspended. A silent CLI (long tool call) keeps running and may even exit and change the worktree while paused; only its output and the step completion are held, and the CLI blocks once its stdout pipe fills. Between steps the loop waits on the same gate.
- Stop now: cancels the step process (`SkillAgent.Stop`), leaves the partial diff uncommitted in the worktree, step and run become stopped. Resume goes through `resume-from` the current step: reuses its record and checkpoint and, when a session id was saved, relaunches with `--resume <id>` (`RunOptions.ExtraArgs` on `Start`, passed into the CLI adapter's `BuildArgv`, which places them before a trailing positional prompt such as codex's, else appends them), else a fresh agent.
- Stop after step: sets `stopAfter` to the current step id (state stays running); at step end the run becomes held on the next step (record `held`, `currentStepId` = next) and the flag clears. `keep-running` clears it earlier.
- Breakpoints: step ids on the run; settable only on `pending` steps; reaching one makes the run held before it starts. They are never cleared by resume.
- Review step: run becomes needs_you. `approve` continues (or finishes); `sendBack` re-runs the nearest earlier agent step with the note (resuming its session when known) and returns to the gate.
- A failing step (non-zero exit, timeout) stops the run with `✗ <error>` appended to the step output (the contract has no failed state).
- A bridge restart turns persisted running/paused/stopping runs into stopped (`Recover`).

## Routes and events

Under `/repos/{id}`: `GET /workflows`, `GET /runs`, `GET /runs/{runId}`, `POST /workflows/{wfId}/runs`, `POST /runs/{runId}/pause|resume|stop{mode}|keep-running|breakpoints{stepId,on}|resume-from{stepId}|review{decision,note}|message|redo|redo/cancel`. All POSTs return the Run; PR (read-only) workspaces get 409. Events go over the repo socket as `{ type: "run", runId, event }` (`run.paused|resumed|stopping|stopped|held|step|done|message|redo.proposed|redo.started`); clients re-fetch the run.

## Run agent, messages, redo (Stages 3-4)

Code: `Workflows/WorkflowRunner.Steer.cs` (partial of `WorkflowRunner`), `WorktreeOps.CreateBranch/ResetHard`, `RunStore.SaveWorkflow`, `SkillAgents` kind `workflow-chat`.

- `POST /runs/{id}/message {target, text}` -> `{reply, messageId}`. `target` is `run` (the run agent) or a step id / `@slug` (that step's agent). Each call is one headless `SkillAgent` job (`workflow-chat`, key `<runId>:run` or `<runId>:<stepId>`, cwd = the run worktree, read-only `--tools Read,Grep,Glob`); a second ask to a busy agent is 409. It never touches run state, the pause gate or the step process. User, agent and system messages are stored on `Run.messages` (event `run.message`).
- The step agent gets the step prompt, its output tail and (when known) `--resume <sessionId>`; it has no MCP. The run agent gets a digest of every step (status, diff stat, output tail) and a per-run MCP config.
- Per-run MCP: `POST /mcp/runs/{repoId}/{runId}` (JSON-RPC over HTTP: initialize, tools/list, tools/call, ping), bearer token generated per run handle in memory. The bridge address comes from `IServer` at call time (`WorkflowRunners.McpUrl`); no URL (server not listening) means no MCP args. Tools: `pause`, `stop {mode}`, `propose_redo {from, note}`. `propose_redo` only sets `Run.redoProposal = {from, card{reruns, keeps, setsAside, note}}` and emits `run.redo.proposed`; the agent has no redo or edit tool. Only the run target gets the MCP.
- `POST /runs/{id}/redo {from, note?, stepEdit?{prompt, saveToWorkflow}}` (legal from stopped, held, done; `RunCommand.Redo`; awaits the parked loop first): commits the worktree's leftovers, creates branch `<runId>/attempt-<n>` at that commit (not under `workflow/`, git cannot hold both `workflow/x` and `workflow/x/y`; a numeric suffix `-2`, `-3` is added when the name is taken and the actual name lands in `attempts[n].branch`), `git reset --hard` to `from`'s `checkpointRef` only after the branch exists (if the reset fails the branch is deleted again and the redo answers 500), then attempt n+1. `from` must be an agent step that already has a checkpoint (else 409).
- Attempt bookkeeping: the set-aside `attempts[n]` gets `branch` and a `steps[]` snapshot (additive, so the UI can show attempt 1 read-only); a new `attempts[n+1]` points at the live `workflow/<runId>`. Steps before `from` are kept (`fromAttempt` set to their original attempt, `attempt` moves to n+1, output and checkpoint unchanged); `from` and later get fresh pending records. The note is the first line of `from`'s output (`--- redo note: ... ---`) and, with a note, the rerun prompt (`Reviewer feedback: ...`, fresh agent, no session resume). Breakpoints are untouched; `from` itself is bypassed once, later breakpoints still hold. `stepEdit` changes the step prompt: `saveToWorkflow` rewrites `workflows/<id>.json`, otherwise it lives in `Run.promptOverrides` (reapplied when a run is reloaded). Event `run.redo.started`.
- `POST /runs/{id}/redo/cancel` clears `redoProposal`; the state stays (stopped).

## Races and guards (review of PR 148)

- 🔴 **A steer command can land between the loop's gate/stop check and its lock.** `LoopAsync` therefore retries instead of throwing: `TryBegin` (start/park a step) and `CompleteStep` return "not running" when the state is no longer `running`, and the loop waits on the gate again (`Pause` closes it, `Stop` sets `StopRequested` and opens it, both under the same lock as the state change). A completed step is never recorded as stopped because of a pause.
- **Stopping a `held`/`needs_you` run** leaves that step `pending` (it never started), so `ResumeFrom` does not build the "interrupted attempt" prompt.
- **Redo** does its git work (`KeepAttempt`: commit, branch, reset) outside the runner-wide lock. `Handle.Busy` is set meanwhile and `Transition` refuses state changes with a 409, so nothing races the worktree reset.
- **Saving a step edit to the workflow** loads the stored definition and changes only that step; the in-memory definition also carries this run's temporary overrides of other steps and must not be written back.
- **Chat agents** (`Message`): one at a time per `runId:target` (`_chatBusy`, checked and claimed under the lock); every chat passes `--tools Read,Grep,Glob --strict-mcp-config` (`--tools` does not limit MCP tools, so ambient MCP servers must not load) plus `--mcp-config` for the run agent only; chat and `--resume` are claude-only (`IsClaude`), other CLIs get a 409.
- **Per-run MCP** (`HandleMcp`): an unknown run and a bad token both answer 401; non-string `method`/`mode`/`from`/`note` are tolerated (a non-string `mode` is a tool error, never a silent `now`).
- **Step timeout:** `SkillAgent` stops the run's timeout while the pause gate holds the reader and restarts it on release (a silent CLI that is paused is still timed out).

## Tests

`dotnet/CodeChroma.Bridge.Tests/Workflows/` (`RunStateMachineTests`, `WorkflowRunnerTests`: message routing, ask-while-running, MCP tools, redo keeps earlier steps and breakpoints, step edit, redo cancel, pause holding output, stop while paused, extra-args argv order per adapter (`CliAdapterTests`), branch-name collision, reset rollback, launch-index race). FakeCli (`CodeChroma.Bridge.FakeCli`) computes its launch index under an exclusive lock file (`fakecli.invocations.lock`, retry on `IOException`; simultaneous launches get distinct indexes), resolves relative `write` paths against the cwd, and gained `stdout_slow`, `block_until_file` and a `runs[]` script (n-th launch plays runs[n]); helpers in `Support/FakeCliHarness.cs`.
