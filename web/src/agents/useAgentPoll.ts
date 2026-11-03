import { useEffect, useRef } from "react";

/** Calls `read` while `enabled` and on every status change; repeats every `intervalMs` only while the agent runs and the page is visible. */
export function useAgentPoll(agentId: string, status: string, enabled: boolean, intervalMs: number, read: (isLive: () => boolean) => Promise<unknown>): void {
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const isLive = () => live;
    const tick = () => void readRef.current(isLive).catch(() => undefined);
    tick();
    const timer = status === "running" ? window.setInterval(() => document.visibilityState === "visible" && tick(), intervalMs) : undefined;
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [agentId, status, enabled, intervalMs]);
}
