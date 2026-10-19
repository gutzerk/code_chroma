import { useSyncExternalStore } from "react";
import { agentStore } from "../agents/agentStore";
import { Store } from "../state/createStore";

export type LeftTab = "diagrams" | "files";
export type LeftMode = "open" | "collapsed";
export type AgentsMode = "normal" | "full" | "collapsed";
export type ArrangeMode = "side" | "stack" | "grid";

export interface ShellState {
  left: { mode: LeftMode; tab: LeftTab; width: number };
  agents: { mode: AgentsMode; activeId: string | null; width: number };
  terminal: { open: boolean; height: number };
  codeOverlayOpen: boolean;
  arrangeMode: ArrangeMode | null;
  hiddenLayers: string[];
}

export const LEFT_MIN_WIDTH = 240;
export const LEFT_MAX_WIDTH = 520;
export const AGENTS_MIN_WIDTH = 340;
export const AGENTS_MAX_WIDTH = 720;
export const TERMINAL_MIN_HEIGHT = 120;
export const COLLAPSED_STRIP_WIDTH = 44;

const STORAGE_PREFIX = "codechroma.shell";

const DEFAULTS: ShellState = {
  left: { mode: "open", tab: "diagrams", width: 300 },
  agents: { mode: "normal", activeId: null, width: 420 },
  terminal: { open: false, height: 220 },
  codeOverlayOpen: false,
  arrangeMode: null,
  hiddenLayers: [],
};

function storageKey(): string {
  return `${STORAGE_PREFIX}.${agentStore.getActiveWorkspace()}`;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The persisted slice: the code overlay is transient and `full` falls back to `normal` on reload. */
function readPersisted(): ShellState {
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return structuredClone(DEFAULTS);
    const p = JSON.parse(raw) as Partial<ShellState>;
    const out = structuredClone(DEFAULTS);
    if (p.left?.mode === "collapsed") out.left.mode = "collapsed";
    if (p.left?.tab === "files") out.left.tab = "files";
    if (typeof p.left?.width === "number") out.left.width = clamp(p.left.width, LEFT_MIN_WIDTH, LEFT_MAX_WIDTH);
    if (p.agents?.mode === "collapsed") out.agents.mode = "collapsed";
    if (typeof p.agents?.activeId === "string") out.agents.activeId = p.agents.activeId;
    if (typeof p.agents?.width === "number") out.agents.width = clamp(p.agents.width, AGENTS_MIN_WIDTH, AGENTS_MAX_WIDTH);
    if (p.terminal?.open === true) out.terminal.open = true;
    if (typeof p.terminal?.height === "number") out.terminal.height = Math.max(TERMINAL_MIN_HEIGHT, p.terminal.height);
    if (Array.isArray(p.hiddenLayers)) out.hiddenLayers = p.hiddenLayers.filter((x): x is string => typeof x === "string");
    return out;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

/** Single source of truth for shell chrome: left panel, agents panel, terminal dock, code overlay, arrange mode, hidden diagrams. */
class ShellStore extends Store {
  private state: ShellState = readPersisted();

  getState = (): ShellState => this.state;

  /** Re-reads the active workspace's persisted shell state; call after a workspace switch. */
  load = (): void => {
    this.state = readPersisted();
    this.emit();
  };

  reset = (): void => {
    this.state = structuredClone(DEFAULTS);
    this.emit();
  };

  private set(next: ShellState): void {
    this.state = next;
    try {
      const { codeOverlayOpen: _transient, ...persisted } = next;
      window.localStorage.setItem(storageKey(), JSON.stringify(persisted));
    } catch {
      // storage unavailable: shell state stays in memory
    }
    this.emit();
  }

  openLeft = (tab?: LeftTab): void =>
    this.set({ ...this.state, left: { ...this.state.left, mode: "open", tab: tab ?? this.state.left.tab } });
  collapseLeft = (): void => this.set({ ...this.state, left: { ...this.state.left, mode: "collapsed" } });
  setLeftTab = (tab: LeftTab): void => this.set({ ...this.state, left: { ...this.state.left, tab } });
  setLeftWidth = (width: number): void =>
    this.set({ ...this.state, left: { ...this.state.left, width: clamp(width, LEFT_MIN_WIDTH, LEFT_MAX_WIDTH) } });

  /** Reopens the agents panel on an agent (collapsed strip a1/a2 buttons). */
  openAgent = (id: string): void =>
    this.set({ ...this.state, agents: { ...this.state.agents, mode: this.state.agents.mode === "full" ? "full" : "normal", activeId: id } });
  setActiveAgent = (id: string | null): void => this.set({ ...this.state, agents: { ...this.state.agents, activeId: id } });
  /** Reopens the collapsed agents panel with no agent to select. */
  expandAgents = (): void => this.set({ ...this.state, agents: { ...this.state.agents, mode: "normal" } });
  /** ‹ on the agents handle. */
  agentsFull = (): void => this.set({ ...this.state, agents: { ...this.state.agents, mode: "full" } });
  /** › on the agents handle: full returns to normal first, normal collapses. */
  agentsStepOut = (): void =>
    this.set({
      ...this.state,
      agents: { ...this.state.agents, mode: this.state.agents.mode === "full" ? "normal" : "collapsed" },
    });
  setAgentsWidth = (width: number): void =>
    this.set({ ...this.state, agents: { ...this.state.agents, width: clamp(width, AGENTS_MIN_WIDTH, AGENTS_MAX_WIDTH) } });

  toggleTerminal = (): void => this.set({ ...this.state, terminal: { ...this.state.terminal, open: !this.state.terminal.open } });
  setTerminalHeight = (height: number): void =>
    this.set({ ...this.state, terminal: { ...this.state.terminal, height: Math.max(TERMINAL_MIN_HEIGHT, height) } });

  /** A box click: leaves agents full screen for normal so the overlay has a panel to sit over. */
  openCodeOverlay = (): void =>
    this.set({
      ...this.state,
      codeOverlayOpen: true,
      agents: { ...this.state.agents, mode: "normal" },
    });
  closeCodeOverlay = (): void => this.set({ ...this.state, codeOverlayOpen: false });

  setArrangeMode = (mode: ArrangeMode | null): void => this.set({ ...this.state, arrangeMode: mode });

  toggleLayerHidden = (layer: string): void => {
    const hidden = new Set(this.state.hiddenLayers);
    if (hidden.has(layer)) hidden.delete(layer);
    else hidden.add(layer);
    this.set({ ...this.state, hiddenLayers: [...hidden] });
  };
}

export const shellStore = new ShellStore().markGlobalStore();

export function useShellState(): ShellState {
  return useSyncExternalStore(shellStore.subscribe, shellStore.getState);
}
