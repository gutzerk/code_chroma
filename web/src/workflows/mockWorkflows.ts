import { computeRedoCard, currentRecord } from "./redoPlan";
import { isFinished } from "./runControls";
import {
  workflowInputs,
  type MessageReply,
  type RedoRequest,
  type RunMessage,
  type ReviewDecision,
  type Run,
  type RunEvent,
  type RunEventName,
  type StepRecord,
  type StopMode,
  type WorkflowDef,
} from "./types";

/** The fixture workflow the mock bridge serves (mirrors a hand-authored .codechroma/workflows file). */
export const MOCK_WORKFLOW: WorkflowDef = {
  id: "ship-feature",
  name: "Ship a feature",
  steps: [
    { id: "s1", slug: "plan", kind: "agent", prompt: "Plan the change." },
    { id: "s2", slug: "implement", kind: "agent", prompt: "Implement the plan." },
    { id: "s3", slug: "review", kind: "review", prompt: "Review the diff." },
    { id: "s4", slug: "ship", kind: "agent", prompt: "Open the pull request." },
  ],
};

/** How long a mock step works before finishing; 0 disables the timer so tests drive advance(). */
const DEFAULT_STEP_MS = 2500;

function blankStep(stepId: string): StepRecord {
  return {
    stepId,
    attempt: 1,
    status: "pending",
    output: "",
    diffStat: null,
    checkpointRef: null,
    sessionId: null,
  };
}

/** An in-memory run engine that follows the contract transition table, so the UI works with no bridge. */
export class MockWorkflowEngine {
  private readonly workflows = [MOCK_WORKFLOW];
  private readonly runs = new Map<string, Run>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private counter = 0;
  private msgCounter = 0;

  constructor(
    private readonly emit: (event: RunEvent) => void,
    public stepMs: number = DEFAULT_STEP_MS,
  ) {}

  listWorkflows(): WorkflowDef[] {
    return structuredClone(this.workflows);
  }

  createWorkflow(workflow: WorkflowDef): WorkflowDef {
    if (this.workflows.some((w) => w.id === workflow.id)) throw new Error("Workflow already exists");
    this.workflows.push(structuredClone(workflow));
    return structuredClone(workflow);
  }

  updateWorkflow(workflow: WorkflowDef): WorkflowDef {
    const index = this.workflows.findIndex((w) => w.id === workflow.id);
    if (index < 0) throw new Error(`unknown workflow ${workflow.id}`);
    this.workflows[index] = structuredClone(workflow);
    return structuredClone(workflow);
  }

  /** Removes one done/stopped run. */
  deleteRun(runId: string): void {
    const run = this.require(runId);
    if (!isFinished(run.state)) throw new Error("Only a finished run can be deleted");
    this.runs.delete(runId);
    this.notify(run, "run.deleted");
  }

  /** Removes every done/stopped run. */
  clearFinished(): void {
    for (const run of [...this.runs.values()].filter((r) => isFinished(r.state))) {
      this.runs.delete(run.id);
      this.notify(run, "run.deleted");
    }
  }

  /** Resets a done/stopped run to step 1, keeping its id and inputs. */
  restartRun(runId: string): Run {
    const run = this.require(runId);
    if (!isFinished(run.state)) throw new Error("Only a finished run can be restarted");
    const workflow = this.workflows.find((wf) => wf.id === run.workflowId);
    if (!workflow) throw new Error(`unknown workflow ${run.workflowId}`);
    this.clearTimer();
    const fresh = this.freshRecord(run.id, workflow, run.inputs ?? {});
    this.runs.set(run.id, fresh);
    this.launch(fresh, workflow);
    this.notify(fresh, "run.step");
    return structuredClone(fresh);
  }

  deleteWorkflow(workflowId: string): void {
    const active = [...this.runs.values()].some(
      (run) => run.workflowId === workflowId && !isFinished(run.state),
    );
    if (active) throw new Error("The workflow has a run in progress; stop it first");
    const index = this.workflows.findIndex((w) => w.id === workflowId);
    if (index < 0) throw new Error(`unknown workflow ${workflowId}`);
    this.workflows.splice(index, 1);
  }

