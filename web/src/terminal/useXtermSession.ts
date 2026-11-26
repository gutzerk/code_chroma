import { useCallback, useEffect, useRef, type RefObject } from "react";
import { getDesktopWorkspaceApi } from "../agents/desktopWorkspaceApi";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { useTerminalClient } from "./TerminalClientContext";
import type { TerminalSession, TerminalSize } from "./TerminalClient";
import { attachStickToBottom, type StickToBottomHandle } from "./stickToBottom";
import { terminalFontStore, watchDisplayChanges } from "./terminalFontStore";

const REFIT_DEBOUNCE_MS = 60;
const SELECTION_COPY_DEBOUNCE_MS = 150;
// FitAddon never proposes less than 2x1, so that size means a 0px box, not a real one.
const MIN_COLS = 2;
const MIN_ROWS = 1;

let clipboardTail: Promise<unknown> | null = null;

/** Writes a terminal selection to the native (desktop) or browser clipboard, one write at a time and in order. */
function copySelection(text: string): void {
  const desktop = getDesktopWorkspaceApi();
  const write = () => (desktop?.writeClipboard ? desktop.writeClipboard(text) : navigator.clipboard?.writeText(text));
  const run = () => Promise.resolve(write()).catch(() => {});
  const next = clipboardTail ? clipboardTail.then(run) : run();
  clipboardTail = next;
  void next.then(() => { if (clipboardTail === next) clipboardTail = null; });
}

// A stack that actually ships the box-drawing and braille an agent TUI paints with; courier-new,
// xterm's default, has neither. lineHeight must stay 1 or box borders break into dashes.
const FONT_FAMILY =
  "'SFMono-Regular', 'SF Mono', Menlo, Monaco, 'Cascadia Mono', 'DejaVu Sans Mono', monospace";

// The full 16 colours, not just a background: a TUI's dim greys are unreadable against a default palette.
const THEME = {
  background: "#12141a",
  foreground: "#d7dae0",
  cursor: "#8fb0ff",
  cursorAccent: "#12141a",
  selectionBackground: "#3a3f4b",
  black: "#3f4451",
  red: "#e05561",
  green: "#8cc265",
  yellow: "#d18f52",
  blue: "#4aa5f0",
  magenta: "#c162de",
  cyan: "#42b3c2",
  white: "#d7dae0",
  brightBlack: "#5c6370",
  brightRed: "#ff616e",
  brightGreen: "#a5e075",
  brightYellow: "#f0a45d",
  brightBlue: "#4dc4ff",
  brightMagenta: "#de73ff",
  brightCyan: "#4cd1e0",
  brightWhite: "#e6e6e6",
};

/** Ctrl/Cmd+V (optionally with Shift): the chords that should become a native paste. */
export function isPasteChord(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "key">): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v";
}

