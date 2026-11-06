import { useEffect, useRef } from "react";
import type { AgentStatus } from "../state/types";

/** Calls `read` while `enabled` and on every status change; repeats every `intervalMs` only while the agent is working (other statuses re-read on each change) and the page is visible. */
export function useAgentPoll(agentId: string, status: AgentStatus, enabled: boolean, intervalMs: number, read: (isLive: () => boolean) => Promise<unknown>): void {
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const isLive = () => live;
    const tick = () => void readRef.current(isLive).catch(() => undefined);
    tick();
    const timer = status === "working" ? window.setInterval(() => document.visibilityState === "visible" && tick(), intervalMs) : undefined;
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [agentId, status, enabled, intervalMs]);
}
