import type { RedoCardData, Run, WorkflowDef } from "./types";

/** The record for a step in the run's current attempt, falling back to the latest record of that step. */
export function currentRecord(run: Run, stepId: string): Run["steps"][number] | undefined {
  const mine = run.steps.filter((s) => s.stepId === stepId);
  return mine.find((s) => s.attempt === run.attempt) ?? mine[mine.length - 1];
}

/** Recomputes the Reruns / Keeps / Sets aside lists for redoing from one step. */
export function computeRedoCard(workflow: WorkflowDef, run: Run, from: string, note = ""): RedoCardData {
  const ids = workflow.steps.map((s) => s.id);
  const index = Math.max(0, ids.indexOf(from));
  const reruns = ids.slice(index);
  const keeps = ids.slice(0, index);
  const setsAside = reruns.filter((id) => {
    const rec = currentRecord(run, id);
    return rec !== undefined && rec.status !== "pending";
  });
  return { reruns, keeps, setsAside, note };
}

/** True when the picked step is later than the suggested one, so some affected steps keep stale output. */
export function isLaterThanSuggested(workflow: WorkflowDef, suggested: string, picked: string): boolean {
  const ids = workflow.steps.map((s) => s.id);
  return ids.indexOf(picked) > ids.indexOf(suggested);
}

/** The step records shown for one attempt, in workflow order (kept rows carry fromAttempt). */
export function stepsForAttempt(run: Run, workflow: WorkflowDef, attempt: number): Run["steps"] {
  const out: Run["steps"] = [];
  for (const def of workflow.steps) {
    const rec =
      attempt === run.attempt
        ? currentRecord(run, def.id)
        : run.attempts.find((a) => a.n === attempt)?.steps?.find((s) => s.stepId === def.id);
    if (rec) out.push(rec);
  }
  return out;
}

/** Splits `@slug rest` into a routing target (step id or "run") and the text. */
export function parseTarget(workflow: WorkflowDef | undefined, raw: string): { target: string; text: string } {
  const match = /^@([\w-]+)\s+([\s\S]*)$/.exec(raw.trim());
  const step = match && workflow?.steps.find((s) => s.slug === match[1]);
  return step && match ? { target: step.id, text: match[2] } : { target: "run", text: raw.trim() };
}
