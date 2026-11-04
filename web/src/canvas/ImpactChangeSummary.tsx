import { useState, type CSSProperties } from "react";
import { summarizeImpact, firstSentence } from "./doc/impactGlanceLogic";
import { guardedClick, providerGate, useGroupAvailability } from "../llm-settings/useGroupAvailability";
import type { ImpactChangedFile, ImpactChanges, DiagramGenerationStatus, PrReviewComment, PrWorkspace } from "../state/types";
import { useImpactChanges } from "../state/useSidecar";
import { inspectorStore } from "./inspectorStore";
import { PrCommentCard } from "./PrCommentCard";
import { SkillOutputFeed } from "./SkillOutputFeed";
import { PanelDragGrip, usePanelDragResize } from "./usePanelDragResize";
import { BOARD_GAP, CARD_WIDTH, ImpactBoard, useImpactBounds } from "./ImpactBoard";
import { useActiveWorkspace } from "../agents/agentStore";
import { usePrWorkspaces } from "../pr/prStore";

export interface ImpactChangeSummaryProps {
  /** The review job's state plus its re-run trigger, from useImpactChangesSidecar in RootCanvas. */
  review: DiagramGenerationStatus & { rereview: () => void; stop: () => void; loading: boolean };
  /** Live progress lines while the review run works, from useSkillOutput in RootCanvas. */
  outputLines?: string[];
  /** False in a read-only workspace: no Re-review button, and no "press Re-review" to press. */
  canGenerate?: boolean;
}

const STATUS_MARKER: Record<string, string> = {
  added: "+",
  modified: "~",
  removed: "-",
  deleted: "-",
};

function CommentRow({ comment }: { comment: PrReviewComment }) {
  const location = comment.symbol
    ? `${comment.symbol}()${comment.line !== null ? ` · line ${comment.line}` : ""}`
    : comment.path
      ? `${comment.path}${comment.line !== null ? `:${comment.line}` : ""}`
      : null;
  return (
    <PrCommentCard
      comment={comment}
      classPrefix="impact-change-summary-comment"
      metaClassName="impact-change-summary-comment-author"
      testId="impact-change-summary-comment"
      onOpen={(nodeId, symbol) => inspectorStore.open(nodeId, symbol)}
      meta={
        <>
          {comment.author || "unknown"}
          {location ? ` · ${location}` : ""}
        </>
      }
    />
  );
}

const PILLS = [
  { key: "modified", label: "modified" },
  { key: "added", label: "new" },
  { key: "deleted", label: "deleted" },
  { key: "tests", label: "tests" },
] as const;

/** What the board compares: the PR against its base in a PR workspace, else the working tree against HEAD. */
export function compareLabelOf(activeWorkspace: string, prs: readonly PrWorkspace[]): string {
  const pr = prs.find((candidate) => candidate.id === activeWorkspace);
  return pr ? `PR #${pr.number} vs ${pr.base_ref || "base"}` : "WORKING TREE vs HEAD";
}

/** The board's header strip: what is compared, the one-line change title and the four count pills. */
function ImpactStrip({ changes }: { changes: ImpactChanges }) {
  const summary = summarizeImpact(changes);
  const compare = compareLabelOf(useActiveWorkspace(), usePrWorkspaces());
  const boxes = changes.blocks.length;
  const fallback = `${changes.changed_file_count} changed file${changes.changed_file_count === 1 ? "" : "s"} across ${boxes} box${boxes === 1 ? "" : "es"}`;
  const title = firstSentence(changes.summary) || fallback;
  return (
    <div className="impact-strip" data-testid="impact-strip">
      <span className="impact-strip-head">
        <span className="impact-strip-label">{compare}</span>
        <span className="impact-strip-title" title={changes.summary || undefined}>
          {title}
        </span>
      </span>
      <span className="impact-strip-pills">
        {PILLS.map(({ key, label }) => (
          <span key={key} className={`impact-pill-count impact-pill-count--${key}`} data-testid={`impact-count-${key}`}>
            {summary[key]} {label}
          </span>
        ))}
      </span>
    </div>
  );
}

/** The outside files as one line: a folder's files folded into "dir (n)", a lone file by its name. */
export function outsideSummaryOf(files: readonly ImpactChangedFile[]): string {
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.path.split("/");
    const dir = parts.slice(Math.max(0, parts.length - 3), -1).join("/");
    byDir.set(dir, [...(byDir.get(dir) ?? []), parts[parts.length - 1]]);
  }
  return [...byDir]
    .map(([dir, names]) => (names.length === 1 ? names[0] : `${dir || "(root)"} (${names.length})`))
    .join(" · ");
}

