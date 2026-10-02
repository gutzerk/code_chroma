import type { ReactNode } from "react";
import { SkillOutputFeed } from "./SkillOutputFeed";

export interface DiagramStatusPanelProps {
  /** The view's CSS/test-id prefix ("c1", "patterns", "epics") — styles key off it per view. */
  kind: string;
  /** Defaults to `{kind}-empty-state`; the generating panel overrides it with `{kind}-generating`. */
  testId?: string;
  /** Optional data-node-id so the view's fit key can frame the panel (C1's "c1-status"). */
  nodeId?: string;
  children: ReactNode;
}

/** The empty / generating status panel every diagram view used to inline — same class either way
 * (the generating panel is styled as an empty state), only the test id tells them apart. */
export function DiagramStatusPanel({ kind, testId, nodeId, children }: DiagramStatusPanelProps) {
  return (
    <div
      className={`${kind}-empty-state`}
      data-testid={testId ?? `${kind}-empty-state`}
      {...(nodeId ? { "data-node-id": nodeId } : {})}
    >
      {children}
    </div>
  );
}

export interface DiagramGeneratingPanelProps {
  kind: string;
  nodeId?: string;
  /** The skill run's progress lines (useSkillOutput). */
  lines: string[];
  children: ReactNode;
  /** Optional stop handler — when present, a "Stop" button lets the user cancel this background
   * run instead of waiting for it (a multi-minute `claude -p` job). */
  onStop?: () => void;
}

/** The "Generating…" panel plus its live skill-output feed, wired with the view's test ids. */
export function DiagramGeneratingPanel({
  kind,
  nodeId,
  lines,
  children,
  onStop,
}: DiagramGeneratingPanelProps) {
  return (
    <DiagramStatusPanel kind={kind} testId={`${kind}-generating`} nodeId={nodeId}>
      {children}
      {onStop && (
        <div className="generating-stop-row">
          <button type="button" className="generating-stop-button" onClick={onStop}>
            Stop
          </button>
        </div>
      )}
      <SkillOutputFeed lines={lines} testId={`${kind}-generation-output`} />
    </DiagramStatusPanel>
  );
}

export interface DiagramRelationshipsSvgProps {
  kind: string;
  width: number;
  height: number;
  children: ReactNode;
}

/** The relationship-arrows `<svg>` wrapper each diagram view sizes from its dagre layout. */
export function DiagramRelationshipsSvg({
  kind,
  width,
  height,
  children,
}: DiagramRelationshipsSvgProps) {
  return (
    <svg
      className={`${kind}-relationships`}
      data-testid={`${kind}-relationships`}
      width={width}
      height={height}
    >
      {children}
    </svg>
  );
}
