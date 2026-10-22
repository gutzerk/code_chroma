import { useEffect, useState } from "react";
import type { AgentClient, AgentUsage } from "../agentClient";

/** How often the open full screen re-reads the selected agent's usage between status changes. */
export const USAGE_POLL_MS = 5000;

/** 184000 → "184k", 1200000 → "1.2M", 950 → "950". */
export function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function percent(ratio: number): number {
  return Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
}

/** Reads the agent's usage while `enabled`, again on every status change and every poll tick. */
export function useAgentUsage(client: AgentClient, agentId: string, status: string, enabled: boolean) {
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  useEffect(() => {
    if (!enabled || !client.usage) return;
    let live = true;
    const read = () =>
      client.usage!(agentId).then(
        (next) => live && setUsage(next),
        () => undefined,
      );
    void read();
    const timer = window.setInterval(read, USAGE_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [client, agentId, status, enabled]);
  return enabled ? usage : null;
}

/** Context meter, tokens in/out, cache hit and cost (when priced) for the full-screen agent header. */
export function UsageStrip({ usage }: { usage: AgentUsage }) {
  const used = usage.contextWindow > 0 ? percent(usage.contextTokens / usage.contextWindow) : 0;
  return (
    <div className="agent-usage-strip" aria-label="Session usage" data-testid="agent-usage-strip">
      <div className="agent-usage-context">
        <span className="agent-usage-row">
          <span className="agent-usage-label">Context</span>
          <span>
            {compactTokens(usage.contextTokens)} / {compactTokens(usage.contextWindow)} · {used}%
          </span>
        </span>
        <span
          className="agent-usage-meter"
          role="meter"
          aria-label="Context used"
          aria-valuemin={0}
          aria-valuemax={usage.contextWindow}
          aria-valuenow={usage.contextTokens}
        >
          <span style={{ width: `${used}%` }} />
        </span>
      </div>
      <span className="agent-usage-divider" aria-hidden="true" />
      <div className="agent-usage-stat">
        <span className="agent-usage-label">Tokens</span>
        <span>
          {compactTokens(usage.inputTokens)} in · {compactTokens(usage.outputTokens)} out
        </span>
      </div>
      <div className="agent-usage-stat">
        <span className="agent-usage-label">Cache hit</span>
        <span>{percent(usage.cacheHitRatio)}%</span>
      </div>
      {usage.costUsd !== null && (
        <div className="agent-usage-stat">
          <span className="agent-usage-label">Cost</span>
          <span>${usage.costUsd.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