const LEGEND = [
  { chip: "ADD", cls: "add", text: "new file or symbol" },
  { chip: "MODIFY", cls: "modify", text: "existing code changed" },
  { chip: "DELETE", cls: "delete", text: "hatched ghost, struck through" },
] as const;

/** The board's legend card: chips, size bar, hero and removed edges, collapsed pills, thick border. */
function ImpactLegend() {
  return (
    <div className="impact-legend" data-testid="impact-legend">
      <span className="impact-legend-title">LEGEND</span>
      {LEGEND.map((row) => (
        <span key={row.chip} className="impact-legend-row">
          <span className={`impact-chip impact-chip--${row.cls}`}>{row.chip}</span>
          {row.text}
        </span>
      ))}
      <span className="impact-legend-row">
        <span className="impact-size-bar impact-legend-bar" aria-hidden="true">
          <span className="impact-size-add" style={{ width: 14 }} />
          <span className="impact-size-del" style={{ width: 26 }} />
        </span>
        size of the change, + / &minus;
      </span>
      <span className="impact-legend-row">
        <span className="impact-legend-line impact-legend-line--hero" aria-hidden="true" />
        &#9733; hero: what the change does
      </span>
      <span className="impact-legend-row">
        <span className="impact-legend-line impact-legend-line--removed" aria-hidden="true" />
        link that no longer exists
      </span>
      <span className="impact-legend-row">
        <span className="impact-legend-pill" aria-hidden="true" />
        unchanged or minor, collapsed
      </span>
      <span className="impact-legend-row">
        <span className="impact-legend-thick" aria-hidden="true" />
        thick border = biggest change
      </span>
    </div>
  );
}

/** Changed files no box on the diagram covers, as the board's dashed "outside this slice" strip. */
function OutsideSlice({ files }: { files: ImpactChangedFile[] }) {
  const [open, setOpen] = useState(false);
  const line = outsideSummaryOf(files);
  return (
    <div className="impact-outside" data-testid="impact-change-summary-unassigned">
      <div className="impact-outside-head">
        <span className="impact-outside-label">OUTSIDE THIS SLICE</span>
        <span className="impact-outside-count" title={line}>
          {line}
        </span>
        <button
          type="button"
          className="impact-outside-toggle"
          data-testid="impact-outside-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "hide ▾" : "show ▸"}
        </button>
      </div>
      {open && files.map((file) => <FileRow key={file.path} file={file} />)}
    </div>
  );
}

function FileRow({ file }: { file: ImpactChangedFile }) {
  return (
    <div
      className="impact-change-summary-file"
      data-testid="impact-change-summary-file"
      data-status={file.status}
    >
      <span
        className={`impact-change-summary-file-marker impact-change-summary-file-marker--${file.status}`}
        aria-hidden="true"
      >
        {STATUS_MARKER[file.status] ?? "~"}
      </span>
      <span className="impact-change-summary-file-path">{file.path}</span>
    </div>
  );
}

/** The change review card, shown with the Impact board whenever the Impact diagram is on the canvas.
 *
 * Carries the one thing no individual block can: the change set as a whole — the agent's paragraph,
 * a diff-stat-style file list grouped by the block it landed on, and the changed files that live
 * nowhere on the diagram (surfaced rather than left to imply full coverage, same honesty rule as the
 * "+N more" block). It's also where the review's own state shows: writing, failed, or reviewing a
 * diff that has since moved on.
 *
 * Unlike DiffView/SidecarSummaryCard (screen-fixed chrome), this one is rendered as a child of
 * CanvasViewport — i.e. inside .canvas-content, RootCanvas.tsx — so it pans and zooms exactly like
 * an ordinary block: a big PR's file list shrinks into view the same way "zoom out" shrinks every
 * diagram box, and it scrolls off with the rest of the canvas on pan. It still has no data-node-id/
 * data-select-id, so collisionStore/marquee-select/fitAll (all opt-in by attribute, not by DOM
 * position) never pick it up. Draggable like DiffView, via useDragOffset — which already divides
 * screen-pixel drag deltas by the ambient canvas scale (measureScale), the same compensation every
 * other in-canvas draggable (a diagram's own box anchors) relies on, so dragging still tracks the cursor
 * 1:1 regardless of zoom level. */
