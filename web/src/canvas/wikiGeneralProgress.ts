/** Parses wiki_general_pipeline.py's own "→ {completed}/{total} {job_label}" progress lines. */

export interface WikiGeneralProgress {
  completed: number;
  total: number;
  percent: number;
}

const PROGRESS_LINE = /^→ (\d+)\/(\d+) /;

/** The most recent progress line wins -- null while none has arrived yet (older phases/errors). */
export function parseWikiGeneralProgress(lines: string[]): WikiGeneralProgress | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = PROGRESS_LINE.exec(lines[i]);
    if (match === null) continue;
    const completed = Number(match[1]);
    const total = Number(match[2]);
    if (total <= 0) return null;
    return { completed, total, percent: Math.min(100, (completed / total) * 100) };
  }
  return null;
}

/** "~Ns left" / "~Nm left", extrapolated from the average time per completed job so far -- null
 * before the first job completes (no rate yet) or once nothing remains. Only ever an estimate: the
 * very first job (resolve-undetermined) is one slow batched call, so the first few minutes can
 * over- or under-shoot until later, faster per-file jobs pull the average back in line. */
export function estimateTimeRemaining(
  progress: WikiGeneralProgress | null,
  elapsedMs: number,
): string | null {
  if (progress === null || progress.completed <= 0) return null;
  const remainingJobs = progress.total - progress.completed;
  if (remainingJobs <= 0) return null;
  const msPerJob = elapsedMs / progress.completed;
  const seconds = (msPerJob * remainingJobs) / 1000;
  return seconds < 60 ? `~${Math.max(1, Math.round(seconds))}s left` : `~${Math.round(seconds / 60)}m left`;
}
