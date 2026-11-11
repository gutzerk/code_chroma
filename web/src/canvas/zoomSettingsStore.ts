import { useSyncExternalStore } from "react";
import { Store } from "../state/createStore";
import { clamp } from "../util/clamp";

/** Per-device wheel-zoom sensitivity plus the canvas display scale, persisted per browser. */
export interface ZoomSettings {
  /** Multiplier on a mouse wheel notch's zoom step (1 = default). */
  mouse: number;
  /** Multiplier on trackpad scroll/pinch zoom (1 = default). */
  trackpad: number;
  /** Canvas base scale: "auto" follows the window width, a number pins it. */
  displayScale: "auto" | number;
}

export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 3;
export const DISPLAY_SCALE_OPTIONS = [1, 1.25, 1.5, 1.75, 2] as const;
const DEFAULT_ZOOM_SETTINGS: ZoomSettings = { mouse: 1, trackpad: 1, displayScale: "auto" };

const STORAGE_KEY = "codechroma.zoomSettings";
// Coalesces storage writes while a slider is dragged; the value itself applies at once.
const PERSIST_DELAY_MS = 250;
// Window width (CSS px) that renders the canvas at 100%; wider windows scale up from here.
const AUTO_SCALE_BASE_WIDTH = 1600;
const AUTO_SCALE_MAX = 2;

/** Auto canvas scale for a window width: 1 up to AUTO_SCALE_BASE_WIDTH, growing linearly after, capped. */
export function autoDisplayScale(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= AUTO_SCALE_BASE_WIDTH) return 1;
  return Math.round(clamp(windowWidth / AUTO_SCALE_BASE_WIDTH, 1, AUTO_SCALE_MAX) * 20) / 20;
}

/** The effective canvas base scale for the given settings and window width. */
export function resolveDisplayScale(settings: ZoomSettings, windowWidth: number): number {
  return settings.displayScale === "auto" ? autoDisplayScale(windowWidth) : settings.displayScale;
}

function sanitize(raw: unknown): ZoomSettings {
  const value = (raw ?? {}) as Partial<Record<keyof ZoomSettings, unknown>>;
  const sensitivity = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? clamp(v, SENSITIVITY_MIN, SENSITIVITY_MAX) : 1;
  const scale = value.displayScale;
  return {
    mouse: sensitivity(value.mouse),
    trackpad: sensitivity(value.trackpad),
    displayScale: typeof scale === "number" && Number.isFinite(scale) ? nearestDisplayScale(scale) : "auto",
  };
}

/** Snaps a pinned scale to the closest menu option, so a stored value always matches a choice the menu shows. */
export function nearestDisplayScale(scale: number): number {
  return DISPLAY_SCALE_OPTIONS.reduce((best, option) => (Math.abs(option - scale) < Math.abs(best - scale) ? option : best));
}

function load(): ZoomSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : DEFAULT_ZOOM_SETTINGS;
  } catch {
    return DEFAULT_ZOOM_SETTINGS;
  }
}

/** Machine-wide user chrome; the wheel handler reads get() per event, so it never re-binds listeners. */
class ZoomSettingsStore extends Store {
  private settings: ZoomSettings | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  get = (): ZoomSettings => (this.settings ??= load());

  set(patch: Partial<ZoomSettings>): void {
    this.settings = sanitize({ ...this.get(), ...patch });
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persist(), PERSIST_DELAY_MS);
    this.emit();
  }

  restoreDefaults(): void {
    this.set(DEFAULT_ZOOM_SETTINGS);
  }

  reset(): void {
    // Zoom preferences are machine-wide, so a workspace switch leaves them alone.
  }

  /** Writes any pending change now and drops the cache, so the next get() re-reads storage -- tests only. */
  reloadForTests(): void {
    if (this.persistTimer !== null) this.persist();
    this.settings = null;
  }

  private persist(): void {
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.get()));
    } catch {
      /* best effort -- the setting still applies for this session */
    }
  }
}

export const zoomSettingsStore = new ZoomSettingsStore().markGlobalStore();

export function useZoomSettings(): ZoomSettings {
  return useSyncExternalStore(zoomSettingsStore.subscribe, zoomSettingsStore.get, zoomSettingsStore.get);
}

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function subscribeDisplayScale(onChange: () => void): () => void {
  const unsubscribe = zoomSettingsStore.subscribe(onChange);
  const unsubscribeResize = subscribeResize(onChange);
  return () => {
    unsubscribe();
    unsubscribeResize();
  };
}

const readDisplayScale = () => resolveDisplayScale(zoomSettingsStore.get(), window.innerWidth);
const readAutoDisplayScale = () => autoDisplayScale(window.innerWidth);

/** The resolved canvas display scale; re-renders only when that number changes, not on every resize pixel or slider tick. */
export function useDisplayScale(): number {
  return useSyncExternalStore(subscribeDisplayScale, readDisplayScale, () => 1);
}

/** The auto display scale for the current window width (the settings menu's "Auto (N%)" label). */
export function useAutoDisplayScale(): number {
  return useSyncExternalStore(subscribeResize, readAutoDisplayScale, () => 1);
}
