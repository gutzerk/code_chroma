import { useEffect, useState } from "react";
import type { AgentRecord } from "../../state/types";
import { agentStatusLabel } from "../statusRollup";

/** "<cli> · <branch> · <status>", the agent subtitle every agent list shows. */
export function agentMeta(agent: AgentRecord): string {
  return [agent.resolved_cli ?? agent.kind, agent.branch, agentStatusLabel(agent.status)].join(" · ");
}

/** Elapsed time as m:ss (minutes keep counting past an hour). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** A live m:ss since `since`, ticking every second; null without a start time. */
export function useElapsed(since: string | null | undefined): string | null {
  const start = since ? Date.parse(since) : Number.NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (Number.isNaN(start)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [start]);
  return Number.isNaN(start) ? null : formatElapsed(now - start);
}