/** An unmeasurable box (hidden: NaN; laid out at 0px: FitAddon's 2x1 floor) would shrink the PTY, so it is never sent. */
function measurable(fitAddon: FitAddon): boolean {
  const measured = fitAddon.proposeDimensions();
  return !!measured && measured.cols > MIN_COLS && measured.rows > MIN_ROWS;
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** Cmd (macOS) or Ctrl (elsewhere) with `=`/`+`, `-` or `0`: the terminal text-size chords; the step, or 0 to restore the default. */
export function fontChord(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "key">, mac = isMac()): 1 | -1 | 0 | null {
  if (event.altKey || !(mac ? event.metaKey : event.ctrlKey)) return null;
  if (event.key === "=" || event.key === "+") return 1;
  if (event.key === "-" || event.key === "_") return -1;
  if (event.key === "0") return 0;
  return null;
}

export interface XtermSessionOptions {
  /** Allow-listed agent key on the bridge, e.g. "shell" or "claude". */
  agent: string;
  /** Attaches to that workspace's long-lived agent PTY instead of spawning a per-socket one. */
  workspace?: string;
  /** False keeps the terminal torn down — a stopped agent has nothing to attach to. */
  enabled?: boolean;
  /** A hidden host box cannot be measured, so no size is sent while it is; showing it refits and focuses. */
  hidden?: boolean;
  /** Written into the terminal when the socket drops, so a detach is visible rather than silent. */
  closedNotice: string;
  /** Called once the terminal is open; the returned cleanup runs before it is disposed. */
  onTerminal?: (term: Terminal, container: HTMLElement) => (() => void) | void;
}

export interface XtermSessionHandle {
  scheduleRefit: () => void;
  focus: () => void;
}

/**
 * The one place an xterm.js terminal is constructed, addon-loaded, fitted and wired to a
 * TerminalSession. Both the terminal panel and every agent window go through it — they were
 * near-duplicates before, and the agent copy had silently missed the resize debounce, so a window
 * drag flooded the PTY with SIGWINCHes and smeared the TUI it was resizing.
 */
export function useXtermSession(
  containerRef: RefObject<HTMLDivElement | null>,
  { agent, workspace, enabled = true, hidden = false, closedNotice, onTerminal }: XtermSessionOptions,
): XtermSessionHandle {
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;
  const terminalClient = useTerminalClient();
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const sessionRef = useRef<TerminalSession | null>(null);
  const refitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const stickyRef = useRef<StickToBottomHandle | null>(null);

  // Reflow the grid to the container, then forward the new size to the PTY — but only when cols/rows
  // actually changed, so a settled resize is one clean SIGWINCH rather than a redundant reprint.
  const refit = useCallback(() => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    const session = sessionRef.current;
    if (!term || !fitAddon || !session) return;
    if (!measurable(fitAddon)) return;
    fitAddon.fit();
    const last = lastSizeRef.current;
    if (last && last.rows === term.rows && last.cols === term.cols) return;
    lastSizeRef.current = { rows: term.rows, cols: term.cols };
    session.resize(term.rows, term.cols);
  }, []);

  // Debounce it: during a drag the ResizeObserver fires on every pointermove (~60-120x/sec).
  // Flooding the PTY with that many SIGWINCHes races the TUI's async redraws and leaves the screen
  // smeared until the next keypress. A short trailing timeout collapses the burst into one refit.
  const scheduleRefit = useCallback(() => {
    if (refitTimeoutRef.current !== null) clearTimeout(refitTimeoutRef.current);
    refitTimeoutRef.current = setTimeout(() => {
      refitTimeoutRef.current = null;
      refit();
    }, REFIT_DEBOUNCE_MS);
  }, [refit]);

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return undefined;

    watchDisplayChanges();
    const term = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize: terminalFontStore.get(),
      lineHeight: 1,
      scrollback: 5000,
      theme: THEME,
      // Unicode 11 widths need the proposed API; without them the braille spinner, box drawing and
      // emoji an agent TUI paints with are measured at the wrong cell width and the frame smears.
      allowProposedApi: true,
      // While a TUI has mouse tracking on (claude fullscreen), Option-drag still selects text on macOS.
      macOptionClickForcesSelection: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
    term.open(container);
    // Leave Ctrl/Cmd+V to the browser: xterm cancelling the keydown suppresses the native paste event,
    // and the desktop shell's clipboard fallback then raises a WebView "Insert" prompt instead of pasting.
    // Cmd/Ctrl+=/-/0 size the terminal text and never reach the PTY.
    term.attachCustomKeyEventHandler((event) => {
      const chord = fontChord(event);
      if (chord !== null) {
        if (event.type === "keydown") {
          event.preventDefault();
          if (chord === 0) terminalFontStore.restoreDefault();
          else terminalFontStore.step(chord);
        }
        return false;
      }
      return !(event.type === "keydown" && isPasteChord(event));
    });
    // Every terminal follows the size for this display: a chord, the A-/A+ buttons or a move to another monitor.
    const offFont = terminalFontStore.subscribe(() => {
      const size = terminalFontStore.get();
      if (term.options.fontSize === size) return;
      term.options.fontSize = size;
      scheduleRefit();
    });

    // No WebglAddon on purpose: its glyph atlas is shared by every terminal and, once pages merge, drops glyphs.
    // The default DOM renderer has no atlas, so that whole class of blank cells cannot happen.

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Measured before connecting, so the bridge resizes the PTY and paints once at this size; a hidden box connects without one.
    let initialSize: TerminalSize | undefined;
    if (measurable(fitAddon)) {
      fitAddon.fit();
      initialSize = { rows: term.rows, cols: term.cols };
    }
    lastSizeRef.current = initialSize ?? null;

    let disposed = false;
    const session = terminalClient.connect(agent, workspace, initialSize);
    sessionRef.current = session;
    session.onData((data) => {
      if (!disposed) term.write(data);
    });
    session.onClose(() => {
      if (!disposed) term.write(closedNotice);
    });
    term.onData((data) => session.write(data));
    term.onBinary((data) => session.writeBinary(data));
    // Copy-on-select, like a native terminal: a selection is a copy, no explicit Cmd/Ctrl+C needed.
    // Debounced the same way scheduleRefit is: a drag fires this on every extended cell, and copying
    // a still-growing multi-thousand-line selection on every tick is pure waste.
    // Whether a change was user-made is recorded when it fires, not when the debounce ends: checking a
    // timed-out pointer flag then lost double-click and quick-drag copies whenever the timers raced.
    let userSelecting = false;
    let userSelectionPending = false;
    let unmarkTimeout: ReturnType<typeof setTimeout> | undefined;
    const markSelecting = () => { clearTimeout(unmarkTimeout); userSelecting = true; };
    // A tick later, so the mouseup that xterm finalizes the selection on still counts as the user's.
    const unmarkSelecting = () => {
      clearTimeout(unmarkTimeout);
      unmarkTimeout = setTimeout(() => { userSelecting = false; }, 0);
    };
    container.addEventListener("pointerdown", markSelecting);
    window.addEventListener("pointerup", unmarkSelecting);
    term.onSelectionChange(() => {
      if (userSelecting) userSelectionPending = true;
      if (selectionCopyTimeoutRef.current !== null) clearTimeout(selectionCopyTimeoutRef.current);
      selectionCopyTimeoutRef.current = setTimeout(() => {
        selectionCopyTimeoutRef.current = null;
        const selection = term.getSelection();
        if (selection && userSelectionPending) copySelection(selection);
        userSelectionPending = false;
      }, SELECTION_COPY_DEBOUNCE_MS);
    });
    refit();

    const sticky = attachStickToBottom(term, container, () => hiddenRef.current);
    stickyRef.current = sticky;

    const resizeObserver = new ResizeObserver(() => scheduleRefit());
    resizeObserver.observe(container);

    const detachConsumer = onTerminalRef.current?.(term, container);

    return () => {
      disposed = true;
      offFont();
      sticky.detach();
      stickyRef.current = null;
      detachConsumer?.();
      resizeObserver.disconnect();
      container.removeEventListener("pointerdown", markSelecting);
      window.removeEventListener("pointerup", unmarkSelecting);
      if (refitTimeoutRef.current !== null) clearTimeout(refitTimeoutRef.current);
      if (selectionCopyTimeoutRef.current !== null) clearTimeout(selectionCopyTimeoutRef.current);
      clearTimeout(unmarkTimeout);
      session.close();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      sessionRef.current = null;
    };
  }, [containerRef, terminalClient, agent, workspace, enabled, closedNotice, refit, scheduleRefit]);

  // On reopen the box goes 0 -> real size; redraw, refit to it and focus so the shell is usable immediately.
  useEffect(() => {
    if (hidden || !enabled) return;
    const term = termRef.current;
    term?.refresh(0, term.rows - 1);
    scheduleRefit();
    stickyRef.current?.shown();
    term?.focus();
  }, [hidden, enabled, scheduleRefit]);

  return { scheduleRefit, focus };
}
