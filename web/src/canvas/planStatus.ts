import type { PlanStep } from "../state/types";

/** Diff-style status buckets a card's kind collapses into, driving the green/blue/red accents
 * shared by the step cards (CardPanel) and the block frame (ChangeConnectionsOverlay). */
export type PlanStatus = "new" | "change" | "delete";

/** kind -> status: create/add introduce code (green), modify changes it (blue), delete removes it
 * (red). Unknown/absent kinds fall back to "change", matching the panel's default-to-modify. */
export function planStatusForKind(kind: PlanStep["kind"]): PlanStatus {
  switch (kind) {
    case "create":
    case "add":
      return "new";
    case "delete":
      return "delete";
    default:
      return "change";
  }
}

// A frame is drawn per node, but a node can hold steps of different kinds — surface the most notable
// one: deletion beats new code beats a plain change.
const STATUS_PRIORITY: Record<PlanStatus, number> = { delete: 2, new: 1, change: 0 };

/** The single status for a node's frame, picking the highest-priority kind across all its steps. */
export function planStatusForSteps(steps: PlanStep[]): PlanStatus {
  let best: PlanStatus = "change";
  for (const step of steps) {
    const status = planStatusForKind(step.kind);
    if (STATUS_PRIORITY[status] > STATUS_PRIORITY[best]) best = status;
  }
  return best;
}
