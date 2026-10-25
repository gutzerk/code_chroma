import { Store } from "../../state/createStore";
import { agentStore } from "../../agents/agentStore";

export type SequenceMode = "readable" | "focus";

export interface SequenceView {
  mode: SequenceMode;
  /** Ids of the phases folded to one row (focus mode only). */
  collapsed: string[];
  /** The participant ref whose messages stay lit (focus mode only); null lights everything. */
  focus: string | null;
}

/** Diagrams with more messages than this open in `focus` mode until the user picks one. */
export const FOCUS_DEFAULT_MESSAGE_COUNT = 12;

const STORAGE_PREFIX = "codechroma.sequence-view";

type Stored = Record<string, Partial<SequenceView>>;

/** Per active workspace, so one worktree's layer names never collide with another's. */
const storageKey = (): string => `${STORAGE_PREFIX}.${agentStore.getActiveWorkspace()}`;

function readStorage(): Stored {
  try {
    const raw = window.localStorage.getItem(storageKey());
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function writeStorage(stored: Stored): void {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(stored));
  } catch {
    // The page renders correctly without storage; the choice just won't survive a reload.
  }
}

/** The size-based default a diagram gets before the user picks a mode. */
export function defaultSequenceMode(messageCount: number): SequenceMode {
  return messageCount > FOCUS_DEFAULT_MESSAGE_COUNT ? "focus" : "readable";
}

/** Per-diagram sequence display prefs (mode, collapsed phases, focus); never written to sequence.json. */
class SequenceViewStore extends Store {
  private stored: Stored | null = null;
  private storedKey = "";
  private version = 0;
  // Bumps only when the layout-relevant part changes (mode / collapsed), not on step or focus.
  private layoutVersion = 0;
  private readonly steps = new Map<string, number | null>();

  getVersion = (): number => this.version;
  getLayoutVersion = (): number => this.layoutVersion;

  get(layer: string, messageCount: number): SequenceView {
    const own = this.load()[layer] ?? {};
    return {
      mode: own.mode === "readable" || own.mode === "focus" ? own.mode : defaultSequenceMode(messageCount),
      collapsed: Array.isArray(own.collapsed) ? own.collapsed.filter((id) => typeof id === "string") : [],
      focus: typeof own.focus === "string" ? own.focus : null,
    };
  }

  getStep = (layer: string): number | null => this.steps.get(layer) ?? null;

  setStep(layer: string, step: number | null): void {
    this.steps.set(layer, step);
    this.bump(false);
  }

  setMode = (layer: string, mode: SequenceMode): void => this.update(layer, { mode });
  setFocus = (layer: string, focus: string | null): void => this.update(layer, { focus });
  setCollapsed = (layer: string, collapsed: string[]): void => this.update(layer, { collapsed });

  /** Forgets the in-memory choices (saved ones stay and reload per workspace). */
  reset(): void {
    this.stored = null;
    this.steps.clear();
    this.bump(true);
  }

  private load(): Stored {
    const key = storageKey();
    if (!this.stored || this.storedKey !== key) {
      this.stored = readStorage();
      this.storedKey = key;
    }
    return this.stored;
  }

  private update(layer: string, patch: Partial<SequenceView>): void {
    const all = this.load();
    all[layer] = { ...all[layer], ...patch };
    writeStorage(all);
    this.bump("mode" in patch || "collapsed" in patch);
  }

  private bump(layoutChanged: boolean): void {
    if (layoutChanged) this.layoutVersion += 1;
    this.version += 1;
    this.emit();
  }
}

export const sequenceViewStore = new SequenceViewStore();