  /** Marks a step that has not run as skipped; the current parked step also moves the run on. */
  skip(runId: string, stepId: string): Run {
    const run = this.require(runId);
    const step = this.step(run, stepId);
    if (!step) throw new Error(`unknown step ${stepId}`);
    if (run.currentStepId !== stepId) {
      if (step.status !== "pending") throw new Error("Only a step that has not started can be skipped");
      step.status = "skipped";
      this.notify(run, "run.step");
      return structuredClone(run);
    }
    if (!["held", "needs_you", "stopped"].includes(run.state)) {
      throw new Error("Stop the run at this step before skipping it");
    }
    step.status = "skipped";
    this.advanceFrom(run);
    return structuredClone(run);
  }

  listRuns(): Run[] {
    return [...this.runs.values()].map((run) => structuredClone(run));
  }

  getRun(runId: string): Run {
    return structuredClone(this.require(runId));
  }

  startRun(workflowId: string, inputs: Record<string, string> = {}): Run {
    const workflow = this.workflows.find((wf) => wf.id === workflowId);
    if (!workflow) throw new Error(`unknown workflow ${workflowId}`);
    const missing = workflowInputs(workflow).find((input) => !inputs[input.name]?.trim());
    if (missing) throw new Error(`input is required: ${missing.label || missing.name}`);
    this.counter += 1;
    const run = this.freshRecord(`run${this.counter}`, workflow, inputs);
    this.runs.set(run.id, run);
    this.launch(run, workflow);
    this.notify(run, "run.step");
    return structuredClone(run);
  }

  private freshRecord(id: string, workflow: WorkflowDef, inputs: Record<string, string>): Run {
    return {
      id,
      workflowId: workflow.id,
      state: "running",
      currentStepId: workflow.steps[0].id,
      stopAfter: null,
      attempt: 1,
      attempts: [{ n: 1, branch: null }],
      breakpoints: workflow.steps.filter((s) => s.pauseBefore).map((s) => s.id),
      steps: workflow.steps.map((step) => blankStep(step.id)),
      messages: [],
      redoProposal: null,
      inputs,
    };
  }

  /** Begins step 1, or holds there when it carries a pause-before breakpoint. */
  private launch(run: Run, workflow: WorkflowDef): void {
    const first = workflow.steps[0].id;
    if (run.breakpoints.includes(first)) {
      run.state = "held";
      this.setStatus(run, first, "held");
      return;
    }
    this.begin(run, first);
  }

  pause(runId: string): Run {
    const run = this.require(runId);
    if (run.state !== "running") return structuredClone(run);
    run.state = "paused";
    this.setStatus(run, run.currentStepId, "paused");
    this.clearTimer();
    this.system(run, "Run paused.");
    this.notify(run, "run.paused");
    return structuredClone(run);
  }

  resume(runId: string): Run {
    const run = this.require(runId);
    if (run.state === "paused") {
      run.state = "running";
      this.setStatus(run, run.currentStepId, "running");
      this.schedule(run);
      this.notify(run, "run.resumed");
    } else if (run.state === "held") {
      run.state = "running";
      this.begin(run, run.currentStepId);
      this.notify(run, "run.resumed");
    }
    return structuredClone(run);
  }

  stop(runId: string, mode: StopMode): Run {
    const run = this.require(runId);
    if (run.state === "held" || run.state === "needs_you" || run.state === "paused") {
      if (mode === "now") this.stopWaiting(run);
      return structuredClone(run);
    }
    if (run.state !== "running") return structuredClone(run);
    if (mode === "afterStep") {
      run.stopAfter = run.currentStepId;
      this.notify(run, "run.step");
      return structuredClone(run);
    }
    this.clearTimer();
    run.state = "stopping";
    this.setStatus(run, run.currentStepId, "stopping");
    this.notify(run, "run.stopping");
    run.state = "stopped";
    this.setStatus(run, run.currentStepId, "stopped");
    this.system(run, "Run stopped.");
    this.notify(run, "run.stopped");
    return structuredClone(run);
  }

  /** Cancels a waiting run (held, awaiting review or paused): an unstarted step stays pending. */
  private stopWaiting(run: Run): void {
    this.clearTimer();
    const current = this.step(run, run.currentStepId);
    if (current && (current.status === "held" || current.status === "needs_you")) current.status = "pending";
    else this.setStatus(run, run.currentStepId, "stopped");
    run.state = "stopped";
    this.system(run, "Run stopped.");
    this.notify(run, "run.stopped");
  }

