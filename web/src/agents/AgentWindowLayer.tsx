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
import { selectAgent } from "../shell/selectAgent";
import { branchStore } from "./branchStore";
import { CloseAgentDialog } from "./CloseAgentDialog";
import { GitInitDialog } from "./GitInitDialog";
import { settleActiveWorkspace, settleRemovedWorkspace } from "./branchActions";
import { WorkspaceStatusBanner } from "./WorkspaceStatusBanner";
import { confirmCloseAgentWindow } from "./windowActions";

/** Agent sync and dialogs: live list/branch updates, notifications, git-init and close confirmation; the terminals live in the shell panels. */
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
            // Opens the agents panel on it, not a branch switch: its worktree runs regardless.
            notifyAgentStatus(before, kind, () => selectAgent(agentClient, before.id));
          }
          // A finished "Draw a diagram" task may have written into its own forked worktree, where
          // the canvas never looks -- badge its rail row so the result is one click away.
          if (kind === "idle" && before?.context_kind === "task") {
            void flagDiagramsReady(message.id);
          }
        } else if (message.type === "branch-changed") {
          // Settle against the ping's branch right away — the async re-read below isn't there yet, and
          // `settleActiveWorkspace` reads the current branch off the store. Then re-read the full
          // list: the ping carries only the new current branch, not the branches (one may have just
          // been created or deleted externally), so it can't rebuild the list on its own.
          branchStore.setBranch({ current: message.branch, branches: branchStore.getBranches() });
          settleActiveWorkspace(agentClient);
          refreshBranchList();
        } else if (message.type === "branch-removed") {
          settleRemovedWorkspace(agentClient, message.id);
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
