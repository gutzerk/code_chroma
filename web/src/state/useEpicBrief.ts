import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineClient } from "../engine-client/EngineClient";
import { usePolledJob } from "./usePolledJob";
import type { EpicBriefJobState } from "./types";

const IDLE: EpicBriefJobState = { job_key: "", state: "idle", error: null, brief: null };

/** Tracks one epic's AI-brief job, bound to `itemId` -- fetches its current state on mount/itemId
 * change (a brief from an earlier session, or a job another tab already started), polls both job
 * state and progress lines on one shared timer while generating, and exposes `generate()` to start
 * a fresh run explicitly. A brief is keyed per epic, unlike diagram generation's per-repo kind. No
 * websocket push: generating a brief is a one-off action the user starts explicitly, not a status
 * watched continuously like a diagram generation. */
export function useEpicBrief(
  engineClient: EngineClient,
  itemId: string | null,
): {
  job: EpicBriefJobState;
  generate: (force?: boolean) => void;
  stop: () => void;
  outputLines: string[];
  loaded: boolean;
} {
  const [job, setJob] = useState<EpicBriefJobState>(IDLE);
  // Says whether the mount/itemId-change GET has answered at least once for the CURRENT itemId --
  // until it has, `job` is still the seed IDLE value, indistinguishable from "confirmed no brief."
  // Mirrors useDiagram.ts's `loaded`, which exists for the same reason.
  const [loaded, setLoaded] = useState(false);
  // Optimistic in-flight lock: a POST is only issued if no POST is already in flight, synchronously
  // set on send and cleared when it settles. `job.state` alone can't stop a second POST launched in
  // the same tick (a rapid double-click, or a generate before the mount GET resolves), because both
  // reads see the same not-yet-updated closure value. The ref is what makes the guard airtight on
  // the client; guarding against a run another tab/session started is the server's job (see the
  // route), since the client can't know that before its first GET answers.
  const inFlightRef = useRef(false);

  useEffect(() => {
    setLoaded(false);
    if (itemId === null) {
      setJob(IDLE);
      return;
    }
    let cancelled = false;
    void engineClient.getEpicBrief(itemId).then((next) => {
      if (cancelled) return;
      // Set before setJob: even an IDLE/error reply still counts as "checked," and this is the
      // case that most needs it -- no brief generated yet -- since that reply looks identical to
      // the seed value setJob would otherwise apply.
      setLoaded(true);
      setJob(next);
    });
    return () => {
      cancelled = true;
    };
  }, [engineClient, itemId]);

  const fetchState = useMemo(
    () => (itemId === null ? null : () => engineClient.getEpicBrief(itemId)),
    [engineClient, itemId],
  );
  const fetchOutput = useMemo(
    () => (itemId === null ? null : () => engineClient.getEpicBriefOutput(itemId)),
    [engineClient, itemId],
  );
  const outputLines = usePolledJob(job.state === "generating", fetchState, setJob, fetchOutput);

  const generate = useCallback(
    (force?: boolean) => {
      if (itemId === null) return;
      // Client-side in-flight guard: never issue a second POST (and on the live bridge, never risk
      // a second `claude` process) while this item's brief is already generating. Two layers: the
      // optimistic inFlightRef blocks a repeat POST before the server's "generating" state can ride
      // back into a re-render, and `job.state` blocks a generate fired once a poll has shown the run
      // (e.g. one another tab started) -- both stop the double-click/early-generate duplicate.
      if (inFlightRef.current || job.state === "generating") return;
      inFlightRef.current = true;
      void engineClient
        .generateEpicBrief(itemId, force)
        .then(setJob)
        .finally(() => {
          inFlightRef.current = false;
        });
    },
    [engineClient, itemId, job.state],
  );

  const stop = useCallback(() => {
    if (itemId === null) return;
    // The server resets the job to idle; the poll loop above (still ticking on `generating`) picks
    // up the new state on its next tick, and the POST's returned job is applied as a fallback too.
    void engineClient.cancelEpicBrief(itemId).then(setJob);
  }, [engineClient, itemId]);

  return { job, generate, stop, outputLines, loaded };
}
