import { useCallback, useEffect } from "react";
import { layoutStore, useLayoutState } from "../canvas/layout/layoutStore";
import { useEngineClient } from "../engine-client/EngineClientContext";
import { ensureNotificationPermission, statusChangeKind } from "./agentNotifications";
import { useAgentClient } from "./AgentClientContext";
import { flagDiagramsReady } from "./agentDiagramsReady";
import { agentQuestionStore } from "./agentQuestions";
import { startAgentStatusSync } from "./agentStatusSync";
import { agentStore, useActiveWorkspace, useAgents, useGitPreflight, usePendingClose } from "./agentStore";
import { agentDockStore } from "./agentDockStore";
import { promptNavStore } from "./prompts/promptNavStore";
import { CloseAgentDialog } from "./CloseAgentDialog";
import { GitInitDialog } from "./GitInitDialog";
import { AgentToastLayer } from "./toasts/AgentToastLayer";
import { ensureWorktrees, refreshWorktrees, settleRemovedWorktree } from "./worktreeActions";
import { worktreeStore } from "./worktreeStore";
import { WorkspaceStatusBanner } from "./WorkspaceStatusBanner";
import { confirmCloseAgentWindow } from "./windowActions";
import { MockAgentClient } from "./mockAgentClient";

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

  // Seen marking, toast clean-up, the desktop shell's agent summary and commands, ⌘⇧J in a browser.
  useEffect(() => startAgentStatusSync(agentClient), [agentClient]);

  // Mock bridge only, opt-in: a demo ask_user question on the mock agent client's question canvas.
  useEffect(() => {
    if (!import.meta.env.DEV || import.meta.env.VITE_ENGINE_BRIDGE_URL || !import.meta.env.VITE_DEV_ASK_QUESTION) return undefined;
    if (!(agentClient instanceof MockAgentClient)) return undefined;
    let uninstall: (() => void) | undefined;
    let cancelled = false;
    void import("../canvas/doc/question/devAskQuestion").then((m) => {
      if (!cancelled) uninstall = m.installDevAskQuestion(agentClient.questionEngine);
    });
    return () => {
      cancelled = true;
      uninstall?.();
    };
  }, [agentClient]);

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
        // The terminal's own scrollback is erased by the bridge's output stream; the prompt list is ours to drop.
        else if (message.type === "agent-history-cleared") promptNavStore.clear(message.id);
        // The bridge counted the agent's open questions; a shown window refetches its card.
        else if (message.type === "agent-questions") {
          agentStore.setOpenQuestions(message.id, message.open_questions);
          agentQuestionStore.refresh(message.id);
        }
        else if (message.type === "agent-status") {
          const { type: _type, id, status, ...fields } = message;
          const previous = agentStore.getAgent(id)?.status;
          agentStore.applyStatus(id, status, fields);
          const after = agentStore.getAgent(id);
          if (!after) return;
          // A finished "Draw a diagram" task may have written into its own forked worktree, where
          // the canvas never looks -- badge its rail row so the result is one click away.
          const finished =
            statusChangeKind(previous, after.status) === "done" || (previous === "working" && after.status === "idle");
          if (finished && after.context_kind === "task") {
            void flagDiagramsReady(id);
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
      <AgentToastLayer />
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
