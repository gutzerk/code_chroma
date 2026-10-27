import { useCallback, useEffect } from "react";
import { layoutStore, useLayoutState } from "../canvas/layout/layoutStore";
import { useEngineClient } from "../engine-client/EngineClientContext";
import {
  ensureNotificationPermission,
  isAgentWindowFocused,
  notifyAgentStatus,
  statusChangeKind,
} from "./agentNotifications";
import { useAgentClient } from "./AgentClientContext";
import { flagDiagramsReady } from "./agentDiagramsReady";
import { agentStore, useActiveWorkspace, useAgents, useGitPreflight, usePendingClose } from "./agentStore";
import { agentDockStore } from "./agentDockStore";
import { CloseAgentDialog } from "./CloseAgentDialog";
import { GitInitDialog } from "./GitInitDialog";
import { ensureWorktrees, refreshWorktrees, settleRemovedWorktree } from "./worktreeActions";
import { worktreeStore } from "./worktreeStore";
import { WorkspaceStatusBanner } from "./WorkspaceStatusBanner";
import { confirmCloseAgentWindow, restoreAgentWindow } from "./windowActions";

/** Agent lifecycle, live updates, workspace status and launch/close dialogs. Terminals live in ActivityPanel. */
export function AgentWindowLayer() {
  const agentClient = useAgentClient();
  const { agentsMode } = useLayoutState();
  const engineClient = useEngineClient();
  const agents = useAgents();
  const activeWorkspace = useActiveWorkspace();
  const preflight = useGitPreflight();
  const pendingClose = usePendingClose();
  const pendingAgent = pendingClose ? agents.find((agent) => agent.id === pendingClose) : undefined;

  const refresh = useCallback(() => {
    void agentClient
      .list()
      .then(agentStore.setList)
      .catch(() => {
        // A bridge that doesn't know about agents yet simply has none; nothing to report.
      });
  }, [agentClient]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    agentDockStore.retain(agents.map((agent) => agent.id));
    layoutStore.reconcileAgents(agents.map((agent) => agent.id));
  }, [agents]);

  // Boot: restore every worktree tab (creating wt-N only when there are none) and select the active one.
  useEffect(() => {
    void ensureWorktrees(agentClient).catch(() => {
      // A bridge without worktree tabs leaves the strip empty; the canvas still works.
    });
  }, [agentClient]);

  useEffect(ensureNotificationPermission, []);

  // A monitor unplugged mid-session shrinks the browser window in place -- pull any window that
  // landed off-screen back into view (see agentStore.reclampToViewport).
  useEffect(() => {
    window.addEventListener("resize", agentStore.reclampToViewport);
    return () => window.removeEventListener("resize", agentStore.reclampToViewport);
  }, []);

  // Live pings: another window (or the bridge itself) can add, remove or re-status an agent. Each
  // one is applied in place rather than triggering a refetch — a status flip must not rebuild the
  // list and remount every window's terminal.
  useEffect(
    () =>
      engineClient.subscribeAgents((message) => {
        if (message.type === "agent-added") agentStore.upsert(message.agent);
        else if (message.type === "agent-removed") agentStore.remove(message.id);
        else if (message.type === "agent-status") {
          const before = agentStore.getAgent(message.id);
          const kind = statusChangeKind(before?.status, message.status);
          agentStore.setStatus(message.id, message.status);
          if (kind && before && !isAgentWindowFocused(before)) {
            notifyAgentStatus(before, kind, () => {
              agentDockStore.activate(before.id);
              restoreAgentWindow(agentClient, before.id);
            });
          }
          // A finished "Draw a diagram" task may have written into its own forked worktree, where
          // the canvas never looks -- badge its rail row so the result is one click away.
          if (kind === "idle" && before?.context_kind === "task") {
            void flagDiagramsReady(message.id);
          }
        } else if (message.type === "branch-removed") {
          if (worktreeStore.has(message.id)) void settleRemovedWorktree(agentClient, message.id);
          else {
            void refreshWorktrees(agentClient).catch(() => {
              // A stale tab list is better than none.
            });
          }
        }
      }),
    [engineClient, agentClient],
  );

  return (
    <div
      className="agent-layer"
      data-testid="agent-layer"
      // Which workspace the canvas is drawing, in the DOM: otherwise nothing on screen says so once a
      // workspace is `ready`, and a test has to infer it from an unrelated control's state.
      data-active-workspace={activeWorkspace}
      // Full-screen mode shows one window itself; the floating ones are hidden.
      data-hidden={agentsMode === "full"}
    >
      <WorkspaceStatusBanner />
      {preflight && preflight.state !== "ready" && (
        <GitInitDialog
          preflight={preflight}
          onDismiss={() => agentStore.setGitPreflight(null)}
          onReady={() => {
            agentStore.setGitPreflight(null);
            refresh();
          }}
        />
      )}
      {pendingAgent && (
        <CloseAgentDialog
          title={pendingAgent.title}
          worktree={pendingAgent.worktree}
          onCancel={() => agentStore.setPendingClose(null)}
          onConfirm={(deleteWorktree) =>
            confirmCloseAgentWindow(agentClient, pendingAgent.id, deleteWorktree)
          }
        />
      )}
    </div>
  );
}
