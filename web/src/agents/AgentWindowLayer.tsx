import { useCallback, useEffect } from "react";
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
import { AgentWindow } from "./AgentWindow";
import { branchStore } from "./branchStore";
import { CloseAgentDialog } from "./CloseAgentDialog";
import { GitInitDialog } from "./GitInitDialog";
import { settleActiveWorkspace } from "./branchActions";
import { WorkspaceStatusBanner } from "./WorkspaceStatusBanner";
import { confirmCloseAgentWindow, restoreAgentWindow } from "./windowActions";

/**
 * Everything that lives above the canvas in *screen* coordinates: one window per agent and the
 * git-init dialog.
 *
 * ⚠ These windows are deliberately not registered with feature 002's collision store — a different
 * coordinate space entirely, and explicitly out of scope there.
 */
export function AgentWindowLayer() {
  const agentClient = useAgentClient();
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

  const refreshBranchList = useCallback(() => {
    void agentClient
      .getBranch()
      .then(branchStore.setBranch)
      .catch(() => {
        // A bridge that doesn't know about branches yet leaves the switcher blank.
      });
  }, [agentClient]);

  useEffect(refreshBranchList, [refreshBranchList]);

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
            // restoreAgentWindow, not a branch switch: the agent that just pinged may belong to a
            // branch main no longer has checked out, but its own worktree runs regardless, and its
            // window is reachable either way (AgentWindow.tsx no longer hides it for that reason).
            notifyAgentStatus(before, kind, () => restoreAgentWindow(agentClient, before.id));
          }
          // A finished "Draw a diagram" task may have written into its own forked worktree, where
          // the canvas never looks -- badge its rail row so the result is one click away.
          if (kind === "idle" && before?.context_kind === "task") {
            void flagDiagramsReady(message.id);
          }
        } else if (message.type === "workspace-activated") agentStore.setActiveWorkspace(message.id);
        else if (message.type === "branch-changed") {
          // Settle against the ping's branch right away — the async re-read below isn't there yet, and
          // `settleActiveWorkspace` reads the current branch off the store. Then re-read the full
          // list: the ping carries only the new current branch, not the branches (one may have just
          // been created or deleted externally), so it can't rebuild the list on its own.
          branchStore.setBranch({ current: message.branch, branches: branchStore.getBranches() });
          settleActiveWorkspace(agentClient);
          refreshBranchList();
        }
      }),
    [engineClient, agentClient, refreshBranchList],
  );

  return (
    <div
      className="agent-layer"
      data-testid="agent-layer"
      // Which workspace the canvas is drawing, in the DOM: otherwise nothing on screen says so once a
      // workspace is `ready`, and a test has to infer it from an unrelated control's state.
      data-active-workspace={activeWorkspace}
    >
      <WorkspaceStatusBanner />
      {/* Every agent, minimized or not: AgentWindow hides with `display:none`, because unmounting
          would dispose the xterm and force a full reattach on every restore. */}
      {agents.map((agent) => (
        <AgentWindow key={agent.id} agent={agent} />
      ))}
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
