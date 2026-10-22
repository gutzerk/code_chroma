/** Workflow steer contract types (camelCase, mirrors the C# bridge's run record). */

export type RunState =
  | "running"
  | "paused"
  | "stopping"
  | "held"
  | "stopped"
  | "needs_you"
  | "done";

export type StepStatus =
  | "pending"
  | "running"
  | "paused"
  | "stopping"
  | "held"
  | "stopped"
  | "needs_you"
  | "done"
  | "skipped";

export interface WorkflowStepDef {
  id: string;
  slug: string;
  kind: "agent" | "review";
  /** May be "" for a review step. */
  prompt: string;
  /** A skill of the project the agent is told to use for this step. */
  skill?: string | null;
  /** "previous" (default) prepends the prior step's output and diff stat; "fresh" starts clean. */
  context?: "previous" | "fresh";
  /** Becomes a breakpoint when a run starts. */
  pauseBefore?: boolean;
  /** Review step: show the diff. */
  showDiff?: boolean;
  /** Review step: show the previous step's summary. */
  showSummary?: boolean;
  /** Review step: step id a send-back reruns from (null = default target). */
  sendBackTo?: string | null;
  /** Agent step: the one value asked for when the run starts; `{{name}}` in this step's prompt is replaced by it. */
  input?: WorkflowInput | null;
}

/** A value asked for when a run starts; `{{name}}` in a step prompt is replaced by it. */
export interface WorkflowInput {
  name: string;
  label: string;
}

export interface WorkflowDef {
  id: string;
  name: string;
  steps: WorkflowStepDef[];
  inputs?: WorkflowInput[];
}

/** Every value a run must be given: each step's own input, then any older workflow-level ones. */
export function workflowInputs(workflow: WorkflowDef): WorkflowInput[] {
  const all = [...workflow.steps.flatMap((s) => (s.input ? [s.input] : [])), ...(workflow.inputs ?? [])];
  return all.filter((input, i) => all.findIndex((other) => other.name === input.name) === i);
}

export interface SkillInfo {
  name: string;
  description: string;
}

export interface StepRecord {
  stepId: string;
  attempt: number;
  status: StepStatus;
  output: string;
  diffStat: string | null;
  checkpointRef: string | null;
  sessionId: string | null;
  /** Set on a step kept from an earlier attempt of a redo. */
  fromAttempt?: number;
}

export interface MessageChip {
  label: string;
  nodeId: string;
}

export interface RunMessage {
  id: string;
  /** "run" or a step id. */
  target: string;
  role: "user" | "agent" | "system";
  text: string;
  at: string;
  chips?: MessageChip[] | null;
}

export interface RedoCardData {
  reruns: string[];
  keeps: string[];
  setsAside: string[];
  note: string;
}

export interface RedoProposal {
  from: string;
  card: RedoCardData;
}

export interface StepEdit {
  prompt: string;
  saveToWorkflow: boolean;
}

export interface RedoRequest {
  from: string;
  note?: string;
  stepEdit?: StepEdit;
}

export interface MessageReply {
  reply: string;
  messageId: string;
}

export interface Run {
  id: string;
  workflowId: string;
  state: RunState;
  currentStepId: string | null;
  stopAfter: string | null;
  attempt: number;
  attempts: { n: number; branch: string | null; steps?: StepRecord[] }[];
  promptOverrides?: Record<string, string>;
  inputs?: Record<string, string>;
  breakpoints: string[];
  steps: StepRecord[];
  messages?: RunMessage[];
  redoProposal?: RedoProposal | null;
}

export type StopMode = "now" | "afterStep";
export type ReviewDecision = "approve" | "sendBack";

export type RunEventName =
  | "run.paused"
  | "run.resumed"
  | "run.stopped"
  | "run.stopping"
  | "run.held"
  | "run.step"
  | "run.done"
  | "run.redo.proposed"
  | "run.redo.started"
  | "run.message"
  | "run.deleted";

/** The ping on the shared events socket; the client reacts by re-fetching GET /runs/{runId}. */
export interface RunEvent {
  type: "run";
  runId: string;
  event: RunEventName;
}
