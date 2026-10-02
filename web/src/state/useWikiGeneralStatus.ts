import { useCallback, useEffect, useState } from "react";
import type { EngineClient } from "../engine-client/EngineClient";
import { messageOf, reportAsyncError } from "../util/reportError";
import type { DiagramGenerationStatus, WikiGeneralStatus } from "./types";

const IDLE: WikiGeneralStatus = {
  state: "idle",
  error: null,
  has_wiki_general: false,
  stale: false,
  empty: false,
};

/** Status+trigger tracking for the wiki-general background run, in the shape of
 * useDiagramGeneration but not built on it: this kind's status carries extra fields
 * (has_wiki_general, stale) no other kind has, so it needs its own fetch/merge, not a bare
 * SkillRunKind pass-through. generate/cancel still reuse the generic per-kind methods (see
 * EngineClient.ts); update() is its own method since it hits a dedicated route, not /generate. */
export function useWikiGeneralStatus(engineClient: EngineClient): WikiGeneralStatus & {
  trigger: () => void;
  update: () => void;
  stop: () => void;
} {
  const [status, setStatus] = useState<WikiGeneralStatus>(IDLE);

  // Only ever touches has_wiki_general/stale -- state/error belong exclusively to the job-state ping
  // and trigger()/stop()'s own optimistic updates. A full-object refetch here would be racy: clearing
  // stale pages before a new run starts (prepare_new_run) deletes index.md, which fires the
  // content-changed ping below *before* the backend job flips to "generating" -- a refetch that
  // clobbered `state` would momentarily show "idle" (and an enabled Generate button) mid-run.
  const refetchArtifact = useCallback(() => {
    engineClient
      .getWikiGeneralStatus()
      .then((next) =>
        setStatus((previous) => ({
          ...previous,
          has_wiki_general: next.has_wiki_general,
          stale: next.stale,
          empty: next.empty,
        })),
      )
      .catch((cause: unknown) => reportAsyncError("wiki-general status fetch", cause));
  }, [engineClient]);

  useEffect(() => {
    let cancelled = false;
    // The one full-object fetch: nothing else has set state/error/has_wiki_general yet.
    engineClient
      .getWikiGeneralStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((cause: unknown) => reportAsyncError("wiki-general status fetch", cause));
    // The job-state ping (generating/idle/error) merges over has_wiki_general, which it never
    // carries; an "idle" transition also means a run just finished, so refetch to see whether it
    // actually produced the artifact rather than waiting on the separate content-changed ping below.
    const unsubscribeStatus = engineClient.subscribeDiagramStatus("wiki-general", (next) => {
      if (cancelled) return;
      setStatus((previous) => ({ ...previous, ...next }));
      if (next.state === "idle") refetchArtifact();
    });
    // The FileWatcher ping on .codechroma/wiki-general/index.md — catches a change made outside this
    // run (another tab, a file edited by hand) that the job-state ping above would never see.
    const unsubscribeChanged = engineClient.subscribeDiagram("wiki-general", () => {
      if (!cancelled) refetchArtifact();
    });
    return () => {
      cancelled = true;
      unsubscribeStatus();
      unsubscribeChanged();
    };
  }, [engineClient, refetchArtifact]);

  // Shared by trigger()/update() below: both start a run via a POST that isn't near-instant (the
  // generate route also clears stale pages and syncs the plain wiki first) -- same client-side
  // in-flight guard and optimistic flip useDiagramGeneration's trigger() carries, just against
  // whichever route the caller passes.
  const runJob = useCallback(
    (start: () => Promise<DiagramGenerationStatus>) => {
      if (status.state === "generating") return;
      setStatus((previous) => ({ ...previous, state: "generating", error: null }));
      start()
        .then((next) => setStatus((previous) => ({ ...previous, ...next })))
        .catch((cause: unknown) =>
          setStatus((previous) => ({ ...previous, state: "error", error: messageOf(cause) })),
        );
    },
    [status.state],
  );

  const trigger = useCallback(
    () => runJob(() => engineClient.generateDiagram("wiki-general")),
    [engineClient, runJob],
  );

  const update = useCallback(
    () => runJob(() => engineClient.updateWikiGeneral()),
    [engineClient, runJob],
  );

  const stop = useCallback(() => {
    engineClient
      .cancelDiagram("wiki-general")
      .then((next) => setStatus((previous) => ({ ...previous, ...next })))
      .catch((cause: unknown) => reportAsyncError("wiki-general cancel", cause));
  }, [engineClient]);

  return { ...status, trigger, update, stop };
}
