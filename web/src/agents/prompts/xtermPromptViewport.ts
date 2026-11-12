import type { IDecoration, Terminal } from "@xterm/xterm";
import { isAtBottom, pinTerminal, unpinTerminal } from "../../terminal/stickToBottom";
import { findPromptLines, promptBlockHeight } from "./promptNav";
import { promptNavStore } from "./promptNavStore";

/** Trailing delay before re-scanning the buffer after output, so a streaming reply costs one scan per burst. */
const SCAN_DEBOUNCE_MS = 200;
/** Rows kept above a prompt when jumping to it (~12px). */
const JUMP_TOP_ROWS = 1;
const HIGHLIGHT_BG = "#1a2236";
const MAX_HIGHLIGHT_ROWS = 12;

/** Lines `from` up to (not including) `to` of the active buffer as plain text. */
function bufferText(term: Terminal, from = 0, to = term.buffer.active.length): string[] {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = from; i < Math.min(to, buffer.length); i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
  return lines;
}

/** Each attached terminal's re-scan, so a terminal that comes back into view catches up on output it skipped while hidden. */
const rescans = new Map<string, () => void>();

/** Re-scans an agent's buffer now; called when its terminal is shown again. */
export function rescanPrompts(agentId: string): void {
  rescans.get(agentId)?.();
}

/** Wires one agent's xterm to the prompt navigator: scans for prompt echoes, follows the viewport, scrolls and highlights. */
export function attachXtermPromptViewport(
  term: Terminal,
  agentId: string,
  scrollHost: HTMLElement | null,
  isHidden: () => boolean = () => false,
): () => void {
  let decoration: IDecoration | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;

  const scan = () => {
    scanTimer = null;
    const { prompts } = promptNavStore.get(agentId);
    if (prompts.length === 0 || isHidden()) return;
    const text = bufferText(term);
    promptNavStore.setLayout(agentId, findPromptLines(text, prompts), text.length);
  };
  const scheduleScan = () => {
    if (scanTimer === null) scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  };
  const onViewport = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      promptNavStore.onViewport(agentId, term.buffer.active.viewportY, isAtBottom(term));
    });
  };

  const highlight = (line: number | null) => {
    decoration?.dispose();
    decoration = null;
    if (line === null) return;
    const buffer = term.buffer.active;
    const marker = term.registerMarker(line - (buffer.baseY + buffer.cursorY));
    if (!marker) return;
    const height = promptBlockHeight(bufferText(term, line, line + MAX_HIGHLIGHT_ROWS), 0, MAX_HIGHLIGHT_ROWS);
    decoration = term.registerDecoration({ marker, width: term.cols, height, backgroundColor: HIGHLIGHT_BG }) ?? null;
    decoration?.onRender((el) => el.classList.add("prompt-nav-term-highlight"));
    decoration?.onDispose(() => marker.dispose());
  };

  const detach = promptNavStore.attach(agentId, {
    scrollToLine: (line) => {
      unpinTerminal(term);
      term.scrollToLine(Math.max(0, line - JUMP_TOP_ROWS));
    },
    scrollToBottom: () => {
      pinTerminal(term);
      term.scrollToBottom();
    },
    highlight,
  });
  let knownPrompts = promptNavStore.get(agentId).prompts;
  const unsubscribe = promptNavStore.subscribe(() => {
    const { prompts } = promptNavStore.get(agentId);
    if (prompts === knownPrompts) return;
    knownPrompts = prompts;
    scheduleScan();
  });
  const writes = term.onWriteParsed(scheduleScan);
  const resizes = term.onResize(scheduleScan);
  const scrolls = term.onScroll(onViewport);
  scrollHost?.addEventListener("scroll", onViewport, { passive: true });
  rescans.set(agentId, scan);
  scan();

  return () => {
    if (rescans.get(agentId) === scan) rescans.delete(agentId);
    detach();
    unsubscribe();
    writes.dispose();
    resizes.dispose();
    scrolls.dispose();
    scrollHost?.removeEventListener("scroll", onViewport);
    if (scanTimer !== null) clearTimeout(scanTimer);
    if (frame) cancelAnimationFrame(frame);
    decoration?.dispose();
  };
}