export function ImpactChangeSummary({
  review,
  outputLines = [],
  canGenerate = true,
}: ImpactChangeSummaryProps) {
  const changes = useImpactChanges();
  const { panelRef, dragHandleProps, isDragging, style } = usePanelDragResize({
    draggable: true,
  });
  const isWriting = review.state === "generating";
  const providerAvailable = useGroupAvailability("diagrams");
  const blockCount = changes.blocks.length;
  const blocksWithFiles = changes.blocks.filter((block) => block.files.length > 0);
  const bounds = useImpactBounds();
  const showBoard = !review.loading && changes.changed_file_count > 0;
  // Beside the board the card sits in the legend column; before the board shows it floats left of the diagram.
  const cardStyle: CSSProperties = !showBoard && bounds ? { position: "absolute", left: bounds.left - CARD_WIDTH - BOARD_GAP, top: bounds.top } : {};

  const card = (
    <div
        ref={panelRef}
        className={`impact-change-summary${changes.stale ? " impact-change-summary--stale" : ""}${
          isDragging ? " impact-change-summary--dragging" : ""
        }`}
        data-testid="impact-change-summary"
        data-state={isWriting ? "generating" : review.state}
        data-stale={changes.stale}
        style={{ ...style, ...cardStyle }}
      >
        <div className="impact-change-summary-header" {...dragHandleProps}>
          <PanelDragGrip />
          <span className="impact-change-summary-title">Change review</span>
          <span className="impact-change-summary-counts" data-testid="impact-change-summary-counts">
            {blockCount} block{blockCount === 1 ? "" : "s"} · {changes.changed_file_count} file
            {changes.changed_file_count === 1 ? "" : "s"}
          </span>
          {canGenerate && (
            <button
              type="button"
              className="impact-change-summary-rereview"
              data-testid="impact-change-rereview"
              aria-disabled={isWriting || !providerAvailable}
              title={providerGate(providerAvailable).title}
              onClick={guardedClick(isWriting || !providerAvailable, review.rereview)}
            >
              {isWriting ? "Reviewing…" : "Re-review"}
            </button>
          )}
        </div>

        {review.loading ? (
          <p className="impact-change-summary-text" data-testid="impact-change-summary-loading">
            Loading changes… (a fresh workspace re-parses its changed files first)
          </p>
        ) : changes.changed_file_count === 0 ? (
          <p className="impact-change-summary-text" data-testid="impact-change-summary-empty">
            Nothing changed vs the last commit.
          </p>
        ) : (
          <>
            {changes.summary && <p className="impact-change-summary-text">{changes.summary}</p>}
            {!changes.has_review && !isWriting && (
              <p className="impact-change-summary-note" data-testid="impact-change-summary-unreviewed">
                {canGenerate
                  ? "Blocks are marked from git. Ask your AI assistant to explain them (the codechroma-review-diagram skill), or press Re-review."
                  : "Blocks are marked from git."}
              </p>
            )}
            {changes.stale && (
              <p className="impact-change-summary-note" data-testid="impact-change-summary-stale">
                This review covers an earlier version of the diff
                {isWriting ? " — writing an updated one…" : "."}
              </p>
            )}
            {blocksWithFiles.length > 0 && (
              <div className="impact-change-summary-files" data-testid="impact-change-summary-files">
                {blocksWithFiles.map((block) => (
                  <div key={block.node_id} className="impact-change-summary-file-group">
                    <span className="impact-change-summary-file-group-label">{block.name}</span>
                    {block.files.map((file) => (
                      <FileRow key={file.path} file={file} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {changes.general_pr_comments.length > 0 && (
          <div className="impact-change-summary-comments" data-testid="impact-change-summary-comments">
            <span className="impact-change-summary-file-group-label">PR comments</span>
            {changes.general_pr_comments.map((comment) => (
              <CommentRow key={`${comment.author}-${comment.created_at}`} comment={comment} />
            ))}
          </div>
        )}

        {isWriting && (
          <>
            <button
              type="button"
              className="impact-change-summary-stop"
              data-testid="impact-change-review-stop"
              onClick={review.stop}
            >
              Stop review
            </button>
            <SkillOutputFeed lines={outputLines} testId="impact-review-output" />
          </>
        )}

        {review.state === "error" && review.error && (
          <p className="impact-change-summary-error" data-testid="impact-change-summary-error">
            {review.error}
          </p>
        )}
      </div>
  );
  if (!showBoard) return card;
  return (
    <ImpactBoard
      changes={changes}
      header={<ImpactStrip changes={changes} />}
      outside={changes.unassigned.length > 0 ? <OutsideSlice files={changes.unassigned} /> : null}
      legend={<ImpactLegend />}
      review={card}
    />
  );
}
