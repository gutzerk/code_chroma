import { useCallback, useEffect, useRef, type RefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { useTerminalClient } from "./TerminalClientContext";
import type { TerminalSession } from "./TerminalClient";

const REFIT_DEBOUNCE_MS = 60;
const SELECTION_COPY_DEBOUNCE_MS = 150;

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

export interface XtermSessionOptions {
  /** Allow-listed agent key on the bridge, e.g. "shell" or "claude". */
  agent: string;
  /** Attaches to that workspace's long-lived agent PTY instead of spawning a per-socket one. */
  workspace?: string;
  /** False keeps the terminal torn down — a stopped agent has nothing to attach to. */
  enabled?: boolean;
  /** A hidden host box measures 0x0; skip refits while it does. */
  hidden?: boolean;
  /** Written into the terminal when the socket drops, so a detach is visible rather than silent. */
  closedNotice: string;
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
  { agent, workspace, enabled = true, hidden = false, closedNotice }: XtermSessionOptions,
): XtermSessionHandle {
  const terminalClient = useTerminalClient();
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglRef = useRef<WebglAddon | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const refitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSizeRef = useRef<{ rows: number; cols: number } | null>(null);

  // Reflow the grid to the container, then forward the new size to the PTY — but only when cols/rows
  // actually changed, so a settled resize is one clean SIGWINCH rather than a redundant reprint.
  const refit = useCallback(() => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    const session = sessionRef.current;
    if (!term || !fitAddon || !session) return;
    fitAddon.fit();
    if (term.rows === 0 || term.cols === 0) return;
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

    const term = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize: 12,
      lineHeight: 1,
      scrollback: 5000,
      theme: THEME,
      // Unicode 11 widths need the proposed API; without them the braille spinner, box drawing and
      // emoji an agent TUI paints with are measured at the wrong cell width and the frame smears.
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
    term.open(container);

    // WebGL is the difference between a repaint and a smear on a dense TUI, but a lost context
    // renders nothing at all — dispose on loss and let xterm fall back to the DOM renderer.
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl?.dispose();
        webgl = null;
        webglRef.current = null;
      });
      term.loadAddon(webgl);
    } catch {
      webgl = null;
    }
    webglRef.current = webgl;

    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    let disposed = false;
    const session = terminalClient.connect(agent, workspace);
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
    term.onSelectionChange(() => {
      if (selectionCopyTimeoutRef.current !== null) clearTimeout(selectionCopyTimeoutRef.current);
      selectionCopyTimeoutRef.current = setTimeout(() => {
        selectionCopyTimeoutRef.current = null;
        const selection = term.getSelection();
        if (selection) void navigator.clipboard?.writeText(selection).catch(() => {});
      }, SELECTION_COPY_DEBOUNCE_MS);
    });
    lastSizeRef.current = { rows: term.rows, cols: term.cols };
    session.resize(term.rows, term.cols);

    const resizeObserver = new ResizeObserver(() => scheduleRefit());
    resizeObserver.observe(container);

    // Moving the window between a Retina and an external display changes nothing about the box, so
    // only a DPR listener catches it; the atlas is rasterized at the old ratio until it is cleared.
    let dprQuery: MediaQueryList | null = null;
    const onDprChange = () => {
      webglRef.current?.clearTextureAtlas();
      scheduleRefit();
      watchDpr();
    };
    const watchDpr = () => {
      dprQuery?.removeEventListener("change", onDprChange);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener("change", onDprChange);
    };
    if (typeof window.matchMedia === "function") watchDpr();

    return () => {
      disposed = true;
      dprQuery?.removeEventListener("change", onDprChange);
      resizeObserver.disconnect();
      if (refitTimeoutRef.current !== null) clearTimeout(refitTimeoutRef.current);
      if (selectionCopyTimeoutRef.current !== null) clearTimeout(selectionCopyTimeoutRef.current);
      session.close();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      webglRef.current = null;
      sessionRef.current = null;
    };
  }, [containerRef, terminalClient, agent, workspace, enabled, closedNotice, scheduleRefit]);

  // On reopen the box goes 0 -> real size; refit to it and focus so the shell is usable immediately.
  useEffect(() => {
    if (hidden || !enabled) return;
    scheduleRefit();
    termRef.current?.focus();
  }, [hidden, enabled, scheduleRefit]);

  return { scheduleRefit, focus };
}
