import { findPromptLines } from "./promptNav";

/** Keys a fullscreen claude scrolls its own transcript with (checked live on claude 2.1.332): about half a screen per page key. */
export const PAGE_UP = "\x1b[5~";
export const PAGE_DOWN = "\x1b[6~";
/** Ctrl+End: the transcript's bottom, where the live prompt is. */
export const TRANSCRIPT_END = "\x1b[1;5F";
/** At most this many page steps per jump (~12 rows each), so a lost prompt cannot scroll forever. */
export const MAX_SEEK_STEPS = 200;
/** Unchanged screens in a row that mean an end is reached; one alone may be a key the TUI dropped. */
const STALLS_AT_END = 2;

/** What a seek drives: the visible screen's rows, a way to type into the PTY, and a wait for the TUI's repaint. */
export interface AltScreenDriver {
  rows(): string[];
  send(data: string): void;
  settled(): Promise<void>;
}

type Direction = "up" | "down";

/** Which way the target lies from what is on screen: above the first visible prompt (or under the pinned header row) is up. */
function directionFor(lines: readonly (number | null)[], index: number): Direction {
  if (lines[index - 1] === 0) return "up";
  const visible = lines.flatMap((line, i) => (line === null ? [] : [i + 1]));
  if (visible.length === 0) return "up";
  return index < Math.min(...visible) ? "up" : "down";
}

/**
 * Pages a fullscreen TUI's own transcript until prompt `index` (1-based) shows its echo below the top row, which fullscreen
 * claude uses as a pinned header for the prompt being read. Rescans the screen after every step; stops at an end that no
 * longer moves (then tries the other way once), after `maxSteps`, or when `cancelled` says a newer jump took over.
 * Resolves to the echo's screen row, or null when it was not found.
 */
export async function seekPromptOnAltScreen(
  driver: AltScreenDriver,
  prompts: readonly { text: string }[],
  index: number,
  cancelled: () => boolean = () => false,
  maxSteps = MAX_SEEK_STEPS,
): Promise<number | null> {
  let direction: Direction | null = null;
  let reversed = false;
  let stalls = 0;
  let previous: string | null = null;
  for (let step = 0; step <= maxSteps; step++) {
    if (cancelled()) return null;
    const rows = driver.rows();
    const lines = findPromptLines(rows, prompts);
    const row = lines[index - 1] ?? null;
    if (row !== null && row > 0) return row;
    const screen = rows.join("\n");
    stalls = screen === previous ? stalls + 1 : 0;
    if (direction === null) direction = directionFor(lines, index);
    else if (stalls >= STALLS_AT_END) {
      // No progress: this end of the transcript is reached.
      if (row === 0) return 0;
      if (reversed) return null;
      direction = direction === "up" ? "down" : "up";
      reversed = true;
      stalls = 0;
    }
    previous = screen;
    if (step === maxSteps) break;
    driver.send(direction === "up" ? PAGE_UP : PAGE_DOWN);
    await driver.settled();
  }
  return null;
}
