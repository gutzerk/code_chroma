import { useEffect, useRef } from "react";
import { useXtermSession } from "../terminal/useXtermSession";
import { useAgentStartError } from "./agentStore";

/** The xterm body of one agent window, attached to that agent's long-lived PTY on the bridge.
 * Closing this socket detaches only — the bridge keeps the process running, which is what makes a
 * minimized (display:none, still mounted) window and even a page reload survivable. */
export function AgentTerminal({
  workspace,
  running,
  hidden = false,
  kind = "claude",
  focusRequest = 0,
}: {
  workspace: string;
  running: boolean;
  hidden?: boolean;
  kind?: string;
  /** Bumping this focuses the terminal once it is visible (the dock's open-and-type shortcut). */
  focusRequest?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startError = useAgentStartError(workspace);
  const { focus } = useXtermSession(containerRef, {
    agent: kind,
    workspace,
    enabled: running,
    hidden,
    closedNotice: "\r\n[detached]\r\n",
  });

  useEffect(() => {
    if (focusRequest === 0 || hidden || !running) return undefined;
    const timer = setTimeout(focus, 0);
    return () => clearTimeout(timer);
  }, [focusRequest, hidden, running, focus]);

  if (!running) {
    return (
      <div
        className="agent-window-idle"
        data-testid={`agent-window-idle-${workspace}`}
        role={startError ? "alert" : undefined}
      >
        {startError ?? "This agent failed to start. Close it and create a new one on the same branch to retry."}
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
