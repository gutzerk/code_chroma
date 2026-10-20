import { useEffect, useRef } from "react";
import { useSelectedAgent } from "./terminalPanelStore";
import { useXtermSession } from "./useXtermSession";
import { useResizableSize } from "../canvas/useResizableSize";
import { shellStore, useShellState } from "../shell/shellStore";
import "./terminalDock.css";

/** Bottom panel hosting a real PTY terminal (xterm.js) wired to a TerminalSession — spawns
 * a plain login shell rooted at the analyzed repo (--repo-path; src/codechroma/terminal/server.py),
 * not a chat-style message list. It docks under the canvas rather than beside it so the C1
 * inspector can own the full-height right edge; a top-edge handle resizes its height. */
export function TerminalPanel({
  hidden = false,
  leftInset = 0,
  rightInset = 0,
}: {
  hidden?: boolean;
  leftInset?: number;
  rightInset?: number;
}) {
  const shellHeight = useShellState().terminal.height;
  const agent = useSelectedAgent();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { size, isResizing, handleProps, resetSize } = useResizableSize(panelRef, {
    axis: "y",
    edge: "top",
    minHeight: 160,
    maxViewportFraction: 0.6,
  });
  const { scheduleRefit } = useXtermSession(containerRef, {
    agent,
    hidden,
    closedNotice: "\r\n[session closed]\r\n",
  });

  // Drive reflow directly off the drag too, so content reflows even if the ResizeObserver misses a
  // tick; both drivers feed the same debounced refit, so the extra calls just coalesce.
  useEffect(() => {
    scheduleRefit();
  }, [size, shellHeight, scheduleRefit]);

  // A drag persists its height through the shell store (which clamps to its own minimum).
  useEffect(() => {
    if (isResizing || !size) return;
    shellStore.setTerminalHeight(size.height);
    resetSize();
  }, [size, isResizing, resetSize]);

  return (
    <div
      className={`terminal-panel terminal-dock${hidden ? " terminal-panel-hidden" : ""}${
        isResizing ? " terminal-panel-resizing" : ""
      }`}
      data-testid="terminal-panel"
      ref={panelRef}
      style={{ left: leftInset, right: rightInset, height: size?.height ?? shellHeight }}
    >
      <div
        className="terminal-panel-resize-handle"
        data-testid="terminal-panel-resize-handle"
        aria-hidden="true"
        {...handleProps}
      />
      <div
        className="terminal-panel-container"
        ref={containerRef}
        data-testid="terminal-panel-container"
      />
    </div>
  );
}
