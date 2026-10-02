import { useState } from "react";
import type { EngineClient } from "../engine-client/EngineClient";
import { scheduleRefreshDiffs } from "./refreshDiffs";

export interface UseAcceptDiffResult {
  handleAccept: (nodeId: string) => Promise<boolean>;
  isAccepting: boolean;
  acceptError: string | undefined;
}

/** Shared accept-button logic for every diff render site (Block, TreeNode, DeletedDiffOverlay).
 * `onAccepted` runs after a successful commit — Block/TreeNode pass `expansionStore.hideCode` so
 * an inline code/diff view closes itself on accept; DeletedDiffOverlay has no code view to close,
 * so it omits it. Keeping this one place avoids the accept-then-close wrapper being copy-pasted
 * into every render site that wants it. */
export function useAcceptDiff(
  engineClient: EngineClient,
  onAccepted?: (nodeId: string) => void,
): UseAcceptDiffResult {
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | undefined>(undefined);

  async function handleAccept(nodeId: string): Promise<boolean> {
    setIsAccepting(true);
    setAcceptError(undefined);
    try {
      await engineClient.acceptDiff(nodeId);
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : "accept failed");
      return false;
    } finally {
      setIsAccepting(false);
    }
    // Don't block the button on this: it re-walks every pending diff's ancestor chain and
    // refetches every expanded block's children, which can take seconds on a large repo. The
    // commit itself is already done — the live "changed" broadcast will also trigger this same
    // refresh in the background, this call just covers the mock bridge, which has no live push.
    // Through the scheduler so those two collapse into one run instead of racing each other.
    scheduleRefreshDiffs(engineClient);
    onAccepted?.(nodeId);
    return true;
  }

  return { handleAccept, isAccepting, acceptError };
}
