import { useCallback, useRef, useState } from "react";
import { messageOf } from "../util/reportError";
import { fetchProviderModels } from "./llmSettingsClient";

const NO_MODELS: string[] = [];

/** Loads each connection's model catalog once and caches the ids; `load` resolves to them. */
export function useProviderModels() {
  const [catalog, setCatalog] = useState<Record<string, string[]>>({});
  const cache = useRef<Record<string, Promise<string[]>>>({});

  const load = useCallback((providerId: string): Promise<string[]> => {
    const cached = cache.current[providerId];
    if (cached) return cached;
    const request = fetchProviderModels(providerId)
      .then((result) => result.models.map((m) => m.id))
      .catch((err) => {
        // A failed catalog is not cached, so the next pick retries it.
        delete cache.current[providerId];
        console.warn(`model catalog for ${providerId}: ${messageOf(err)}`);
        return NO_MODELS;
      })
      .then((ids) => {
        setCatalog((c) => ({ ...c, [providerId]: ids }));
        return ids;
      });
    cache.current[providerId] = request;
    return request;
  }, []);

  const modelsOf = (providerId: string | null | undefined): string[] =>
    (providerId && catalog[providerId]) || NO_MODELS;

  return { load, modelsOf };
}
