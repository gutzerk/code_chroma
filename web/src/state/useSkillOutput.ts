import { useEffect, useRef, useState } from "react";
import type { EngineClient, SkillRunKind } from "../engine-client/EngineClient";
import { reportAsyncError } from "../util/reportError";
import type { DiagramGenerationStatus } from "./types";

/** Matches the bridge's own per-run cap (skill_agent._OUTPUT_LINES) — the server already trimmed. */
const MAX_LINES = 300;

/** Which headless run to follow — the bridge's SkillRunKind, one route pair and event type each. */
export type SkillOutputKind = SkillRunKind;

/** The live progress lines of a headless skill run, for the read-only feed the C1 view renders.
 *
 * Fetch-then-subscribe like useC1Generation, plus a catch-up read: the run is minutes long and the
 * canvas may open half-way through one, so the buffer the bridge kept is read once on mount rather
 * than starting the feed blank. `state` is passed in (not fetched) so the lines can be cleared the
 * moment a new run starts — the bridge clears its own buffer at exactly that point.
 *
 * Clearing is gated on the catch-up read: only a start we know has no mid-run history (buffered read
 * came back empty) wipes the feed. A run that predates the view's mount already has buffered lines,
 * and a status reveal saying "generating" is that pre-existing run — clearing there would erase the
 * history we're about to show and make the feed look like it restarted. */
export function useSkillOutput(
  engineClient: EngineClient,
  kind: SkillOutputKind,
  state: DiagramGenerationStatus["state"],
): string[] {
  const [lines, setLines] = useState<string[]>([]);
  const previousState = useRef(state);
  // Whether this mount's catch-up read found buffered progress; `null` until that read resolves.
  const hadBufferedRef = useRef<boolean | null>(null);

  useEffect(() => {
    const started = state === "generating" && previousState.current !== "generating";
    previousState.current = state;
    // A reveal reports a run this mount didn't start; its history is in the catch-up buffer, so
    // keep it. Only a start whose catch-up read found no buffered history drops stale lines — so
    // the remount-mid-run case (reveal for a pre-existing run, buffer non-empty) never clears.
    if (started && hadBufferedRef.current === false) setLines([]);
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    engineClient
      .getDiagramOutput(kind)
      .then((initial) => {
        if (cancelled) return;
        // Set before appending: the clearing effect reads this, so a status reveal that lands
        // before this read resolves never wipes the history we're about to append.
        hadBufferedRef.current = initial.length > 0;
        // Merged rather than blindly prepended: a batch may already have arrived over the socket
        // while this read was in flight, and the bridge's buffer (what this read returns) and its
        // socket batches (what the subscription below appends) draw from the same underlying
        // history, so the two can overlap. A naive `[...initial, ...current]` showed every line
        // duplicated whenever the panel revealed a run already in progress. See mergeCatchUp.
        if (initial.length > 0) setLines((current) => trim(mergeCatchUp(initial, current)));
      })
      .catch((cause: unknown) => reportAsyncError(`${kind} output catch-up`, cause));
    const unsubscribe = engineClient.subscribeDiagramOutput(kind, (batch) => {
      if (!cancelled) setLines((current) => trim([...current, ...batch]));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [engineClient, kind]);

  return lines;
}

function trim(lines: string[]): string[] {
  return lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;
}

/** Joins a catch-up read with whatever the live subscription already appended, without duplicating
 * the overlap between them. `current`'s lines are a chronological continuation of the same history
 * `initial` is a snapshot of, so the two can only overlap where the tail of `initial` matches the
 * head of `current` — find the longest such overlap and drop it from `current` before joining.
 *
 * Searching largest-overlap-first (not smallest) is deliberate: a run with several consecutive
 * identical lines (e.g. a repeated "✓ done in Ns" heartbeat) makes more than one overlap length look
 * valid, and picking the largest one can undercount how many times that line repeats. Picking the
 * smallest instead would avoid that undercount but reintroduce the visible-duplication bug this
 * function exists to fix in the common case. Since the collapsed lines are textually identical
 * either way, the undercount never shows wrong content — only a possibly-off repeat count on an
 * already-cosmetic progress feed — so this trade-off is kept rather than "fixed" into the other bug. */
function mergeCatchUp(initial: string[], current: string[]): string[] {
  const maxOverlap = Math.min(initial.length, current.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const tailOfInitial = initial.slice(initial.length - overlap);
    const headOfCurrent = current.slice(0, overlap);
    if (tailOfInitial.every((line, index) => line === headOfCurrent[index])) {
      return [...initial, ...current.slice(overlap)];
    }
  }
  return [...initial, ...current];
}
