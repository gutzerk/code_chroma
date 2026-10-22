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
  /** Agent step: a new agent, a new one handed the previous step's output, or a continue that resumes an earlier step's claude session. */
  agent?: StepAgent;
  /** Agent step: free text added after the instructions, for this step only. */
  extraPrompt?: string | null;
  /** Agent step: an LLM settings provider id; null runs the workflow-step call-site default. */
  provider?: string | null;
  model?: string | null;
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

/** "continue" resumes the nearest earlier agent step; "continue:<stepId>" names it. */
export type StepAgent = "new" | "handoff" | "continue" | `continue:${string}`;

export type AgentMode = "new" | "handoff" | "continue";

const CONTINUE_PREFIX = "continue:";

/** The mode of a step's agent field; missing reads as hand-off, like the bridge. */
export function agentMode(agent: StepAgent | null | undefined): AgentMode {
  if (agent === "continue" || agent?.startsWith(CONTINUE_PREFIX)) return "continue";
  return agent === "new" ? "new" : "handoff";
}

/** The step id a "continue:<id>" names, or null (plain "continue" and the other modes name none). */
export function continueStepId(agent: StepAgent | null | undefined): string | null {
  return agent?.startsWith(CONTINUE_PREFIX) ? agent.slice(CONTINUE_PREFIX.length) : null;
}

/** The index of the last agent step before `index`, or -1. */
export function nearestAgentBefore(steps: WorkflowStepDef[], index: number): number {
  for (let i = index - 1; i >= 0; i--) if (steps[i].kind === "agent") return i;
  return -1;
}

/** The step a continue names, even a later or review one (so the editor can say what is wrong); -1 when it names none. */
export function continueTargetIndex(steps: WorkflowStepDef[], index: number): number {
  const agent = steps[index]?.agent;
  if (agent === "continue") return nearestAgentBefore(steps, index);
  const id = continueStepId(agent);
  return id === null ? -1 : steps.findIndex((s) => s.id === id);
}

/** The step a continue resumes, or -1 (also -1 for a step that does not continue or names an invalid source). */
export function continueSourceIndex(steps: WorkflowStepDef[], index: number): number {
  const target = continueTargetIndex(steps, index);
  return target >= 0 && target < index && steps[target].kind === "agent" ? target : -1;
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
  /** Token counts of the step's session; context = input + cache read + cache creation. */
  usage?: StepUsage | null;
  /** The step whose session this step resumed. */
  resumedFrom?: string | null;
  /** How many steps the continue chain ending here spans; computed from the definition when absent. */
  chainLength?: number | null;
  /** The bridge's verdict that the chain is long or the context is near the model's window (WorkflowLimits). */
  chainWarning?: boolean | null;
}

export interface StepUsage {
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  model?: string | null;
  contextWindow?: number;
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
