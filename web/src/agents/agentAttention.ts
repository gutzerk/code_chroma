import { agentOpenQuestionCounts } from "../canvas/doc/question/useOpenAgentQuestions";
import { layoutStore } from "../canvas/layout/layoutStore";
import type { AgentRecord, AgentStatus, WorktreeRecord } from "../state/types";
import { agentStore } from "./agentStore";
import { effectiveStatus, rollup, type StatusRollup } from "./statusRollup";
import { worktreeStore } from "./worktreeStore";

/** The agents the panel lists for worktree tab `tab`: its own plus any written before tabs existed. */
export function panelAgents(agents: readonly AgentRecord[], tab: string | null): AgentRecord[] {
  return agents.filter((agent) => !agent.workspace || !tab || agent.workspace === tab);
}

/** Whether `agent` belongs to worktree tab `tab` (its own workspace, or one it shares). */
export function belongsToTab(agent: AgentRecord, tab: string): boolean {
  return agent.workspace === tab || agent.shares_workspace_with === tab;
}

/** Each tab's roll-up of its own agents; the selected tab drops `done` (the user is already looking at it). */
export function tabRollups(
  tabs: readonly WorktreeRecord[],
  agents: readonly AgentRecord[],
  questionCounts: ReadonlyMap<string, number>,
  selectedTab: string | null,
): Map<string, StatusRollup> {
  return new Map(
    tabs.map((tab) => {
      const statuses = agents
        .filter((agent) => belongsToTab(agent, tab.id))
        .map((agent) => effectiveStatus(agent, questionCounts.get(agent.id) ?? 0));
      return [tab.id, rollup(statuses, { hideDone: tab.id === selectedTab })];
    }),
  );
}

/** The agent whose terminal the panel shows: the selection when it is on this tab, else the tab's first. */
export function viewedAgentId(): string | null {
  const { agentsMode, selectedAgentId } = layoutStore.getState();
  if (agentsMode === "collapsed") return null;
  const agents = panelAgents(agentStore.getAgents(), worktreeStore.getActiveId());
  if (agents.some((agent) => agent.id === selectedAgentId)) return selectedAgentId;
  return agents[0]?.id ?? null;
}

/** True while the user can actually see `id`: shown in the open panel of the active tab, in a focused page. */
export function isLookingAtAgent(id: string): boolean {
  if (typeof document === "undefined") return false;
  if (!document.hasFocus() || document.visibilityState !== "visible") return false;
  return viewedAgentId() === id;
}

/** Every agent's effective status right now, open ask_user questions included. */
export function currentEffectiveStatuses(): Map<string, AgentStatus> {
  const questions = agentOpenQuestionCounts();
  return new Map(
    agentStore.getAgents().map((agent) => [agent.id, effectiveStatus(agent, questions.get(agent.id) ?? 0)]),
  );
}
