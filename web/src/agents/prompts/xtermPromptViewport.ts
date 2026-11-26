import type { IDecoration, Terminal } from "@xterm/xterm";
import { isAtBottom, pinTerminal, unpinTerminal } from "../../terminal/stickToBottom";
import { findPromptLines, promptBlockHeight } from "./promptNav";
import { promptNavStore } from "./promptNavStore";
import { seekPromptOnAltScreen, TRANSCRIPT_END, type AltScreenDriver } from "./altScreenSeek";

/** Trailing delay before re-scanning the buffer after output, so a streaming reply costs one scan per burst. */
const SCAN_DEBOUNCE_MS = 200;
/** Rows kept above a prompt when jumping to it (~12px). */
const JUMP_TOP_ROWS = 1;
const HIGHLIGHT_BG = "#1a2236";
const MAX_HIGHLIGHT_ROWS = 12;
/** A fullscreen TUI's repaint after a scroll key: quiet this long after the last write, or give up waiting after the timeout. */
const REPAINT_QUIET_MS = 40;
const REPAINT_TIMEOUT_MS = 500;

/** Drives a fullscreen TUI from the terminal: its screen, the PTY (through xterm's own onData) and a wait for its repaint. */
function altScreenDriver(term: Terminal): AltScreenDriver {
  return {
    rows: () => bufferText(term),
    send: (data) => term.input(data, false),
    settled: () =>
      new Promise<void>((resolve) => {
        let quiet: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          clearTimeout(quiet);
          clearTimeout(timeout);
          writes.dispose();
          resolve();
        };
        const timeout = setTimeout(finish, REPAINT_TIMEOUT_MS);
        const writes = term.onWriteParsed(() => {
          clearTimeout(quiet);
          quiet = setTimeout(finish, REPAINT_QUIET_MS);
        });
      }),
  };
}

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
  // Bumped by every jump, Latest and the detach, so an older fullscreen seek stops typing.
  let seekGeneration = 0;
  const alternate = () => term.buffer.active.type === "alternate";

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

  const seekPrompt = (index: number) => {
    const generation = ++seekGeneration;
    const { prompts } = promptNavStore.get(agentId);
    void seekPromptOnAltScreen(altScreenDriver(term), prompts, index, () => generation !== seekGeneration || !alternate()).then((row) => {
      if (generation !== seekGeneration) return;
      scan();
      if (row === null) promptNavStore.seekMissed(agentId, index);
    });
  };

  const detach = promptNavStore.attach(agentId, {
    scrollToLine: (line) => {
      unpinTerminal(term);
      term.scrollToLine(Math.max(0, line - JUMP_TOP_ROWS));
    },
    scrollToBottom: () => {
      seekGeneration++;
      // A fullscreen TUI scrolls its own transcript: Ctrl+End takes it to the live prompt.
      if (alternate()) {
        term.input(TRANSCRIPT_END, false);
        return;
      }
      pinTerminal(term);
      term.scrollToBottom();
    },
    highlight,
    seekPrompt,
  });
  const buffers = term.buffer.onBufferChange(() => {
    promptNavStore.setAlternate(agentId, alternate());
    scheduleScan();
  });
  promptNavStore.setAlternate(agentId, alternate());
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
    seekGeneration++;
    buffers.dispose();
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
