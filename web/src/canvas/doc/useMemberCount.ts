import { useEffect, useState } from "react";
import type { EngineClient } from "../../engine-client/EngineClient";

const counts = new WeakMap<EngineClient, Map<string, Promise<number>>>();

/** The member count of a hierarchy node (cached per client), 0 when unknown or on failure. */
function memberCountOf(client: EngineClient, nodeId: string): Promise<number> {
  let perClient = counts.get(client);
  if (!perClient) counts.set(client, (perClient = new Map()));
  let pending = perClient.get(nodeId);
  if (!pending) {
    pending = Promise.resolve()
      .then(() => client.getNode(nodeId))
      .then((node) => node?.child_count ?? 0)
      .catch(() => 0);
    perClient.set(nodeId, pending);
  }
  return pending;
}

/** The child count of the graph node a block points at (0 until known); drives the `▸ N members` chip. */
export function useMemberCount(client: EngineClient, nodeId: string | null | undefined): number {
  const [state, setState] = useState<{ id: string | null | undefined; n: number }>({ id: nodeId, n: 0 });
  useEffect(() => {
    if (!nodeId) return;
    let live = true;
    void memberCountOf(client, nodeId).then((n) => {
      if (live) setState({ id: nodeId, n });
    });
    return () => {
      live = false;
    };
  }, [client, nodeId]);
  return state.id === nodeId ? state.n : 0;
}
