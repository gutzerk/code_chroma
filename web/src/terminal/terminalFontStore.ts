import { useSyncExternalStore } from "react";
import { DESKTOP_READY_EVENT, getDesktopWorkspaceApi } from "../agents/desktopWorkspaceApi";
import { Store } from "../state/createStore";
import { clamp } from "../util/clamp";

/** Terminal text size in CSS px: the agent windows and the terminal panel only, never the rest of the UI. */
export const TERMINAL_FONT_MIN = 9;
export const TERMINAL_FONT_MAX = 24;
export const TERMINAL_FONT_DEFAULT = 12;

const STORAGE_KEY = "codechroma.terminalFont";

interface StoredFonts {
  /** Size per display key, so a laptop panel and a large external monitor each keep their own. */
  displays: Record<string, number>;
  /** The size last chosen anywhere: what an unknown display starts at. */
  last: number;
}

function sanitizeSize(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? clamp(Math.round(value), TERMINAL_FONT_MIN, TERMINAL_FONT_MAX) : null;
}

function load(): StoredFonts {
  const empty: StoredFonts = { displays: {}, last: TERMINAL_FONT_DEFAULT };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<{ displays: Record<string, unknown>; last: unknown }>;
    const displays: Record<string, number> = {};
    for (const [key, size] of Object.entries(parsed.displays ?? {})) {
      const clean = sanitizeSize(size);
      if (clean !== null) displays[key] = clean;
    }
    return { displays, last: sanitizeSize(parsed.last) ?? TERMINAL_FONT_DEFAULT };
  } catch {
    return empty;
  }
}

/** The browser's own guess at which monitor the window is on: its size and pixel ratio. */
export function browserDisplayKey(): string {
  try {
    return `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`;
  } catch {
    return "unknown";
  }
}

/** Per-display terminal font size; every terminal subscribes and refits when it changes. */
class TerminalFontStore extends Store {
  private stored: StoredFonts | null = null;
  private shellDisplay: string | null = null;
  private display: string | null = null;

  private fonts = (): StoredFonts => (this.stored ??= load());

  /** The display the window is on: the desktop shell's identity when it sent one, else the browser's guess. */
  displayKey = (): string => (this.display ??= this.shellDisplay ?? browserDisplayKey());

  /** The size for the current display; an unseen display gets the size last chosen anywhere. */
  get = (): number => {
    const fonts = this.fonts();
    return fonts.displays[this.displayKey()] ?? fonts.last;
  };

  set(size: number): void {
    const clean = sanitizeSize(size);
    if (clean === null) return;
    const fonts = this.fonts();
    const key = this.displayKey();
    if (fonts.displays[key] === clean && fonts.last === clean) return;
    this.stored = { displays: { ...fonts.displays, [key]: clean }, last: clean };
    this.persist();
    this.emit();
  }

  step(delta: 1 | -1): void {
    this.set(this.get() + delta);
  }

  restoreDefault(): void {
    this.set(TERMINAL_FONT_DEFAULT);
  }

  /** The desktop shell reports the monitor the window moved to (bounds + scaling); it wins over the browser's guess. */
  setShellDisplay(key: string | null): void {
    this.shellDisplay = key || null;
    this.displayChanged();
  }

  /** Re-reads which display the window is on (a resolution change or a window resize); emits only when the size to use changed. */
  displayChanged = (): void => {
    const before = this.display === null ? null : this.get();
    this.display = null;
    if (before === null || this.get() !== before) this.emit();
  };

  reset(): void {
    // A text-size preference is machine-wide, so a workspace switch leaves it alone.
  }

  /** Drops every cached value, so the next read sees storage and the current display afresh -- tests only. */
  reloadForTests(): void {
    this.stored = null;
    this.shellDisplay = null;
    this.display = null;
  }

  private persist(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.fonts()));
    } catch {
      // best effort: the size still applies for this session
    }
  }
}

export const terminalFontStore = new TerminalFontStore().markGlobalStore();

let watching = false;
let shellHooked = false;

/** Takes the shell's monitor identity and follows its `display` commands; false while the shell's API is not injected yet. */
function hookShell(): boolean {
  if (shellHooked) return true;
  const desktop = getDesktopWorkspaceApi();
  if (!desktop) return false;
  shellHooked = true;
  const shellKey = desktop.displayKey?.();
  if (shellKey) terminalFontStore.setShellDisplay(shellKey);
  desktop.onAgentCommand?.((command) => {
    if (command.type === "display") terminalFontStore.setShellDisplay(command.key);
  });
  return true;
}

/** Forgets the module's listeners' latches, so a test can watch afresh -- tests only. */
export function resetDisplayWatchForTests(): void {
  watching = false;
  shellHooked = false;
}

/** Follows the window between monitors: a pixel-ratio change (a `resolution` media query) or a resize re-reads the display key. */
export function watchDisplayChanges(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  const onResolution = () => {
    terminalFontStore.displayChanged();
    listenResolution();
  };
  // A `resolution` query matches one ratio only, so it is re-armed for the new ratio each time it fires.
  const listenResolution = () => {
    try {
      const query = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      query?.addEventListener?.("change", onResolution, { once: true });
    } catch {
      // no matchMedia: the resize listener still catches most moves
    }
  };
  listenResolution();
  window.addEventListener("resize", terminalFontStore.displayChanged);
  // The desktop shell knows the real monitor (two same-sized screens look identical to the browser), so it wins; its API may arrive later.
  if (!hookShell()) window.addEventListener(DESKTOP_READY_EVENT, hookShell, { once: true });
}

export function useTerminalFontSize(): number {
  return useSyncExternalStore(terminalFontStore.subscribe, terminalFontStore.get, terminalFontStore.get);
}
