import type { ImpactBlockChange } from "../state/types";
import { inspectorStore } from "./inspectorStore";
import { PrCommentCard } from "./PrCommentCard";

export interface InspectorChangeReviewProps {
  change: ImpactBlockChange;
}

const STATUS_LABEL: Record<string, string> = {
  added: "Added",
  modified: "Modified",
  removed: "Removed",
  deleted: "Deleted",
};

/** Drills into a changed file — pushed (not opened), so `‹ Back` returns to the review. Same
 * `component::<path>` id convention used elsewhere for a file block clicked on the diagram itself
 * (see plan_resolver.py and graph/builder.py). */
function pushFileInInspector(path: string): void {
  const name = path.split("/").pop() ?? path;
  inspectorStore.push(`component::${path}`, name);
}

/**
 * The Impact change review for one box — status, before/after/why, the files behind it, and any PR
 * review comments — rendered as the top of an inspector level rather than a floating canvas panel.
 * Prose is empty until the codechroma-review-diagram skill has written a review, so a box can legitimately
 * render with just a status and a file list.
 */
export function InspectorChangeReview({ change }: InspectorChangeReviewProps) {
  const hasProse = Boolean(change.before || change.after || change.explanation);

  return (
    <div
      className={`impact-change-review impact-change-review--${change.status}`}
      data-testid="inspector-change-review"
      data-change-node-id={change.node_id}
      data-status={change.status}
    >
      <div className="impact-change-review-header" data-testid="inspector-change-review-header">
        <span className="impact-change-review-name">Change review</span>
        <span className="impact-change-badge" data-testid="inspector-change-review-status">
          {STATUS_LABEL[change.status] ?? change.status}
        </span>
      </div>
      {hasProse ? (
        <>
          {change.before && (
            <div className="impact-change-section impact-change-section--before">
              <span className="impact-change-section-label">Before</span>
              <p className="impact-change-section-text">{change.before}</p>
            </div>
          )}
          {change.after && (
            <div className="impact-change-section impact-change-section--after">
              <span className="impact-change-section-label">After</span>
              <p className="impact-change-section-text">{change.after}</p>
            </div>
          )}
          {change.explanation && (
            <div className="impact-change-section impact-change-section--why">
              <span className="impact-change-section-label">Why</span>
              <p className="impact-change-section-text">{change.explanation}</p>
            </div>
          )}
        </>
      ) : (
        <p className="impact-change-unreviewed" data-testid="inspector-change-review-unreviewed">
          Not explained yet — the review is still being written.
        </p>
      )}
      {change.files.length > 0 && (
        <div className="impact-change-files" data-testid="inspector-change-review-files">
          {change.files.map((file) => (
            <div
              key={file.path}
              className="impact-change-file"
              data-testid="impact-change-file"
              data-status={file.status}
              role="button"
              tabIndex={0}
              aria-label={`Open ${file.path} in the code inspector`}
              onClick={(event) => {
                event.stopPropagation();
                pushFileInInspector(file.path);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  pushFileInInspector(file.path);
                }
              }}
            >
              <div className="impact-change-file-row">
                <span className="impact-change-file-status">
                  {STATUS_LABEL[file.status] ?? file.status}
                </span>
                <span className="impact-change-file-path">{file.path}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {change.pr_comments.length > 0 && (
        <div className="impact-change-comments" data-testid="inspector-change-review-comments">
          <span className="impact-change-section-label">PR comments</span>
          {change.pr_comments.map((comment, index) => (
            <PrCommentCard
              key={`${comment.path}-${comment.line}-${index}`}
              comment={comment}
              classPrefix="impact-change-comment"
              metaClassName="impact-change-comment-meta"
              testId="impact-change-comment"
              onOpen={(nodeId, symbol) => inspectorStore.push(nodeId, symbol)}
              meta={
                <>
                  {comment.author || "unknown"}
                  {comment.symbol ? ` · ${comment.symbol}()` : ""}
                  {comment.line !== null ? ` · line ${comment.line}` : ""}
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