  keepRunning(runId: string): Run {
    const run = this.require(runId);
    run.stopAfter = null;
    this.notify(run, "run.step");
    return structuredClone(run);
  }

  setBreakpoint(runId: string, stepId: string, on: boolean): Run {
    const run = this.require(runId);
    const without = run.breakpoints.filter((id) => id !== stepId);
    run.breakpoints = on ? [...without, stepId] : without;
    this.notify(run, "run.step");
    return structuredClone(run);
  }

  resumeFrom(runId: string, stepId: string): Run {
    const run = this.require(runId);
    if (run.state !== "held" && run.state !== "stopped") return structuredClone(run);
    const ids = this.stepIds(run);
    const index = ids.indexOf(stepId);
    if (index < 0) throw new Error(`unknown step ${stepId}`);
    for (const id of ids.slice(index)) {
      const rec = this.step(run, id);
      if (rec) Object.assign(rec, { ...blankStep(id), attempt: run.attempt });
    }
    run.state = "running";
    run.stopAfter = null;
    this.begin(run, stepId);
    this.notify(run, "run.resumed");
    return structuredClone(run);
  }

  review(runId: string, decision: ReviewDecision, note?: string): Run {
    const run = this.require(runId);
    if (run.state !== "needs_you") return structuredClone(run);
    const step = this.step(run, run.currentStepId);
    if (decision === "sendBack") {
      if (step) step.output += `Sent back: ${note ?? "(no note)"}\n`;
      run.state = "running";
      this.setStatus(run, run.currentStepId, "running");
      this.schedule(run);
      this.notify(run, "run.resumed");
    } else {
      if (step) step.status = "done";
      this.advanceFrom(run);
    }
    return structuredClone(run);
  }

  /** Finishes the current step as if its timer fired (test and dev driver). */
  advance(runId: string): void {
    const run = this.require(runId);
    if (run.state !== "running") return;
    const step = this.step(run, run.currentStepId);
    if (step) {
      step.status = "done";
      step.output += `${step.stepId} finished.\n`;
      step.diffStat = "1 file changed, 3 insertions(+)";
    }
    this.advanceFrom(run);
  }

  private advanceFrom(run: Run): void {
    this.clearTimer();
    const ids = this.stepIds(run);
    const after = ids.slice(ids.indexOf(run.currentStepId ?? "") + 1);
    const nextId = after.find((id) => this.step(run, id)?.status !== "skipped");
    const next = nextId ? this.step(run, nextId) : undefined;
    if (!next) {
      run.state = "done";
      run.currentStepId = null;
      this.notify(run, "run.done");
      return;
    }
    run.currentStepId = next.stepId;
    if (run.stopAfter !== null || run.breakpoints.includes(next.stepId)) {
      run.state = "held";
      run.stopAfter = null;
      next.status = "held";
      this.notify(run, "run.held");
      return;
    }
    run.state = "running";
    this.begin(run, next.stepId);
    this.notify(run, "run.step");
  }

  /** Starts a step: a review step blocks on the human, an agent step runs on the timer. */
  private begin(run: Run, stepId: string | null): void {
    const workflow = this.workflows.find((wf) => wf.id === run.workflowId);
    const def = workflow?.steps.find((s) => s.id === stepId);
    run.currentStepId = stepId;
    const step = this.step(run, stepId);
    if (!step) return;
    step.output += `Started ${def?.slug ?? stepId}.\n`;
    if (def?.kind === "review") {
      run.state = "needs_you";
      step.status = "needs_you";
      return;
    }
    step.status = "running";
    this.schedule(run);
  }

