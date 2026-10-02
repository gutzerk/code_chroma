import { type CSSProperties } from "react";
import type { EpicAcceptanceCriterion } from "../../../state/types";
import { doneGlyph } from "../doneGlyph";
import { CopyBlockButton } from "./CopyBlockButton";

const GAP_COLOR = "#f87171";

export interface AcceptanceCriterionBlockProps {
  criterion: EpicAcceptanceCriterion;
  /** The closing scope item's title + color, or null when `closes_scope_id` didn't resolve (the
   * skill named an id that isn't in this brief's scope) -- still renders the red gap badge, just
   * without a real title to show. */
  closingScope: { title: string; color: string } | null;
}

/** One checklist row plus a colored trace badge naming the scope item that closes it -- or a red
 * "no task" badge when `closes_scope_id` is null, the canvas's most visible signal that a criterion
 * has nothing implementing it yet. */
export function AcceptanceCriterionBlock({
  criterion,
  closingScope,
}: AcceptanceCriterionBlockProps) {
  const isGap = criterion.closes_scope_id === null;
  const badgeColor = isGap ? GAP_COLOR : (closingScope?.color ?? GAP_COLOR);

  return (
    <div
      className={["epic-brief-ac-block", isGap ? "epic-brief-ac-block--gap" : ""]
        .filter(Boolean)
        .join(" ")}
      style={{ "--ac-badge": badgeColor } as CSSProperties}
      data-testid="epic-brief-ac-block"
    >
      <span className="epic-brief-ac-glyph">{doneGlyph(criterion.done)}</span>
      <span className="epic-brief-ac-text">
        <CopyBlockButton text={criterion.text} />
        {criterion.text}
      </span>
      <div
        className="epic-brief-trace-badge"
        data-testid={isGap ? "epic-brief-gap-badge" : "epic-brief-trace-badge"}
      >
        <span className="epic-brief-trace-dot" />
        {isGap
          ? "⚠ no task in any scope item"
          : `→ ${closingScope?.title ?? criterion.closes_scope_id}`}
      </div>
    </div>
  );
}
