import { useSyncExternalStore } from "react";
import type { EngineClient } from "../engine-client/EngineClient";
import { messageOf } from "../util/reportError";
import { Store } from "../state/createStore";
import type { RedoRequest, ReviewDecision, Run, StopMode, WorkflowDef } from "./types";

const NO_WORKFLOWS: WorkflowDef[] = [];
const NO_RUNS: Run[] = [];
const HIGHLIGHT_MS = 1600;

export type WorkflowView = "runs" | "all";
export type WorkflowDialog = { kind: "run"; workflow?: WorkflowDef } | { kind: "editor"; workflow?: WorkflowDef } | null;

/** Workflow definitions, run records, the open run and the one expanded step row. */
class WorkflowStore extends Store {
  private workflows = NO_WORKFLOWS;
  private runs = NO_RUNS;
  private activeRunId: string | null = null;
  private expandedStepId: string | null = null;
  private error: string | null = null;
  private railCollapsed = false;
  private viewAttempt: number | null = null;
  private highlightedNodeId: string | null = null;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;
  private view: WorkflowView = "runs";
  private dialog: WorkflowDialog = null;

  getView = (): WorkflowView => this.view;

  getDialog = (): WorkflowDialog => this.dialog;

  /** Switches between the runs overview and the All workflows screen. */
  setView = (view: WorkflowView): void => {
    if (this.view === view) return;
    this.view = view;
    this.emit();
  };

  /** Opens (or with null closes) the run or editor dialog; the header and the tab share it. */
  setDialog = (dialog: WorkflowDialog): void => {
    this.dialog = dialog;
    this.emit();
  };

  getWorkflows = (): WorkflowDef[] => this.workflows;

  getRuns = (): Run[] => this.runs;

  getActiveRunId = (): string | null => this.activeRunId;

  getExpandedStepId = (): string | null => this.expandedStepId;

  getError = (): string | null => this.error;

  getRailCollapsed = (): boolean => this.railCollapsed;

  /** The attempt being viewed, or null for the latest. */
  getViewAttempt = (): number | null => this.viewAttempt;

  getHighlightedNodeId = (): string | null => this.highlightedNodeId;

  setRailCollapsed = (collapsed: boolean): void => {
    if (this.railCollapsed === collapsed) return;
    this.railCollapsed = collapsed;
    this.emit();
  };

  setViewAttempt = (attempt: number | null): void => {
    this.viewAttempt = attempt;
    this.emit();
  };

  /** Rings a canvas node for ~1.6s (the chip's "Show on canvas" link). */
  highlightNode = (nodeId: string): void => {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightedNodeId = nodeId;
    this.emit();
    this.highlightTimer = setTimeout(() => {
      this.highlightedNodeId = null;
      this.highlightTimer = null;
      this.emit();
    }, HIGHLIGHT_MS);
  };

  getActiveRun = (): Run | undefined => this.runs.find((run) => run.id === this.activeRunId);

  private resetView(): void {
    this.expandedStepId = null;
    this.viewAttempt = null;
    this.railCollapsed = false;
  }

  setActiveRun = (runId: string | null): void => {
    this.activeRunId = runId;
    this.resetView();
    this.emit();
  };

  /** One row open at a time: expanding a row collapses the previous one; clicking it again closes it. */
  toggleExpanded = (stepId: string): void => {
    this.expandedStepId = this.expandedStepId === stepId ? null : stepId;
    this.emit();
  };

  setWorkflows = (workflows: WorkflowDef[]): void => {
    this.workflows = workflows;
    this.emit();
  };

  /** Replaces (or adds) one run record, keeping list order stable. */
  upsertRun = (run: Run): void => {
    const exists = this.runs.some((r) => r.id === run.id);
    this.runs = exists ? this.runs.map((r) => (r.id === run.id ? run : r)) : [...this.runs, run];
    this.emit();
  };

  /** Drops runs locally (a delete the caller or a `run.deleted` ping already confirmed). */
  removeRuns = (ids: string[]): void => {
    const gone = new Set(ids);
    this.setRuns(this.runs.filter((r) => !gone.has(r.id)));
  };

  removeRun = (id: string): void => this.removeRuns([id]);

  setRuns = (runs: Run[]): void => {
    this.runs = runs;
    if (this.activeRunId && !runs.some((r) => r.id === this.activeRunId)) this.activeRunId = null;
    this.emit();
  };

  setError = (message: string | null): void => {
    this.error = message;
    this.emit();
  };

  reset(): void {
    this.workflows = NO_WORKFLOWS;
    this.runs = NO_RUNS;
    this.activeRunId = null;
    this.resetView();
    this.error = null;
    this.view = "runs";
    this.dialog = null;
    this.highlightedNodeId = null;
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = null;
    this.emit();
  }
}

export const workflowStore = new WorkflowStore();

export function useWorkflows(): WorkflowDef[] {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getWorkflows);
}

export function useRuns(): Run[] {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getRuns);
}

export function useActiveRunId(): string | null {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getActiveRunId);
}

export function useWorkflowView(): WorkflowView {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getView);
}

export function useWorkflowDialog(): WorkflowDialog {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getDialog);
}

export function useExpandedStepId(): string | null {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getExpandedStepId);
}

export function useRailCollapsed(): boolean {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getRailCollapsed);
}

export function useViewAttempt(): number | null {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getViewAttempt);
}

export function useHighlightedNodeId(): string | null {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getHighlightedNodeId);
}

export function useWorkflowError(): string | null {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getError);
}

