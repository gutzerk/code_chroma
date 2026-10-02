import { useCallback, useEffect, useState } from "react";
import type { EngineClient, SkillRunKind } from "../engine-client/EngineClient";
import { messageOf, reportAsyncError } from "../util/reportError";
import type { DiagramGenerationOptions, DiagramGenerationStatus } from "./types";

const IDLE: DiagramGenerationStatus = { state: "idle", error: null };

/** Generic status+trigger tracking for a diagram type's background `claude -p` job, lifted from
 * useC1Generation's original body, then keyed by kind so C1, Patterns and the change review all
 * share it. */
export function useDiagramGeneration(
  engineClient: EngineClient,
  kind: SkillRunKind,
): DiagramGenerationStatus & {
  trigger: (options?: DiagramGenerationOptions) => void;
  stop: () => void;
} {
  const [status, setStatus] = useState<DiagramGenerationStatus>(IDLE);

  useEffect(() => {
    let cancelled = false;
    engineClient
      .getDiagramStatus(kind)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((cause: unknown) => reportAsyncError(`${kind} status fetch`, cause));
    const unsubscribe = engineClient.subscribeDiagramStatus(kind, (next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [engineClient, kind]);

  const trigger = useCallback(
    (options?: DiagramGenerationOptions) => {
      // Client-side in-flight guard: never issue a second POST — and never risk a second `claude`
      // process on a kind that's mid-run — while this diagram's run is already generating. This
      // reads `status` from the closure, so a generate fired right after the view (re)mounts while
      // its status is still "generating" re-attaches to the in-flight run (the subscribe keeps
      // tracking it) instead of starting a new one. Mirrors the brief hook's same guard.
      if (status.state === "generating") return;
      engineClient
        .generateDiagram(kind, options)
        .then(setStatus)
        .catch((cause: unknown) => setStatus({ state: "error", error: messageOf(cause) }));
    },
    [engineClient, kind, status.state],
  );

  const stop = useCallback(() => {
    // The server resets the job to idle and pings `{kind}-status`, which lands here through the
    // subscription above — the POST's own return is only a fallback if that ping races ahead.
    engineClient
      .cancelDiagram(kind)
      .then(setStatus)
      .catch((cause: unknown) => reportAsyncError(`${kind} cancel`, cause));
  }, [engineClient, kind]);

  return { ...status, trigger, stop };
}
