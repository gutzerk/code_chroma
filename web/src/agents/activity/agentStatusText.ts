import { useSyncExternalStore } from "react";
import { QUESTION_STRINGS as S } from "../../canvas/doc/question/questionStrings";
import type { AgentRecord, AgentStatus } from "../../state/types";
import { useOpenQuestionCount } from "../agentStore";
import { effectiveStatus, STATUS_LABELS } from "../statusRollup";

/** "<cli> · <branch> · <status>", the agent subtitle every agent list shows. */
export function agentMeta(agent: AgentRecord): string {
  return [agent.resolved_cli ?? agent.kind, agent.branch, STATUS_LABELS[agent.status]].join(" · ");
}

/** Elapsed time as m:ss (minutes keep counting past an hour). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const tickListeners = new Set<() => void>();
let tickTimer: number | undefined;
let tickNow = Date.now();

/** One shared 1 s clock for every shown timer; it runs only while at least one is subscribed. */
function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (tickTimer === undefined) {
    tickTimer = window.setInterval(() => {
      tickNow = Date.now();
      tickListeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size > 0) return;
    window.clearInterval(tickTimer);
    tickTimer = undefined;
  };
}

const noTick = () => () => {};
const getTick = () => tickNow;

/** A live m:ss since `since`, ticking every second; null without a start time. */
export function useElapsed(since: string | null | undefined): string | null {
  const start = since ? Date.parse(since) : Number.NaN;
  const shown = !Number.isNaN(start);
  // The first timer shown after an idle stretch must not start from the last stopped tick.
  if (shown && tickTimer === undefined) tickNow = Date.now();
  const now = useSyncExternalStore(shown ? subscribeTick : noTick, getTick);
  return shown ? formatElapsed(now - start) : null;
}

/** An agent's shown status (an open ask_user question raises it to `blocked`) and its spoken label. */
export function useAgentStatus(status: AgentStatus, agentId: string): { shown: AgentStatus; label: string } {
  const count = useOpenQuestionCount(agentId);
  const shown = effectiveStatus({ status }, count);
  const label = count > 0 ? `${STATUS_LABELS[shown]} · ${S.questionCount(count)}` : STATUS_LABELS[shown];
  return { shown, label };
}
