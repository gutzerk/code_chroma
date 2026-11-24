import { useCallback, useState } from "react";
import type { AgentModelChoices } from "../state/types";
import { messageOf } from "../util/reportError";
import type { AgentClient } from "./agentClient";

const lastKnown = new WeakMap<AgentClient, AgentModelChoices>();
const inFlight = new WeakMap<AgentClient, Promise<AgentModelChoices>>();

/** The long-press model menu's list: the last answer is shown at once (cache) while `refresh` asks the bridge again. */
export function useAgentModels(client: AgentClient) {
  const [choices, setChoices] = useState<AgentModelChoices | null>(() => lastKnown.get(client) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!client.agentModels) return;
    let request = inFlight.get(client);
    if (!request) {
      request = client.agentModels().finally(() => inFlight.delete(client));
      inFlight.set(client, request);
    }
    setLoading(true);
    request
      .then((next) => {
        lastKnown.set(client, next);
        setChoices(next);
        setError(null);
      })
      .catch((err) => setError(messageOf(err)))
      .finally(() => setLoading(false));
  }, [client]);

  return { choices, loading, error, refresh, supported: Boolean(client.agentModels) };
}
