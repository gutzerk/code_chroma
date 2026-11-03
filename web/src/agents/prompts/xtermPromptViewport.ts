import type { IDecoration, Terminal } from "@xterm/xterm";
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

/** Wires one agent's xterm to the prompt navigator: scans for prompt echoes, follows the viewport, scrolls and highlights. */
export function attachXtermPromptViewport(term: Terminal, agentId: string, scrollHost: HTMLElement | null): () => void {
  let decoration: IDecoration | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;

  const scan = () => {
    scanTimer = null;
    const { prompts } = promptNavStore.get(agentId);
    if (prompts.length === 0) return;
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
      promptNavStore.onViewport(agentId, term.buffer.active.viewportY);
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
    scrollToLine: (line) => term.scrollToLine(Math.max(0, line - JUMP_TOP_ROWS)),
    scrollToBottom: () => term.scrollToBottom(),
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
  scan();

  return () => {
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
