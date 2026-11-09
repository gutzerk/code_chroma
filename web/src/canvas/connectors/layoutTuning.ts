import { useEffect, useSyncExternalStore } from "react";
import { Store } from "../../state/createStore";
import { AUTO_NODE_SEP, AUTO_RANK_SEP, ELK_NODE_SEP, ELK_RANK_SEP } from "../collision/constants";

/** ELK direction; "auto" keeps the built-in rule (RIGHT when every box has a lane, else DOWN). */
export type LayoutDirection = "auto" | "DOWN" | "RIGHT" | "UP" | "LEFT";

/** Every first-layout knob the layout playground can override. */
export interface LayoutTuning {
  direction: LayoutDirection;
  nodeSep: number;
  rankSep: number;
  componentSep: number;
  margin: number;
  aspectRatio: number;
  separateComponents: boolean;
  /** `elk.layered.nodePlacement.strategy`; empty keeps ELK's default. */
  nodePlacement: string;
  /** `elk.layered.crossingMinimization.strategy`; empty keeps ELK's default. */
  crossingMinimization: string;
  newDiagramGap: number;
  defaultWidth: number;
  defaultHeight: number;
  incrementalNodeSep: number;
  incrementalRankSep: number;
  /** Raw `key=value` lines merged last into the root ELK options. */
  extraElkOptions: string;
}

export const DEFAULT_LAYOUT_TUNING: Readonly<LayoutTuning> = Object.freeze({
  direction: "auto",
  nodeSep: ELK_NODE_SEP,
  rankSep: ELK_RANK_SEP,
  componentSep: ELK_NODE_SEP,
  margin: 40,
  aspectRatio: 1.6,
  separateComponents: true,
  nodePlacement: "LINEAR_SEGMENTS",
  crossingMinimization: "LAYER_SWEEP",
  newDiagramGap: 80,
  defaultWidth: 300,
  defaultHeight: 72,
  incrementalNodeSep: AUTO_NODE_SEP,
  incrementalRankSep: AUTO_RANK_SEP,
  extraElkOptions: "",
});

const ENABLED_KEY = "codechroma.layoutPlayground";
const TUNING_KEY = "codechroma.layoutTuning";
const QUERY_FLAG = "layoutPlayground";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* best effort: the playground still works for this session */
  }
}

function readEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has(QUERY_FLAG)) {
      writeStorage(ENABLED_KEY, "1");
      return true;
    }
  } catch {
    /* no location (tests) */
  }
  return readStorage(ENABLED_KEY) === "1";
}

function readTuning(): LayoutTuning {
  try {
    const raw = readStorage(TUNING_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT_TUNING };
    const parsed = JSON.parse(raw) as Partial<LayoutTuning>;
    const merged = { ...DEFAULT_LAYOUT_TUNING } as LayoutTuning;
    for (const key of Object.keys(DEFAULT_LAYOUT_TUNING) as (keyof LayoutTuning)[]) {
      if (typeof parsed[key] === typeof DEFAULT_LAYOUT_TUNING[key]) (merged as unknown as Record<string, unknown>)[key] = parsed[key];
    }
    return merged;
  } catch {
    return { ...DEFAULT_LAYOUT_TUNING };
  }
}

/** The layout playground's switch and its overrides, persisted per browser; global across workspaces. */
class LayoutTuningStore extends Store {
  private enabled = readEnabled();
  private tuning: LayoutTuning = readTuning();

  isEnabled = (): boolean => this.enabled;

  getTuning = (): LayoutTuning => this.tuning;

  /** The values the layout code reads: the overrides while the playground is on, else the defaults. */
  effective = (): Readonly<LayoutTuning> => (this.enabled ? this.tuning : DEFAULT_LAYOUT_TUNING);

  setEnabled = (enabled: boolean): void => {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    writeStorage(ENABLED_KEY, enabled ? "1" : null);
    this.emit();
  };

  update = (patch: Partial<LayoutTuning>): void => {
    this.tuning = { ...this.tuning, ...patch };
    writeStorage(TUNING_KEY, JSON.stringify(this.tuning));
    this.emit();
  };

  resetTuning = (): void => {
    this.tuning = { ...DEFAULT_LAYOUT_TUNING };
    writeStorage(TUNING_KEY, null);
    this.emit();
  };

  /** No-op: the tuning is a per-browser dev setting, not workspace data. */
  reset = (): void => {};
}

export const layoutTuningStore = new LayoutTuningStore().markGlobalStore();

/** The knobs every layout pass reads at call time. */
export function layoutTuning(): Readonly<LayoutTuning> {
  return layoutTuningStore.effective();
}

/** The overrides that differ from the defaults, for copying back into the constants. */
export function changedTuning(tuning: LayoutTuning): Partial<LayoutTuning> {
  const out: Partial<LayoutTuning> = {};
  for (const key of Object.keys(DEFAULT_LAYOUT_TUNING) as (keyof LayoutTuning)[]) {
    if (tuning[key] !== DEFAULT_LAYOUT_TUNING[key]) (out as Record<string, unknown>)[key] = tuning[key];
  }
  return out;
}

/** Parses `key=value` lines (blank and `#` lines skipped) into ELK layout options. */
export function parseElkOptions(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

export function useLayoutTuning(): LayoutTuning {
  return useSyncExternalStore(layoutTuningStore.subscribe, layoutTuningStore.getTuning);
}

export function useLayoutPlaygroundEnabled(): boolean {
  return useSyncExternalStore(layoutTuningStore.subscribe, layoutTuningStore.isEnabled);
}

/** Ctrl/Cmd+Alt+L toggles the playground while the hosting panel is mounted. */
export function useLayoutPlaygroundShortcut(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyL" || !event.altKey || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      layoutTuningStore.setEnabled(!layoutTuningStore.isEnabled());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
