import { useEffect } from "react";
import { openFilesStore } from "./openFilesStore";
import type { EngineClient } from "../engine-client/EngineClient";

/** Re-reads every open file's node after each live ping so the code overlay follows edits on disk. */
export function useOpenFilesLiveRefresh(engineClient: EngineClient, liveVersion: number): void {
  useEffect(() => {
    if (liveVersion === 0) return undefined;
    let cancelled = false;
    for (const file of openFilesStore.getFiles()) {
      void engineClient
        .getNode(file.node_id)
        .then((node) => {
          if (!cancelled && node) openFilesStore.replace(node);
        })
        .catch(() => {
          // A node that no longer resolves (or a synthetic origin fragment) keeps its last source.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [engineClient, liveVersion]);
}
