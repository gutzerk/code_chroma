import { useCallback, useEffect, useState } from "react";
import type { EngineClient } from "../engine-client/EngineClient";
import type { ResearchJobState } from "./types";

const IDLE: ResearchJobState = { job_key: "", state: "idle", error: null, answer: null };
const POLL_INTERVAL_MS = 1000;

/** Ask a question and poll its background job until done -- no websocket push, since asking a
 * research question is a one-off action, not a status the user watches continuously like a
 * diagram generation. */
export function useResearch(engineClient: EngineClient): {
  job: ResearchJobState;
  ask: (query: string) => void;
} {
  const [job, setJob] = useState<ResearchJobState>(IDLE);

  useEffect(() => {
    if (job.state !== "generating") return;
    let cancelled = false;
    const timer = setInterval(() => {
      void engineClient.getResearchAnswer(job.job_key).then((next) => {
        if (!cancelled) setJob(next);
      });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [engineClient, job.state, job.job_key]);

  const ask = useCallback(
    (query: string) => {
      void engineClient.askResearch(query).then(setJob);
    },
    [engineClient],
  );

  return { job, ask };
}
