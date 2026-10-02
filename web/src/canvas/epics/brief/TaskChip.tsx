import type { BriefTask } from "../../../state/types";
import { CopyBlockButton, joinNonEmpty } from "./CopyBlockButton";

export interface TaskChipProps {
  task: BriefTask;
}

/** Joins a task chip's rendered pieces into the exact clipboard text -- the same pieces a user
 * sees, in the same order, so copying a chip gives back what the eye reads. */
function taskCopyText(task: BriefTask): string {
  return joinNonEmpty([task.parallel ? "[P]" : null, task.repo ?? null, `${task.id} ${task.text}`], " ");
}

/** One task's chip: its `[P]` parallel flag (if any), repo tag (if any), id, and text -- shared by
 * a scope item's own task row and the epic-level "prep" strip, the brief's only two places a task
 * renders. Each chip carries a copy button for its text. */
export function TaskChip({ task }: TaskChipProps) {
  return (
    <span className="epic-brief-task-chip" data-testid="epic-brief-task-chip">
      <CopyBlockButton text={taskCopyText(task)} />
      {task.parallel && <span className="epic-brief-task-pflag">[P]</span>}
      {task.repo && <span className="epic-brief-task-repo" data-testid="epic-brief-task-repo">
        {task.repo}
      </span>}
      {task.id} {task.text}
    </span>
  );
}
