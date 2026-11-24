import { useCallback, useState } from "react";
import type { AgentModelChoices } from "../state/types";
import { messageOf } from "../util/reportError";
import type { AgentClient } from "./agentClient";

/** How long a listed answer is reused before a press asks the bridge again. */
const FRESH_MS = 60_000;

interface Cached {
  at: number;
  request: Promise<AgentModelChoices>;
  choices?: AgentModelChoices;
}

const cache = new WeakMap<AgentClient, Cached>();

/** The long-press model menu's list: the last answer shows at once; `refresh` asks the bridge only when it is older than a minute. */
export function useAgentModels(client: AgentClient) {
  const [choices, setChoices] = useState<AgentModelChoices | null>(() => cache.get(client)?.choices ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!client.agentModels) return;
    let entry = cache.get(client);
    if (!entry || Date.now() - entry.at > FRESH_MS) {
      const request = client.agentModels();
      const next: Cached = { at: Date.now(), request, choices: entry?.choices };
      const previous = entry;
      // A failed listing gives way to the last good one (stale, so the next press retries); only this request's own entry is touched.
      request.then(
        (answer) => (next.choices = answer),
        () => {
          if (cache.get(client) !== next) return;
          if (previous?.choices) cache.set(client, { ...previous, request: Promise.resolve(previous.choices) });
          else cache.delete(client);
        },
      );
      cache.set(client, next);
      entry = next;
    }
    setLoading(true);
    entry.request
      .then((answer) => {
        setChoices(answer);
        setError(null);
      })
      .catch((err) => setError(messageOf(err)))
      .finally(() => setLoading(false));
  }, [client]);

  return { choices, loading, error, refresh, supported: Boolean(client.agentModels) };
}
