import { useSyncExternalStore } from "react";
import type { EngineClient } from "../engine-client/EngineClient";
import { Store } from "../state/createStore";
import type { RedoRequest, ReviewDecision, Run, StopMode, WorkflowDef } from "./types";

const NO_WORKFLOWS: WorkflowDef[] = [];
const NO_RUNS: Run[] = [];
const HIGHLIGHT_MS = 1600;

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

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Loads workflows and runs, then re-fetches off every `run` ping; returns the unsubscribe fn. */
export function bindWorkflows(client: EngineClient): () => void {
  let disposed = false;
  workflowStore.reset();
  const refreshAll = (): void => {
    void Promise.all([client.listWorkflows(), client.listRuns()])
      .then(([workflows, runs]) => {
        if (disposed) return;
        workflowStore.setWorkflows(workflows);
        workflowStore.setRuns(runs);
      })
      .catch((err) => { if (!disposed) workflowStore.setError(message(err)); });
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
      .catch((err) => { if (!disposed) workflowStore.setError(message(err)); })
      .finally(() => {
        inFlight.delete(runId);
        if (!disposed && dirty.delete(runId)) refreshRun(runId);
      });
  };
  const unsubscribe = client.subscribeRuns((event) => {
    if (!event) return refreshAll();
    refreshRun(event.runId);
  });
  return () => { disposed = true; unsubscribe(); };
}

/** Runs one steer command and folds the returned Run into the store; failures surface as an error line. */
async function steer(command: () => Promise<Run>): Promise<void> {
  try {
    workflowStore.setError(null);
    workflowStore.upsertRun(await command());
  } catch (err) {
    workflowStore.setError(message(err));
  }
}

/** The run commands the UI issues, bound to one client. */
export function workflowActions(client: EngineClient) {
  return {
    start: async (workflowId: string): Promise<void> => {
      await steer(async () => {
        const run = await client.startRun(workflowId);
        workflowStore.setActiveRun(run.id);
        return run;
      });
    },
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
