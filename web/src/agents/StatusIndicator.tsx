import type { CanonicalAgentStatus } from "../state/types";
import type { AttentionStatus } from "./statusRollup";

/** Chip wording per attention status: "2 waiting", "1 done", "1 failed". */
const CHIP_WORDS: Record<AttentionStatus, string> = {
  blocked: "waiting",
  error: "failed",
  done: "done",
};

/** One status shape: `dot` (8px) on tabs and strips, `icon` (16px) in agent lists. Purely visual. */
export function StatusIndicator({
  status,
  size = "dot",
  label,
  testId,
}: {
  status: CanonicalAgentStatus;
  size?: "dot" | "icon";
  /** Set to expose the indicator as an image; omitted, it is decorative. */
  label?: string;
  testId?: string;
}) {
  const icon = size === "icon";
  return (
    <span
      className={`status-ind${icon ? " status-ind--icon" : ""}`}
      data-status={status}
      data-testid={testId}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
    >
      {icon && status === "blocked" && "?"}
      {icon && status === "error" && "!"}
      {icon && status === "done" && (
        <svg className="status-ind-check" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/** The tab count next to a dot: solid for blocked, a quiet tint for error and done. */
export function StatusBadge({ status, count, testId }: { status: AttentionStatus; count: number; testId?: string }) {
  return (
    <span className="status-badge" data-status={status} data-testid={testId} aria-hidden="true">
      {count}
    </span>
  );
}

/** "2 waiting" / "1 done": a count of agents in one attention status. */
export function StatusChip({ status, count }: { status: AttentionStatus; count: number }) {
  return (
    <span className="status-chip" data-status={status} data-testid={`status-chip-${status}`}>
      {`${count} ${CHIP_WORDS[status]}`}
    </span>
  );
}
