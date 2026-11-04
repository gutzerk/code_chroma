import type { RawPrompt } from "../../state/types";

/** One user prompt in the navigator: 1-based `index`, `summary` of the reply ("1 edit, 2 runs" or "answer"). */
export interface PromptItem {
  id: string;
  index: number;
  text: string;
  createdAt: string | null;
  summary: string;
}

/** Rows above the viewport top a prompt may start at and still count as the one being read (~40px). */
export const ACTIVE_SLACK_ROWS = 3;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "1 edit, 1 run" from the reply's tool calls; "answer" when it only wrote text. */
export function replySummary(edits: number, runs: number): string {
  const parts = [edits > 0 ? plural(edits, "edit") : null, runs > 0 ? plural(runs, "run") : null].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "answer";
}

export function toPrompts(raw: readonly RawPrompt[]): PromptItem[] {
  return raw.map((p, i) => ({ id: p.id, index: i + 1, text: p.text, createdAt: p.createdAt, summary: replySummary(p.edits, p.runs) }));
}

/** Keeps a 1-based index inside 1..total; 0 when there are no prompts. */
export function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 1), total);
}

/** The prompt being read: the last one starting at or above the viewport top (plus slack); the first when none has. */
export function activeIndexAt(lines: readonly (number | null)[], viewportTop: number, slack = ACTIVE_SLACK_ROWS): number {
  let active = 0;
  lines.forEach((line, i) => {
    if (line !== null && line <= viewportTop + slack) active = i + 1;
  });
  return active || clampIndex(1, lines.length);
}

/** Case-insensitive text filter; an empty query keeps every prompt. */
export function filterPrompts(prompts: readonly PromptItem[], query: string): PromptItem[] {
  const q = query.trim().toLowerCase();
  return q ? prompts.filter((p) => p.text.toLowerCase().includes(q)) : [...prompts];
}

/** "HH:MM" in local time, "" for a missing or bad timestamp. */
export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** An echo's first row: an optional box edge, then the TUI's prompt glyph (`!` in bash mode). */
const ECHO_START = /^[\s│|]*[>❯›!]\s?/;
/** Characters of a prompt compared with its echo, whitespace removed (wraps and line breaks differ). */
const MATCH_CHARS = 60;
const MAX_ECHO_ROWS = 12;
/** A row the TUI hangs under an echo (hook or tool output, `⎿ 1 skill available`), which ends the echo. */
const ATTACHED_ROW = /^\s*⎿/;

function continuesEcho(row: string): boolean {
  return row.trim() === "" || (/^\s/.test(row) && !ATTACHED_ROW.test(row));
}

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

/** End (exclusive) of the echo starting at `start`: its glyph row, then indented or blank rows up to a `⎿` row, trailing blanks dropped. */
function echoEnd(bufferLines: readonly string[], start: number, max = MAX_ECHO_ROWS): number {
  let end = start + 1;
  let last = end;
  while (end < bufferLines.length && end - start < max && continuesEcho(bufferLines[end])) {
    end++;
    if (bufferLines[end - 1].trim() !== "") last = end;
  }
  return last;
}

/** The echo's text as compared with a prompt; null for a row that does not start an echo. */
function echoKey(bufferLines: readonly string[], start: number): string | null {
  const first = bufferLines[start];
  if (!ECHO_START.test(first)) return null;
  const rows = [first.replace(ECHO_START, ""), ...bufferLines.slice(start + 1, echoEnd(bufferLines, start))];
  return compact(rows.join("")).slice(0, MATCH_CHARS);
}

function promptKey(text: string): string {
  return compact(text.trim().replace(/^!/, "")).slice(0, MATCH_CHARS);
}

/** Each prompt's echo row, or null when it is not in the buffer; matched newest first, so a repeated prompt maps to its own echo even after old rows leave the scrollback. */
export function findPromptLines(bufferLines: readonly string[], prompts: readonly { text: string }[]): (number | null)[] {
  const echoes: { line: number; key: string }[] = [];
  bufferLines.forEach((_, line) => {
    const key = echoKey(bufferLines, line);
    if (key) echoes.push({ line, key });
  });
  const found: (number | null)[] = prompts.map(() => null);
  let below = echoes.length;
  for (let i = prompts.length - 1; i >= 0 && below > 0; i--) {
    const key = promptKey(prompts[i].text);
    if (!key) continue;
    for (let e = below - 1; e >= 0; e--) {
      if (echoes[e].key !== key) continue;
      found[i] = echoes[e].line;
      below = e;
      break;
    }
  }
  return found;
}

/** Rows a prompt's echo spans: its glyph row and the indented rows under it, at most `max`. */
export function promptBlockHeight(bufferLines: readonly string[], start: number, max = MAX_ECHO_ROWS): number {
  return echoEnd(bufferLines, start, max) - start;
}
