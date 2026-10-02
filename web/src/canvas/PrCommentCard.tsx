import type { ReactNode } from "react";
import type { PrReviewComment } from "../state/types";

export interface PrCommentCardProps {
  comment: PrReviewComment;
  /** e.g. "c1-change-summary-comment" -- also drives the "--linked" and "-body" classes. */
  classPrefix: string;
  metaClassName: string;
  testId: string;
  onOpen: (nodeId: string, symbol: string) => void;
  meta: ReactNode;
}

/** One clickable, keyboard-accessible PR comment card -- opens its linked node when it has one.
 * Shared by ImpactChangeSummary's floating panel and InspectorChangeReview's inspector-level list. */
export function PrCommentCard({
  comment,
  classPrefix,
  metaClassName,
  testId,
  onOpen,
  meta,
}: PrCommentCardProps) {
  const openTarget = () => {
    if (comment.node_id) onOpen(comment.node_id, comment.symbol || "");
  };
  return (
    <div
      className={`${classPrefix}${comment.node_id ? ` ${classPrefix}--linked` : ""}`}
      data-testid={testId}
      role={comment.node_id ? "button" : undefined}
      tabIndex={comment.node_id ? 0 : undefined}
      aria-label={comment.node_id ? `Open ${comment.symbol} in the code inspector` : undefined}
      onClick={comment.node_id ? (event) => { event.stopPropagation(); openTarget(); } : undefined}
      onKeyDown={
        comment.node_id
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                openTarget();
              }
            }
          : undefined
      }
    >
      <span className={metaClassName}>{meta}</span>
      <p className={`${classPrefix}-body`}>{comment.body}</p>
    </div>
  );
}
