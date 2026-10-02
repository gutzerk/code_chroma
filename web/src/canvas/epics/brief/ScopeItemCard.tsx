import { type CSSProperties } from "react";
import type { EpicScopeItem } from "../../../state/types";
import { TaskChip } from "./TaskChip";
import { CopyBlockButton } from "./CopyBlockButton";

/** Fixed palette, assigned by scope-item index -- the brief JSON never carries a color (Decisions:
 * "client-assigned", so the schema stays stable if the palette changes). */
const SCOPE_COLOR_PALETTE = [
  "#f472b6",
  "#fb923c",
  "#4ade80",
  "#22d3ee",
  "#c084fc",
  "#facc15",
  "#60a5fa",
  "#f87171",
];

export function colorForScopeIndex(index: number): string {
  return SCOPE_COLOR_PALETTE[index % SCOPE_COLOR_PALETTE.length];
}

/** Fallback swatch for a scope item with no assigned color -- out-of-scope cards never read it. */
export const DEFAULT_SCOPE_COLOR = "#8b93a7";

export interface ScopeItemCardProps {
  item: EpicScopeItem;
  color?: string;
}

/** One in-scope item: title + description + its own task list in a column inside the card -- a
 * card carries several tasks at once, never a lone one-task-per-card layout. An out-of-scope item
 * renders as the dimmed, task-less variant instead (color is irrelevant there and may be omitted).
 * Dashed border when `tasks_source === "draft"`, the same honesty convention Patterns uses for
 * `confirmed: null`. */
export function ScopeItemCard({ item, color = DEFAULT_SCOPE_COLOR }: ScopeItemCardProps) {
  if (!item.in_scope) {
    return (
      <div className="epic-brief-out-block" data-testid="epic-brief-out-block">
        <b className="epic-brief-out-block-title">{item.title}</b>
        {item.out_of_scope_ref && (
          <span className="epic-brief-tag" data-testid="epic-brief-out-of-scope-ref">
            {`→ ${item.out_of_scope_ref}`}
          </span>
        )}
      </div>
    );
  }

  const classes = [
    "epic-brief-scope-item",
    item.tasks_source === "draft" ? "epic-brief-scope-item--draft" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Test tasks pool into the brief's "Testing" subgroup, not the feature card -- the card shows
  // only the tasks that implement the feature itself, so the count matches what's rendered.
  const featureTasks = item.tasks.filter((task) => !task.is_test);

  return (
    <div
      className={classes}
      style={{ "--scope-item": color } as CSSProperties}
      data-testid="epic-brief-scope-item"
    >
      <div className="epic-brief-scope-item-head">
        <span className="epic-brief-scope-item-title">
          <CopyBlockButton text={item.title} />
          {item.title}
        </span>
        <span className="epic-brief-scope-item-count" data-testid="epic-brief-scope-item-count">
          {featureTasks.length} {featureTasks.length === 1 ? "task" : "tasks"}
        </span>
      </div>
      <p className="epic-brief-scope-item-desc">{item.description}</p>
      <div className="epic-brief-task-row">
        {featureTasks.map((task) => (
          <TaskChip key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}