  private schedule(run: Run): void {
    this.clearTimer();
    if (this.stepMs <= 0) return;
    this.timer = setTimeout(() => this.advance(run.id), this.stepMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setStatus(run: Run, stepId: string | null, status: StepRecord["status"]): void {
    const step = this.step(run, stepId);
    if (step) step.status = status;
  }

  private step(run: Run, stepId: string | null): StepRecord | undefined {
    return stepId === null ? undefined : currentRecord(run, stepId);
  }

  private stepIds(run: Run): string[] {
    return (this.workflows.find((wf) => wf.id === run.workflowId)?.steps ?? []).map((s) => s.id);
  }

  private system(run: Run, text: string): void {
    this.push(run, { target: "run", role: "system", text });
  }

  private push(run: Run, m: Omit<RunMessage, "id" | "at">): RunMessage {
    this.msgCounter += 1;
    const full: RunMessage = { ...m, id: `m${this.msgCounter}`, at: new Date().toISOString() };
    run.messages = [...(run.messages ?? []), full];
    return full;
  }

  /** Asks the run agent (target "run"); a step's agent is talked to in its terminal. Never changes run state, except a redo proposal stops the run. */
  message(runId: string, target: string, text: string): MessageReply {
    const run = this.require(runId);
    if (target !== "run") throw new Error("talk to a step's agent in its terminal");
    this.push(run, { target, role: "user", text });
    const workflow = this.workflows.find((wf) => wf.id === run.workflowId);
    const reply = this.push(run, {
      target,
      role: "agent",
      text: `Run is ${run.state}.`,
      chips: /\bwhere\b/i.test(text) ? [{ label: "hello()", nodeId: "fn:hello" }] : undefined,
    });
    this.notify(run, "run.message");
    if (target === "run" && /\bredo\b/i.test(text) && workflow) this.propose(run, workflow, text);
    return { reply: reply.text, messageId: reply.id };
  }

  private propose(run: Run, workflow: WorkflowDef, text: string): void {
    const named = workflow.steps.find((s) => new RegExp(`\\b${s.slug}\\b`, "i").test(text));
    const from = named?.id ?? workflow.steps[1].id;
    if (run.state === "paused") run.state = "running";
    if (run.state === "needs_you") {
      run.state = "stopped";
      this.setStatus(run, run.currentStepId, "stopped");
      this.system(run, "Run stopped.");
      this.notify(run, "run.stopped");
    } else if (run.state === "running") this.stop(run.id, "now");
    run.redoProposal = { from, card: computeRedoCard(workflow, run, from, "") };
    this.system(run, `Run agent proposes a redo from ${workflow.steps.find((s) => s.id === from)?.slug}.`);
    this.notify(run, "run.redo.proposed");
  }

  /** Confirms a redo: sets the attempt aside, keeps earlier steps, starts attempt n+1 at `from`. */
  redo(runId: string, req: RedoRequest): Run {
    const run = this.require(runId);
    const workflow = this.workflows.find((wf) => wf.id === run.workflowId);
    if (!workflow || !["stopped", "done", "held"].includes(run.state)) return structuredClone(run);
    const ids = workflow.steps.map((s) => s.id);
    const index = ids.indexOf(req.from);
    if (index < 0) throw new Error(`unknown step ${req.from}`);
    const old = run.attempt;
    const next = old + 1;
    const fresh = ids.map((id, i) => {
      const prev = this.step(run, id) ?? blankStep(id);
      return i < index
        ? { ...prev, attempt: next, fromAttempt: prev.fromAttempt ?? prev.attempt }
        : { ...blankStep(id), attempt: next };
    });
    const target = fresh[index];
    if (req.note) target.output = `Note: ${req.note}\n`;
    if (req.stepEdit) {
      target.output += `Prompt edited${req.stepEdit.saveToWorkflow ? " (saved to workflow)" : " (this run only)"}.\n`;
      if (req.stepEdit.saveToWorkflow) workflow.steps[index].prompt = req.stepEdit.prompt;
      else run.promptOverrides = { ...run.promptOverrides, [req.from]: req.stepEdit.prompt };
    }
    const aside = run.attempts.find((a) => a.n === old);
    if (aside) {
      aside.branch = `${run.id}/attempt-${old}`;
      aside.steps = ids.map((id) => structuredClone(this.step(run, id) ?? blankStep(id)));
    }
    run.attempts.push({ n: next, branch: null });
    run.attempt = next;
    run.steps = fresh;
    run.redoProposal = null;
    run.stopAfter = null;
    run.state = "running";
    this.system(run, `Redo started from ${workflow.steps[index].slug} (attempt ${next}).`);
    this.begin(run, req.from);
    this.notify(run, "run.redo.started");
    return structuredClone(run);
  }

  cancelRedo(runId: string): Run {
    const run = this.require(runId);
    run.redoProposal = null;
    this.system(run, "Redo cancelled; the run stays stopped.");
    this.notify(run, "run.message");
    return structuredClone(run);
  }

  private require(runId: string): Run {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    return run;
  }

  private notify(run: Run, event: RunEventName): void {
    this.emit({ type: "run", runId: run.id, event });
  }
}