/** Loads workflows and runs, then re-fetches off every `run` ping; returns the unsubscribe fn. */
export function bindWorkflows(client: EngineClient): () => void {
  let disposed = false;
  workflowStore.reset();
  let allInFlight = false;
  let allDirty = false;
  const refreshAll = (): void => {
    if (allInFlight) {
      allDirty = true;
      return;
    }
    allInFlight = true;
    void Promise.all([client.listWorkflows(), client.listRuns()])
      .then(([workflows, runs]) => {
        if (disposed) return;
        workflowStore.setWorkflows(workflows);
        workflowStore.setRuns(runs);
      })
      .catch((err) => { if (!disposed) workflowStore.setError(messageOf(err)); })
      .finally(() => {
        allInFlight = false;
        if (!disposed && allDirty) {
          allDirty = false;
          refreshAll();
        }
      });
  };
  refreshAll();
  const inFlight = new Set<string>();
  const dirty = new Set<string>();
  const refreshRun = (runId: string): void => {
    if (inFlight.has(runId)) {
      dirty.add(runId);
      return;
    }
    inFlight.add(runId);
    void client
      .getRun(runId)
      .then((run) => { if (!disposed) workflowStore.upsertRun(run); })
      .catch((err) => { if (!disposed) workflowStore.setError(messageOf(err)); })
      .finally(() => {
        inFlight.delete(runId);
        if (!disposed && dirty.delete(runId)) refreshRun(runId);
      });
  };
  const unsubscribe = client.subscribeRuns((event) => {
    if (!event) return refreshAll();
    if (event.event === "run.deleted") return workflowStore.removeRun(event.runId);
    refreshRun(event.runId);
  });
  return () => { disposed = true; unsubscribe(); };
}

/** Runs one steer command and folds the returned Run into the store; a failure sets the error line and is returned (null on success). */
async function steer(command: () => Promise<Run>): Promise<string | null> {
  try {
    workflowStore.setError(null);
    workflowStore.upsertRun(await command());
    return null;
  } catch (err) {
    const message = messageOf(err);
    workflowStore.setError(message);
    return message;
  }
}

/** Runs one mutation, then its local follow-up; a failure sets the error line and is returned (null on success). */
async function mutate(fn: () => Promise<unknown>, refresh: () => void | Promise<void>): Promise<string | null> {
  try {
    workflowStore.setError(null);
    await fn();
    await refresh();
    return null;
  } catch (err) {
    const message = messageOf(err);
    workflowStore.setError(message);
    return message;
  }
}

/** The run commands the UI issues, bound to one client. */
export function workflowActions(client: EngineClient) {
  return {
    start: (workflowId: string, inputs?: Record<string, string>): Promise<string | null> =>
      steer(async () => {
        const run = await client.startRun(workflowId, inputs);
        workflowStore.setActiveRun(run.id);
        workflowStore.setView("runs");
        return run;
      }),
    skip: (runId: string, stepId: string) => steer(() => client.skipStep(runId, stepId)),
    createWorkflow: (def: WorkflowDef) =>
      mutate(() => client.createWorkflow(def), async () => workflowStore.setWorkflows(await client.listWorkflows())),
    deleteWorkflow: (workflowId: string) =>
      mutate(() => client.deleteWorkflow(workflowId), async () => workflowStore.setWorkflows(await client.listWorkflows())),
    updateWorkflow: (def: WorkflowDef) =>
      mutate(() => client.updateWorkflow(def), async () => workflowStore.setWorkflows(await client.listWorkflows())),
    duplicateWorkflow: (def: WorkflowDef) =>
      mutate(
        async () => {
          const taken = new Set((await client.listWorkflows()).map((w) => w.id));
          let id = `${def.id}-copy`;
          for (let n = 2; taken.has(id); n += 1) id = `${def.id}-copy-${n}`;
          await client.createWorkflow({ ...def, id, name: `${def.name} copy` });
        },
        async () => workflowStore.setWorkflows(await client.listWorkflows()),
      ),
    deleteRun: (runId: string) =>
      mutate(() => client.deleteRun(runId), () => workflowStore.removeRun(runId)),
    clearFinished: () =>
      mutate(
        () => client.clearFinishedRuns(),
        async () => workflowStore.setRuns(await client.listRuns()),
      ),
    restart: (runId: string) => steer(() => client.restartRun(runId)),
    pause: (runId: string) => steer(() => client.pauseRun(runId)),
    resume: (runId: string) => steer(() => client.resumeRun(runId)),
    stop: (runId: string, mode: StopMode) => steer(() => client.stopRun(runId, mode)),
    keepRunning: (runId: string) => steer(() => client.keepRunning(runId)),
    setBreakpoint: (runId: string, stepId: string, on: boolean) =>
      steer(() => client.setBreakpoint(runId, stepId, on)),
    resumeFrom: (runId: string, stepId: string) =>
      steer(() => client.resumeRunFrom(runId, stepId)),
    review: (runId: string, decision: ReviewDecision, note?: string) =>
      steer(() => client.reviewRun(runId, decision, note)),
    message: (runId: string, target: string, text: string) =>
      steer(async () => {
        await client.sendRunMessage(runId, target, text);
        return client.getRun(runId);
      }),
    redo: (runId: string, request: RedoRequest) => steer(() => client.redoRun(runId, request)),
    cancelRedo: (runId: string) => steer(() => client.cancelRedo(runId)),
  };
}

export type WorkflowActions = ReturnType<typeof workflowActions>;
