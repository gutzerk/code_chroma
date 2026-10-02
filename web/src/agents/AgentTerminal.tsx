import { useRef } from "react";
import { useXtermSession } from "../terminal/useXtermSession";

/** The xterm body of one agent window, attached to that agent's long-lived PTY on the bridge.
 * Closing this socket detaches only — the bridge keeps the process running, which is what makes a
 * minimized (display:none, still mounted) window and even a page reload survivable. */
export function AgentTerminal({
  workspace,
  running,
  hidden = false,
  kind = "claude",
}: {
  workspace: string;
  running: boolean;
  hidden?: boolean;
  kind?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useXtermSession(containerRef, {
    agent: kind,
    workspace,
    enabled: running,
    hidden,
    closedNotice: "\r\n[detached]\r\n",
  });

  if (!running) {
    return (
      <div className="agent-window-idle" data-testid={`agent-window-idle-${workspace}`}>
        This agent failed to start. Close it and create a new one on the same branch to retry.
      </div>
    );
  }
  return (
    <div
      className="agent-window-terminal"
      ref={containerRef}
      data-testid={`agent-terminal-${workspace}`}
    />
  );
}
