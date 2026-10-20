import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRecord } from "../state/types";
import { useDragOffset } from "../canvas/useDragOffset";
import { useResizableSize } from "../canvas/useResizableSize";
import { useAgentClient } from "./AgentClientContext";
import { agentStore } from "./agentStore";
import runAgentIcon from "../icons/run-agent.svg";
import { AgentLed } from "./AgentLed";
import { AgentTerminal } from "./AgentTerminal";
import { CreatePrButton } from "./CreatePrButton";
import { closeAgentWindow, minimizeAgentWindow, persist } from "./windowActions";
import { agentDockStore } from "./agentDockStore";

/** One movable agent window, in *screen* coordinates above the canvas — deliberately not in canvas
 * space, so it never scales with zoom and stays readable at any magnification. Minimizing hides it
 * with `display:none` rather than unmounting: the xterm buffer dies with the DOM node.
 *
 * Floating visibility depends on `minimized` or whether it is docked, never on which branch main has
 * checked out: an agent's terminal runs in its own worktree (`AgentTerminal`'s
 * `workspace={agent.id}`), so a checkout on
 * main cannot touch it either way, and forcing that checkout just to *look* at an already-running
 * agent has no technical reason behind it — see AgentRail.tsx's own comment on the incident that
 * motivated dropping it: main can refuse the checkout (a dirty tree) and then the window has no way
 * to become reachable again. */
export function AgentWindow({ agent, docked = false }: { agent: AgentRecord; docked?: boolean }) {
  const agentClient = useAgentClient();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const geometry = agent.window;
  const hidden = geometry.minimized;

  // Delta on top of live `geometry.x/y`, not a one-time seed -- a later reclamp still shows on screen.
  const { offset, isDragging, handleProps, resetOffset } = useDragOffset({
    onEnd: (dragOffset) => {
      const next = { x: geometry.x + dragOffset.x, y: geometry.y + dragOffset.y };
      resetOffset?.();
      persist(agentClient, agent.id, { x: next.x, y: next.y, z: agentStore.bringToFront(agent.id) });
    },
  });

  const { size, isResizing, handleProps: resizeProps, resetSize } = useResizableSize(panelRef, {
    minWidth: 360,
  });

  // Drops a stale manual resize once `geometry` itself changes for some other reason (e.g.
  // agentStore.reclampToViewport shrinking it) -- guarded on the *value* actually changing, not
  // just re-running on every render, so it never wipes out the resize the user just finished.
  const priorSize = useRef({ width: geometry.width, height: geometry.height });
  useEffect(() => {
    const prior = priorSize.current;
    priorSize.current = { width: geometry.width, height: geometry.height };
    if (isResizing) return;
    if (prior.width === geometry.width && prior.height === geometry.height) return;
    resetSize();
  }, [geometry.width, geometry.height, isResizing, resetSize]);

  const [recovering, setRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  const recover = useCallback(async () => {
    setRecovering(true);
    setRecoverError(null);
    try {
      agentStore.upsert(await agentClient.recreateWorktree(agent.id));
    } catch (err) {
      setRecoverError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecovering(false);
    }
  }, [agentClient, agent.id]);

  const running = agent.status !== "stopped" && agent.status !== "exited";

  if (docked) return null;

  return (
    <div
      ref={panelRef}
      className={`agent-window${hidden ? " agent-window-hidden" : ""}${
        isDragging || isResizing ? " agent-window-moving" : ""
      }`}
      data-testid={`agent-window-${agent.id}`}
      style={{
        left: geometry.x + offset.x,
        top: geometry.y + offset.y,
        width: size?.width ?? geometry.width,
        height: size?.height ?? geometry.height,
        zIndex: geometry.z,
      }}
      onPointerDownCapture={() => persist(agentClient, agent.id, { z: agentStore.bringToFront(agent.id) })}
    >
      <div className="agent-window-title" data-testid={`agent-title-${agent.id}`} {...handleProps}>
        <img className="agent-window-icon" src={runAgentIcon} alt="" aria-hidden="true" />
        <AgentLed status={agent.status} />
        <span className="agent-window-name">{agent.title}</span>
        {agent.resolved_cli && (
          <span className="agent-window-cli" title={`launched as ${agent.resolved_cli}`}>
            {agent.resolved_cli}
          </span>
        )}
        <span className="agent-window-branch">{agent.branch}</span>
        {agent.worktree_lost && (
          <>
            <span
              className="agent-panel-warning"
              title={agent.worktree}
              data-testid={`agent-worktree-lost-${agent.id}`}
            >
              worktree lost
            </span>
            <button
              type="button"
              className="agent-window-pr-button"
              disabled={recovering}
              data-testid={`agent-recreate-worktree-${agent.id}`}
              onClick={() => void recover()}
            >
              Recreate
            </button>
          </>
        )}
        {!agent.worktree_lost && !agent.source_pr && <CreatePrButton agent={agent} />}
        <button
          type="button"
          className="agent-window-button"
          aria-label={`Dock ${agent.title} on the canvas`}
          data-testid={`agent-dock-${agent.id}`}
          onClick={() => agentDockStore.attach(agent.id)}
        >
          ⇤
        </button>
        <button
          type="button"
          className="agent-window-button"
          aria-label={`Minimize ${agent.title}`}
          onClick={() => minimizeAgentWindow(agentClient, agent.id)}
        >
          –
        </button>
        <button
          type="button"
          className="agent-window-button"
          aria-label={`Close ${agent.title}`}
          data-testid={`agent-close-${agent.id}`}
          onClick={() => closeAgentWindow(agentClient, agent.id)}
        >
          ×
        </button>
      </div>
      {agent.worktree_lost ? (
        <div className="agent-window-idle" data-testid={`agent-window-idle-${agent.id}`}>
          {recoverError ??
            "This agent's worktree is gone. Recreate it to get the directory back, or close the agent."}
        </div>
      ) : (
        <AgentTerminal workspace={agent.id} running={running} hidden={hidden} kind={agent.kind} />
      )}
      <div
        className="agent-window-resize-handle"
        data-testid={`agent-resize-${agent.id}`}
        aria-hidden="true"
        {...resizeProps}
      />
    </div>
  );
}
