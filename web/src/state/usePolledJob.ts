import { useEffect, useState } from "react";
import { reportAsyncError } from "../util/reportError";

const DEFAULT_POLL_INTERVAL_MS = 1000;

/** The one "while a job is running, poll its state and progress lines on one shared timer" loop.
 *
 * useEpicBrief and useDiagramTypeInterview used to carry byte-identical copies of this effect (the
 * latter's doc said so). Owns the output lines (cleared whenever the job isn't running); pushes
 * each polled state through `onState`. `fetchState`/`fetchOutput` must be stable references
 * (useMemo/useCallback in the caller) — a null fetch means "nothing to poll" and clears the lines. */
export function usePolledJob<TJob>(
  isRunning: boolean,
  fetchState: (() => Promise<TJob>) | null,
  onState: (next: TJob) => void,
  fetchOutput: (() => Promise<string[]>) | null,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): string[] {
  const [outputLines, setOutputLines] = useState<string[]>([]);

  useEffect(() => {
    if (!isRunning || !fetchState || !fetchOutput) {
      setOutputLines([]);
      return;
    }
    let cancelled = false;
    const pollOutput = () => {
      fetchOutput()
        .then((lines) => {
          if (!cancelled) setOutputLines(lines);
        })
        .catch((cause: unknown) => reportAsyncError("job output poll", cause));
    };
    pollOutput();
    const timer = setInterval(() => {
      fetchState()
        .then((next) => {
          if (!cancelled) onState(next);
        })
        .catch((cause: unknown) => reportAsyncError("job state poll", cause));
      pollOutput();
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isRunning, fetchState, fetchOutput, onState, intervalMs]);

  return outputLines;
}
